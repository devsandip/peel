use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, String>;
pub fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub schema_version: u32,
    pub collection_id: String,
    pub note_id: String,
    pub body_markdown: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub purge_after: Option<String>,
    pub server_revision: Option<u32>,
    pub local_revision: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin: Option<Value>,
}
impl Note {
    pub fn blank() -> Self {
        let time = now();
        Self {
            schema_version: 1,
            collection_id: "local".into(),
            note_id: uuid::Uuid::new_v4().to_string(),
            body_markdown: String::new(),
            state: "active".into(),
            created_at: time.clone(),
            updated_at: time,
            deleted_at: None,
            purge_after: None,
            server_revision: None,
            local_revision: 0,
            origin: None,
        }
    }
    fn validate(&self) -> Result<()> {
        if self.schema_version != 1 {
            return Err("This collection needs a newer version of Synkies.".into());
        }
        if self.collection_id != "local" {
            return Err(
                "Synkies Cloud is not connected. Local notes have not been uploaded.".into(),
            );
        }
        if self.note_id.is_empty()
            || self.note_id.len() > 128
            || !self
                .note_id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-')
        {
            return Err("Invalid note identity.".into());
        }
        if self.body_markdown.len() > 256 * 1024 {
            return Err(
                "This note has reached its 256 KiB limit. Copy the extra text to a new note."
                    .into(),
            );
        }
        if !["active", "archived", "trashed"].contains(&self.state.as_str()) {
            return Err("Invalid note state.".into());
        }
        for time in [&self.created_at, &self.updated_at]
            .into_iter()
            .chain(self.deleted_at.iter())
            .chain(self.purge_after.iter())
        {
            if chrono::DateTime::parse_from_rfc3339(time).is_err() {
                return Err("Invalid note date.".into());
            }
        }
        if self.state == "trashed" && (self.deleted_at.is_none() || self.purge_after.is_none()) {
            return Err("Missing Trash retention date.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Placement {
    pub note_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub pinned: bool,
    pub always_on_top: bool,
    #[serde(default)]
    pub display_id: Option<String>,
}

pub struct Database {
    pub connection: Connection,
    path: PathBuf,
    #[cfg(unix)]
    identity: (u64, u64),
    blocked: Option<String>,
}
impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        Self::open_inner(path, true)
    }
    pub fn open_existing(path: &Path) -> Result<Self> {
        Self::open_inner(path, false)
    }
    fn open_inner(path: &Path, create: bool) -> Result<Self> {
        if create {
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|_| "Could not open the local notes folder.".to_string())?;
            }
        }
        let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
            | if create {
                rusqlite::OpenFlags::SQLITE_OPEN_CREATE
            } else {
                rusqlite::OpenFlags::empty()
            };
        let connection = Connection::open_with_flags(path, flags)
            .map_err(|_| "Could not open the local notes database.".to_string())?;
        connection
            .busy_timeout(std::time::Duration::from_secs(3))
            .map_err(|e| e.to_string())?;
        let version: i64 = connection
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > 1 {
            return Err(
                "This collection needs a newer version of Synkies. Its data has not been changed."
                    .into(),
            );
        }
        connection.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
          BEGIN IMMEDIATE;
          CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, updated_at TEXT NOT NULL, snapshot TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS placements(id TEXT PRIMARY KEY, snapshot TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS tombstones(id TEXT PRIMARY KEY, purged_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
          PRAGMA user_version=1; COMMIT;").map_err(|_|"Could not prepare the local notes database.".to_string())?;
        let path = path
            .canonicalize()
            .map_err(|_| "The local notes file is unavailable.".to_string())?;
        #[cfg(unix)]
        let identity = {
            use std::os::unix::fs::MetadataExt;
            let metadata = std::fs::metadata(&path)
                .map_err(|_| "The local notes file is unavailable.".to_string())?;
            (metadata.dev(), metadata.ino())
        };
        Ok(Self {
            connection,
            path,
            #[cfg(unix)]
            identity,
            blocked: None,
        })
    }
    pub fn ensure_storage(&self) -> Result<()> {
        if let Some(reason) = &self.blocked {
            return Err(reason.clone());
        }
        let metadata = std::fs::metadata(&self.path).map_err(|_| "The selected notes folder is unavailable. Reconnect the drive or restore access; your draft has not been saved.".to_string())?;
        if !metadata.is_file() {
            return Err(
                "The selected notes file is unavailable. Reopen Synkies before editing.".into(),
            );
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if (metadata.dev(), metadata.ino()) != self.identity {
                return Err("The selected notes file was replaced. Reopen Synkies before editing; your draft has not been saved.".into());
            }
        }
        Ok(())
    }
    pub fn block_writes(&mut self, reason: &str) {
        self.blocked = Some(reason.into());
    }
    pub fn is_blocked(&self) -> bool {
        self.blocked.is_some()
    }
    pub fn list(&self) -> Result<Vec<Note>> {
        self.ensure_storage()?;
        let mut statement = self
            .connection
            .prepare("SELECT snapshot FROM notes ORDER BY updated_at DESC,id")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|_| {
                "Could not read a note. Export or restore your database backup.".into()
            })
        })
        .collect()
    }
    pub fn get(&self, id: &str) -> Result<Option<Note>> {
        self.ensure_storage()?;
        let json: Option<String> = self
            .connection
            .query_row("SELECT snapshot FROM notes WHERE id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        json.map(|s| serde_json::from_str(&s).map_err(|_| "Could not read this note.".into()))
            .transpose()
    }
    pub fn save(&mut self, mut note: Note, expected: u32) -> Result<Note> {
        self.ensure_storage()?;
        note.validate()?;
        let tx = self
            .connection
            .transaction()
            .map_err(|_| "Could not save on this device. Retry or copy your text.".to_string())?;
        let tomb: bool = tx
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM tombstones WHERE id=?1)",
                [&note.note_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if tomb {
            return Err(
                "This note was permanently deleted. Recover its text as a new note.".into(),
            );
        }
        let current: Option<u32> = tx
            .query_row(
                "SELECT revision FROM notes WHERE id=?1",
                [&note.note_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if current.unwrap_or(0) != expected {
            return Err(
                "This note changed in another window. Copy your text before reloading.".into(),
            );
        }
        note.local_revision = expected + 1;
        let json = serde_json::to_string(&note).map_err(|e| e.to_string())?;
        tx.execute("INSERT INTO notes(id,revision,state,updated_at,snapshot) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state=excluded.state,updated_at=excluded.updated_at,snapshot=excluded.snapshot",params![note.note_id,note.local_revision,note.state,note.updated_at,json]).map_err(|_|"Could not save on this device. Retry or copy your text.".to_string())?;
        tx.commit()
            .map_err(|_| "Could not save on this device. Retry or copy your text.".to_string())?;
        Ok(note)
    }
    pub fn purge(&mut self, id: &str, expected: u32) -> Result<()> {
        self.ensure_storage()?;
        let tx = self.connection.transaction().map_err(|e| e.to_string())?;
        let revision: Option<u32> = tx
            .query_row("SELECT revision FROM notes WHERE id=?1", [id], |r| r.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        if revision != Some(expected) {
            return Err("The note changed. Refresh before deleting.".into());
        }
        tx.execute(
            "INSERT INTO tombstones(id,purged_at) VALUES(?1,?2) ON CONFLICT(id) DO NOTHING",
            params![id, now()],
        )
        .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM notes WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM placements WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }
    pub fn placements(&self) -> Result<Vec<Placement>> {
        self.ensure_storage()?;
        let mut s = self
            .connection
            .prepare("SELECT snapshot FROM placements ORDER BY id")
            .map_err(|e| e.to_string())?;
        let rows = s
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.map(|r| {
            serde_json::from_str(&r.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
        })
        .collect()
    }
    pub fn place(&self, p: &Placement) -> Result<()> {
        self.ensure_storage()?;
        if ![p.x, p.y, p.width, p.height].iter().all(|v| v.is_finite())
            || p.width <= 0.0
            || p.height <= 0.0
        {
            return Err("Invalid window bounds.".into());
        }
        self.connection.execute("INSERT INTO placements(id,snapshot) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET snapshot=excluded.snapshot",params![p.note_id,serde_json::to_string(p).map_err(|e|e.to_string())?]).map(|_|()).map_err(|e|e.to_string())
    }
    pub fn setting(&self, key: &str) -> Result<Option<Value>> {
        self.ensure_storage()?;
        let value: Option<String> = self
            .connection
            .query_row("SELECT value FROM settings WHERE key=?1", [key], |r| {
                r.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        value
            .map(|v| serde_json::from_str(&v).map_err(|e| e.to_string()))
            .transpose()
    }
    pub fn set_setting(&self, key: &str, value: Value) -> Result<()> {
        self.ensure_storage()?;
        self.connection.execute("INSERT INTO settings(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",params![key,value.to_string()]).map(|_|()).map_err(|e|e.to_string())
    }
    pub fn maintenance(&mut self) -> Result<()> {
        for note in self.list()? {
            if note.state == "trashed"
                && note
                    .purge_after
                    .as_ref()
                    .and_then(|p| chrono::DateTime::parse_from_rfc3339(p).ok())
                    .is_some_and(|p| p <= chrono::Utc::now())
            {
                self.purge(&note.note_id, note.local_revision)?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_selected_file_is_never_created_and_reconnected_file_keeps_acknowledged_data() {
        let folder = tempfile::tempdir().unwrap();
        let missing = folder.path().join("missing").join("notes.sqlite3");
        assert!(Database::open_existing(&missing).is_err());
        assert!(!missing.parent().unwrap().exists());
        let path = folder.path().join("notes.sqlite3");
        let mut db = Database::open(&path).unwrap();
        let mut draft = Note::blank();
        draft.body_markdown = "Synthetic acknowledged storage fixture".into();
        let saved = db.save(draft, 0).unwrap();
        let away = folder.path().join("disconnected.sqlite3");
        std::fs::rename(&path, &away).unwrap();
        assert!(db.get(&saved.note_id).is_err());
        assert!(db.save(saved.clone(), 1).is_err());
        assert!(db.purge(&saved.note_id, 1).is_err());
        assert!(db.set_setting("probe", Value::Bool(true)).is_err());
        assert!(!path.exists());
        std::fs::rename(&away, &path).unwrap();
        assert_eq!(
            db.get(&saved.note_id).unwrap().unwrap().body_markdown,
            saved.body_markdown
        );
        assert_eq!(db.save(saved, 1).unwrap().local_revision, 2);
    }
    #[cfg(unix)]
    #[test]
    fn replaced_file_rejects_writes_from_the_old_connection() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("notes.sqlite3");
        let mut db = Database::open(&path).unwrap();
        let saved = db.save(Note::blank(), 0).unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let replacement = elsewhere.path().join("replacement.sqlite3");
        let other = Database::open(&replacement).unwrap();
        drop(other);
        std::fs::rename(&replacement, &path).unwrap();
        assert!(db.save(saved, 1).unwrap_err().contains("replaced"));
        assert!(db.list().is_err());
    }
    #[test]
    fn save_reopen_revision_and_tombstone() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("notes.sqlite3");
        let mut db = Database::open(&path).unwrap();
        let mut note = Note::blank();
        note.body_markdown = "# Synthetic\nDo **this**. ##work".into();
        let n = db.save(note, 0).unwrap();
        assert_eq!(n.local_revision, 1);
        assert!(db.save(n.clone(), 0).is_err());
        drop(db);
        let mut db = Database::open(&path).unwrap();
        assert_eq!(
            db.get(&n.note_id).unwrap().unwrap().body_markdown,
            n.body_markdown
        );
        db.purge(&n.note_id, 1).unwrap();
        assert!(db.list().unwrap().is_empty());
        assert!(db.save(n, 0).unwrap_err().contains("permanently deleted"));
    }
    #[test]
    fn failed_transaction_preserves_last_acknowledged_text() {
        let folder = tempfile::tempdir().unwrap();
        let mut db = Database::open(&folder.path().join("test.sqlite3")).unwrap();
        let mut n = db.save(Note::blank(), 0).unwrap();
        db.connection.execute_batch("PRAGMA query_only=ON").unwrap();
        n.body_markdown = "Uncommitted synthetic draft".into();
        assert!(db.save(n.clone(), 1).is_err());
        assert_eq!(db.get(&n.note_id).unwrap().unwrap().body_markdown, "");
    }
    #[test]
    fn oversize_and_future_schema_do_not_modify_data() {
        let folder = tempfile::tempdir().unwrap();
        let mut db = Database::open(&folder.path().join("test.sqlite3")).unwrap();
        let mut n = Note::blank();
        n.body_markdown = "x".repeat(256 * 1024 + 1);
        assert!(db.save(n, 0).is_err());
        assert!(db.list().unwrap().is_empty());
        db.connection
            .execute_batch("PRAGMA user_version=2")
            .unwrap();
        drop(db);
        assert!(Database::open(&folder.path().join("test.sqlite3")).is_err());
    }
}
