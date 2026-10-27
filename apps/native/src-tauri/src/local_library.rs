// Local folder selection and verified SQLite relocation. Caller freezes all editors first.
use crate::db::{Database, Result};
use rusqlite::{backup::Backup, types::Value, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};

const LOCATION: &str = "library-location.json";
const JOURNAL: &str = "library-relocation.json";
const IDENTITY: &str = "libraryIdentity";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Location {
    schema_version: u32,
    folder: PathBuf,
    library_id: String,
    previous_folder: Option<PathBuf>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Journal {
    schema_version: u32,
    relocation_id: String,
    source: PathBuf,
    destination: PathBuf,
    library_id: String,
    copied: bool,
}
pub struct LocalLibrary {
    pub database: Database,
    root: PathBuf,
    location: Location,
    _root_lock: LibraryLock,
    folder_lock: LibraryLock,
}
struct LibraryLock(File);
impl Drop for LibraryLock {
    fn drop(&mut self) {
        // Closing just our descriptor can leave an inherited/duplicated handle holding the lock.
        // This guard is the sole manager owner; release explicitly before its File is closed.
        let _ = self.0.unlock();
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
enum Phase {
    Planned,
    Copied,
    Published,
}

fn private_new(path: &Path) -> Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).map_err(|_| "The destination already exists or cannot be written. Choose a folder without a Peel database.".into())
}
fn exclusive(path: &Path) -> Result<LibraryLock> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(path)
        .map_err(|_| "Could not lock the local library folder.".to_string())?;
    file.try_lock().map_err(|_| {
        "This library is open in another Peel process. Quit that copy before continuing."
            .to_string()
    })?;
    Ok(LibraryLock(file))
}
fn sync_directory(path: &Path) -> Result<()> {
    File::open(path)
        .and_then(|file| file.sync_all())
        .map_err(|_| "Could not confirm the local folder on disk.".into())
}
// The bool tells the caller whether replacement may already be visible on disk.
fn atomic_json<T: Serialize>(
    root: &Path,
    name: &str,
    value: &T,
    after_rename: impl FnOnce() -> Result<()>,
) -> std::result::Result<(), (bool, String)> {
    let temp = root.join(format!(".peel-selection-{}.tmp", uuid::Uuid::new_v4()));
    let mut published = false;
    let result = (|| {
        let mut file = private_new(&temp)?;
        let data = serde_json::to_vec(value)
            .map_err(|_| "Could not prepare local selection metadata.".to_string())?;
        file.write_all(&data)
            .and_then(|_| file.sync_all())
            .map_err(|_| "Could not save local selection metadata.".to_string())?;
        fs::rename(&temp, root.join(name))
            .map_err(|_| "Could not publish local selection metadata.".to_string())?;
        published = true;
        after_rename()?;
        sync_directory(root)
    })();
    let _ = fs::remove_file(temp);
    result.map_err(|error| (published, error))
}
fn journal(root: &Path, value: &Journal) -> Result<()> {
    atomic_json(root, JOURNAL, value, || Ok(())).map_err(|(_, error)| error)
}
fn selected_database(location: &Location) -> Result<Database> {
    if location.schema_version != 1
        || !location.folder.is_absolute()
        || uuid::Uuid::parse_str(&location.library_id).is_err()
    {
        return Err("Unrecognized library selection. Its data has not been changed.".into());
    }
    let path = location.folder.join("notes.sqlite3");
    let check = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| "The selected library is unavailable. Reconnect its drive or restore access; no empty replacement was created.".to_string())?;
    let version: i64 = check
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .map_err(|_| "Could not read the selected library.".to_string())?;
    if version != 1 {
        return Err(
            "The selected library needs another Peel version. Its data has not been changed."
                .into(),
        );
    }
    for query in [
        "SELECT id,revision,state,updated_at,snapshot FROM notes LIMIT 0",
        "SELECT id,snapshot FROM placements LIMIT 0",
        "SELECT id,purged_at FROM tombstones LIMIT 0",
        "SELECT key,value FROM settings LIMIT 0",
    ] {
        check.prepare(query).map_err(|_| {
            "The selected library schema is incomplete. Its data has not been changed.".to_string()
        })?;
    }
    let identity: String = check
        .query_row("SELECT value FROM settings WHERE key=?1", [IDENTITY], |r| {
            r.get(0)
        })
        .map_err(|_| "The selected file is not the expected Peel library.".to_string())?;
    if version != 1
        || serde_json::from_str::<String>(&identity).ok().as_ref() != Some(&location.library_id)
    {
        return Err(
            "The selected file is not the expected Peel library. Its data has not been changed."
                .into(),
        );
    }
    drop(check);
    Database::open_existing(&path)
}
fn verify_copy(source: &Database, copy: &Database) -> Result<()> {
    let check: String = copy
        .connection
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|_| "Could not verify the copied library.".to_string())?;
    if check != "ok" {
        return Err("The copied library failed its integrity check.".into());
    }
    for query in [
        "SELECT id,revision,state,updated_at,snapshot FROM notes ORDER BY id",
        "SELECT id,snapshot FROM placements ORDER BY id",
        "SELECT id,purged_at FROM tombstones ORDER BY id",
        "SELECT key,value FROM settings ORDER BY key",
    ] {
        let mut left = source
            .connection
            .prepare(query)
            .map_err(|e| e.to_string())?;
        let mut right = copy.connection.prepare(query).map_err(|e| e.to_string())?;
        let count = left.column_count();
        let mut a = left.query([]).map_err(|e| e.to_string())?;
        let mut b = right.query([]).map_err(|e| e.to_string())?;
        loop {
            match (
                a.next().map_err(|e| e.to_string())?,
                b.next().map_err(|e| e.to_string())?,
            ) {
                (None, None) => break,
                (Some(a), Some(b)) => {
                    for index in 0..count {
                        if a.get::<_, Value>(index).map_err(|e| e.to_string())?
                            != b.get::<_, Value>(index).map_err(|e| e.to_string())?
                        {
                            return Err("The copied library does not match the source.".into());
                        }
                    }
                }
                _ => return Err("The copied library is incomplete.".into()),
            }
        }
    }
    Ok(())
}
impl LocalLibrary {
    // The caller passes PEEL_DATA_DIR as root when set, isolating ALL metadata.
    pub fn open(root: &Path) -> Result<Self> {
        fs::create_dir_all(root)
            .map_err(|_| "Could not open the app-managed library folder.".to_string())?;
        let root = root
            .canonicalize()
            .map_err(|_| "Could not resolve the library folder.".to_string())?;
        let root_lock = exclusive(&root.join("peel-manager.lock"))?;
        let configured = root
            .join(LOCATION)
            .try_exists()
            .map_err(|_| "Could not read library selection.".to_string())?;
        let location: Option<Location> = if configured {
            Some(
                serde_json::from_slice(
                    &fs::read(root.join(LOCATION))
                        .map_err(|_| "Could not read library selection.".to_string())?,
                )
                .map_err(|_| {
                    "Unrecognized library selection. No fallback database was opened.".to_string()
                })?,
            )
        } else {
            None
        };
        if let Some(choice) = &location {
            if choice.schema_version != 1
                || !choice.folder.is_absolute()
                || uuid::Uuid::parse_str(&choice.library_id).is_err()
            {
                return Err(
                    "Unrecognized library selection. Its data has not been changed.".into(),
                );
            }
        }
        if root
            .join(JOURNAL)
            .try_exists()
            .map_err(|_| "Could not inspect relocation metadata.".to_string())?
        {
            let progress: Journal = serde_json::from_slice(
                &fs::read(root.join(JOURNAL))
                    .map_err(|_| "Could not read relocation metadata.".to_string())?,
            )
            .map_err(|_| "Unrecognized relocation metadata. Nothing was replaced.".to_string())?;
            let choice = location.as_ref().ok_or(
                "The selected library metadata is missing. No fallback database was opened.",
            )?;
            if progress.schema_version != 1
                || uuid::Uuid::parse_str(&progress.relocation_id).is_err()
                || progress.library_id != choice.library_id
                || !progress.source.is_absolute()
                || !progress.destination.is_absolute()
                || (choice.folder != progress.source && choice.folder != progress.destination)
                || (choice.folder == progress.destination && !progress.copied)
            {
                return Err(
                    "Unrecognized relocation state. No fallback database was opened.".into(),
                );
            }
        }
        let folder = location
            .as_ref()
            .map_or(root.as_path(), |choice| choice.folder.as_path());
        if !folder.is_dir() {
            return Err(
                "The selected notes folder is unavailable. No fallback database was opened.".into(),
            );
        }
        let folder_lock = exclusive(&folder.join("peel-library.lock"))?;
        let database = if let Some(choice) = &location {
            selected_database(choice)?
        } else {
            Database::open(&folder.join("notes.sqlite3"))?
        };
        let location = if let Some(choice) = location {
            choice
        } else {
            let library_id = match database.setting(IDENTITY)? {
                Some(value) => value
                    .as_str()
                    .filter(|s| uuid::Uuid::parse_str(s).is_ok())
                    .ok_or("Unrecognized local library identity.")?
                    .to_string(),
                None => {
                    let id = uuid::Uuid::new_v4().to_string();
                    database.set_setting(IDENTITY, serde_json::Value::String(id.clone()))?;
                    id
                }
            };
            let choice = Location {
                schema_version: 1,
                folder: root.clone(),
                library_id,
                previous_folder: None,
            };
            atomic_json(&root, LOCATION, &choice, || Ok(())).map_err(|(_, error)| error)?;
            choice
        };
        Ok(Self {
            database,
            root,
            location,
            _root_lock: root_lock,
            folder_lock,
        })
    }
    pub fn folder(&self) -> &Path {
        &self.location.folder
    }
    pub fn previous_folder(&self) -> Option<&Path> {
        self.location.previous_folder.as_deref()
    }
    pub fn relocate(&mut self, destination: &Path) -> Result<()> {
        self.relocate_with(destination, |_| Ok(()))
    }
    fn relocate_with(
        &mut self,
        destination: &Path,
        mut hook: impl FnMut(Phase) -> Result<()>,
    ) -> Result<()> {
        self.database.ensure_storage()?;
        let destination = destination
            .canonicalize()
            .map_err(|_| "Choose an existing local folder.".to_string())?;
        if !destination.is_dir() {
            return Err("Choose a local folder.".into());
        }
        if destination == self.location.folder {
            return Ok(());
        }
        let folder_lock = exclusive(&destination.join("peel-library.lock"))?;
        let path = destination.join("notes.sqlite3");
        for suffix in ["", "-wal", "-shm", "-journal"] {
            if destination
                .join(format!("notes.sqlite3{suffix}"))
                .try_exists()
                .map_err(|_| "Could not inspect the destination.".to_string())?
            {
                return Err("The destination contains a Peel database or recovery file. Nothing was overwritten.".into());
            }
        }
        let mut progress = Journal {
            schema_version: 1,
            relocation_id: uuid::Uuid::new_v4().to_string(),
            source: self.location.folder.clone(),
            destination: destination.clone(),
            library_id: self.location.library_id.clone(),
            copied: false,
        };
        journal(&self.root, &progress)?;
        hook(Phase::Planned)?;
        let created = private_new(&path)?;
        created
            .sync_all()
            .map_err(|_| "Could not prepare the destination file.".to_string())?;
        let mut target = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|_| "Could not open the destination copy.".to_string())?;
        target
            .execute_batch("PRAGMA synchronous=FULL")
            .map_err(|e| e.to_string())?;
        Backup::new(&self.database.connection, &mut target)
            .map_err(|e| e.to_string())?
            .run_to_completion(100, Duration::from_millis(5), None)
            .map_err(|_| {
                "Could not finish the library backup. The original remains selected.".to_string()
            })?;
        drop(target);
        let choice = Location {
            schema_version: 1,
            folder: destination,
            library_id: self.location.library_id.clone(),
            previous_folder: Some(self.location.folder.clone()),
        };
        let candidate = selected_database(&choice)?;
        verify_copy(&self.database, &candidate)?;
        let busy: i64 = candidate
            .connection
            .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if busy != 0 {
            return Err("The library copy could not be checkpointed.".into());
        }
        File::open(&path)
            .and_then(|file| file.sync_all())
            .map_err(|_| "Could not confirm the library copy on disk.".to_string())?;
        sync_directory(&choice.folder)?;
        progress.copied = true;
        journal(&self.root, &progress)?;
        hook(Phase::Copied)?;
        if let Err((published, error)) =
            atomic_json(&self.root, LOCATION, &choice, || hook(Phase::Published))
        {
            if published {
                self.database.block_writes("The library selection could not be confirmed. Both copies are preserved. Quit and reopen Peel before editing.");
                return Err("The library selection could not be confirmed. Both copies are preserved. Quit and reopen Peel before editing.".into());
            }
            return Err(error);
        }
        self.database = candidate;
        self.location = choice;
        self.folder_lock = folder_lock;
        // Retain the body-free journal and inactive source copy for recovery.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{Note, Placement};
    #[test]
    fn owner_drop_releases_the_lock_even_if_a_duplicate_descriptor_remains() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("synthetic-lock");
        let owner = exclusive(&path).unwrap();
        let inherited = owner.0.try_clone().unwrap();
        assert!(
            exclusive(&path).is_err(),
            "A live owner must exclude other managers"
        );
        drop(owner);
        let reopened = exclusive(&path);
        drop(inherited);
        assert!(
            reopened.is_ok(),
            "An inherited descriptor must not extend the manager's lock lifetime"
        );
        assert!(
            exclusive(&path).is_err(),
            "Closing the old duplicate must not release the new owner's lock"
        );
        drop(reopened);
        assert!(exclusive(&path).is_ok());
    }
    fn fixture(library: &mut LocalLibrary) -> Note {
        let mut note = Note::blank();
        note.body_markdown = "# Synthetic relocation\n原文 café ##fixture".into();
        let saved = library.database.save(note, 0).unwrap();
        library
            .database
            .place(&Placement {
                note_id: saved.note_id.clone(),
                x: 12.0,
                y: 34.0,
                width: 360.0,
                height: 380.0,
                pinned: true,
                always_on_top: false,
                display_id: None,
            })
            .unwrap();
        let discarded = library.database.save(Note::blank(), 0).unwrap();
        library.database.purge(&discarded.note_id, 1).unwrap();
        library
            .database
            .set_setting(
                "synthetic-preference",
                serde_json::json!({"font": "system"}),
            )
            .unwrap();
        saved
    }
    #[test]
    fn full_backup_reopens_selected_folder_and_keeps_source_inactive() {
        let root = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let mut library = LocalLibrary::open(root.path()).unwrap();
        let note = fixture(&mut library);
        library.relocate(destination.path()).unwrap();
        assert_eq!(library.folder(), destination.path().canonicalize().unwrap());
        assert_eq!(
            library
                .database
                .get(&note.note_id)
                .unwrap()
                .unwrap()
                .body_markdown,
            note.body_markdown
        );
        assert_eq!(library.database.placements().unwrap().len(), 1);
        let mut changed = note.clone();
        changed.body_markdown = "Synthetic edit after relocation".into();
        library.database.save(changed, 1).unwrap();
        drop(library);
        let library = LocalLibrary::open(root.path()).unwrap();
        assert_eq!(
            library
                .database
                .get(&note.note_id)
                .unwrap()
                .unwrap()
                .local_revision,
            2
        );
        let source = Database::open_existing(&root.path().join("notes.sqlite3")).unwrap();
        assert_eq!(
            source.get(&note.note_id).unwrap().unwrap().body_markdown,
            note.body_markdown
        );
        assert_eq!(
            library.database.setting("synthetic-preference").unwrap(),
            Some(serde_json::json!({"font": "system"}))
        );
        assert_eq!(
            library
                .database
                .connection
                .query_row("SELECT count(*) FROM tombstones", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }
    #[test]
    fn failure_before_publication_keeps_source_and_ignores_partial_copy_after_restart() {
        for phase in [Phase::Planned, Phase::Copied] {
            let root = tempfile::tempdir().unwrap();
            let destination = tempfile::tempdir().unwrap();
            let mut library = LocalLibrary::open(root.path()).unwrap();
            let note = fixture(&mut library);
            assert!(library
                .relocate_with(destination.path(), |at| if at == phase {
                    Err("Synthetic interruption".into())
                } else {
                    Ok(())
                })
                .is_err());
            assert_eq!(library.folder(), root.path().canonicalize().unwrap());
            drop(library);
            let mut library = LocalLibrary::open(root.path()).unwrap();
            assert_eq!(library.folder(), root.path().canonicalize().unwrap());
            let mut next = note.clone();
            next.body_markdown = "Synthetic safe source continuation".into();
            assert_eq!(library.database.save(next, 1).unwrap().local_revision, 2);
        }
    }
    #[test]
    fn uncertain_selection_blocks_writes_until_restart_then_uses_verified_copy() {
        let root = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let mut library = LocalLibrary::open(root.path()).unwrap();
        let note = fixture(&mut library);
        assert!(library
            .relocate_with(destination.path(), |phase| if phase == Phase::Published {
                Err("Synthetic uncertain directory sync".into())
            } else {
                Ok(())
            })
            .is_err());
        assert!(library
            .database
            .save(note.clone(), 1)
            .unwrap_err()
            .contains("reopen"));
        drop(library);
        let mut library = LocalLibrary::open(root.path()).unwrap();
        assert_eq!(library.folder(), destination.path().canonicalize().unwrap());
        assert_eq!(library.database.save(note, 1).unwrap().local_revision, 2);
    }
    #[test]
    fn no_overwrite_no_fallback_and_exclusive_open() {
        let root = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let mut library = LocalLibrary::open(root.path()).unwrap();
        fixture(&mut library);
        assert!(LocalLibrary::open(root.path()).is_err());
        fs::write(
            destination.path().join("notes.sqlite3"),
            b"Synthetic unrecognized file",
        )
        .unwrap();
        assert!(library
            .relocate(destination.path())
            .unwrap_err()
            .contains("overwritten"));
        assert_eq!(
            fs::read(destination.path().join("notes.sqlite3")).unwrap(),
            b"Synthetic unrecognized file"
        );
        fs::remove_file(destination.path().join("notes.sqlite3")).unwrap();
        library.relocate(destination.path()).unwrap();
        drop(library);
        fs::remove_file(destination.path().join("notes.sqlite3")).unwrap();
        assert!(LocalLibrary::open(root.path()).is_err());
        assert!(!destination.path().join("notes.sqlite3").exists());
    }
    #[test]
    fn malformed_selection_and_wrong_identity_are_not_rewritten() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join(LOCATION), b"Synthetic unknown metadata").unwrap();
        assert!(LocalLibrary::open(root.path()).is_err());
        assert!(!root.path().join("notes.sqlite3").exists());
        assert_eq!(
            fs::read(root.path().join(LOCATION)).unwrap(),
            b"Synthetic unknown metadata"
        );
        fs::remove_file(root.path().join(LOCATION)).unwrap();
        let library = LocalLibrary::open(root.path()).unwrap();
        drop(library);
        let db = Database::open_existing(&root.path().join("notes.sqlite3")).unwrap();
        db.set_setting(
            IDENTITY,
            serde_json::json!(uuid::Uuid::new_v4().to_string()),
        )
        .unwrap();
        drop(db);
        assert!(LocalLibrary::open(root.path()).is_err());
    }
    #[test]
    fn unrecognized_journal_and_incomplete_selected_schema_are_preserved() {
        let root = tempfile::tempdir().unwrap();
        let library = LocalLibrary::open(root.path()).unwrap();
        drop(library);
        fs::write(root.path().join(JOURNAL), b"Synthetic unknown journal").unwrap();
        assert!(LocalLibrary::open(root.path()).is_err());
        assert_eq!(
            fs::read(root.path().join(JOURNAL)).unwrap(),
            b"Synthetic unknown journal"
        );
        fs::remove_file(root.path().join(JOURNAL)).unwrap();
        let connection = Connection::open(root.path().join("notes.sqlite3")).unwrap();
        connection.execute_batch("DROP TABLE placements").unwrap();
        drop(connection);
        assert!(LocalLibrary::open(root.path()).is_err());
        let connection = Connection::open_with_flags(
            root.path().join("notes.sqlite3"),
            OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        assert!(connection.prepare("SELECT * FROM placements").is_err());
    }
}
