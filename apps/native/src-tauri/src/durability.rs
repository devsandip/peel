// Synthetic-only process recovery fixtures for the shipped Rust repository.
use crate::db::{Database, Note, Placement};
use rusqlite::params;
use serde_json::json;
use std::{
    io::{BufRead, BufReader, Write},
    os::unix::process::ExitStatusExt,
    path::Path,
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::Duration,
};

const NOTE_ID: &str = "native-durability-fixture";
const BODY: &str = "# Synthetic recovery\nKeep **acknowledged** source.\n- [x] Durable\n1. First\n##fixture\nUnicode: \u{03bb}\u{4E2D}";
const READY: &str = "PEEL_SYNTHETIC_NATIVE_RECOVERY_READY";

fn note() -> Note {
    let mut note = Note::blank();
    note.note_id = NOTE_ID.into();
    note.body_markdown = BODY.into();
    note
}
fn placement() -> Placement {
    Placement {
        note_id: NOTE_ID.into(),
        x: 123.0,
        y: 234.0,
        width: 300.0,
        height: 320.0,
        pinned: true,
        always_on_top: false,
        display_id: Some("synthetic-display".into()),
    }
}
fn integrity(database: &Database) {
    let result: String = database
        .connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .unwrap();
    assert_eq!(result, "ok");
}

#[test]
#[ignore = "Child fixture, launched only by marker-verified parent recovery checks"]
fn crash_fixture() {
    let folder = std::env::var_os("PEEL_SYNTHETIC_NATIVE_FOLDER")
        .expect("Only the synthetic parent may launch this fixture");
    let folder = Path::new(&folder);
    let token = std::env::var("PEEL_SYNTHETIC_NATIVE_TOKEN").unwrap();
    assert_eq!(token.len(), 36);
    assert_eq!(
        std::fs::read_to_string(folder.join("synthetic-fixture.marker")).unwrap(),
        token
    );
    let scenario = std::env::var("PEEL_SYNTHETIC_NATIVE_SCENARIO").unwrap();
    assert!(["committed", "uncommitted", "purged"].contains(&scenario.as_str()));
    let path = folder.join("notes.sqlite3");
    assert!(
        !path.exists(),
        "The child only creates a fresh fixture database"
    );
    let mut database = Database::open(&path).unwrap();
    let saved = database.save(note(), 0).unwrap();
    database.place(&placement()).unwrap();
    database
        .set_setting("synthetic-recovery", json!({ "stage": "acknowledged" }))
        .unwrap();
    let wal = folder.join("notes.sqlite3-wal");
    let committed_bytes = std::fs::metadata(&wal).unwrap().len();
    match scenario.as_str() {
        "committed" => {}
        "uncommitted" => {
            database
                .connection
                .execute_batch("PRAGMA cache_size=4; PRAGMA cache_spill=ON; BEGIN IMMEDIATE")
                .unwrap();
            let mut pending = saved;
            pending.local_revision = 2;
            pending.body_markdown = "Synthetic unacknowledged replacement. ".repeat(6000);
            database
                .connection
                .execute(
                    "UPDATE notes SET revision=2,snapshot=?1 WHERE id=?2",
                    params![serde_json::to_string(&pending).unwrap(), NOTE_ID],
                )
                .unwrap();
            database
                .connection
                .execute_batch("DELETE FROM placements; UPDATE settings SET value='null';")
                .unwrap();
            database
                .connection
                .execute(
                    "INSERT INTO tombstones(id,purged_at) VALUES(?1,?2)",
                    params![NOTE_ID, "2026-10-27T00:00:00.000Z"],
                )
                .unwrap();
            assert!(
                std::fs::metadata(&wal).unwrap().len() > committed_bytes,
                "The uncommitted fixture must spill actual WAL pages before termination"
            );
        }
        "purged" => database.purge(NOTE_ID, 1).unwrap(),
        _ => unreachable!(),
    }
    println!("{READY}");
    std::io::stdout().flush().unwrap();
    // The parent must terminate the live process; a clean connection drop would weaken this check.
    loop {
        std::thread::park();
    }
}

struct Reap(Child);
impl Drop for Reap {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
fn kill_at_marker(folder: &Path, scenario: &str) {
    let token = uuid::Uuid::new_v4().to_string();
    std::fs::write(folder.join("synthetic-fixture.marker"), &token).unwrap();
    let mut child = Reap(
        Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "durability::crash_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("PEEL_SYNTHETIC_NATIVE_FOLDER", folder)
            .env("PEEL_SYNTHETIC_NATIVE_TOKEN", token)
            .env("PEEL_SYNTHETIC_NATIVE_SCENARIO", scenario)
            .stdout(Stdio::piped())
            .spawn()
            .unwrap(),
    );
    let output = child.0.stdout.take().unwrap();
    let (sender, receiver) = mpsc::sync_channel(1);
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(output).lines() {
            if line.is_ok_and(|line| line.ends_with(READY)) {
                let _ = sender.send(true);
                return;
            }
        }
        let _ = sender.send(false);
    });
    assert!(receiver
        .recv_timeout(Duration::from_secs(10))
        .expect("Synthetic child did not reach the recovery boundary"));
    child.0.kill().unwrap();
    assert_eq!(child.0.wait().unwrap().signal(), Some(9));
    reader.join().unwrap();
}
fn recovered(folder: &Path) -> Database {
    let database = Database::open_existing(&folder.join("notes.sqlite3")).unwrap();
    integrity(&database);
    database
}
fn acknowledged(database: &Database) {
    let note = database.get(NOTE_ID).unwrap().unwrap();
    assert!(
        note.body_markdown == BODY,
        "Acknowledged source must match exactly"
    );
    assert_eq!(note.local_revision, 1);
    let positions = database.placements().unwrap();
    assert_eq!(positions.len(), 1);
    assert_eq!(positions[0].x, placement().x);
    assert!(positions[0].pinned);
    assert_eq!(
        database.setting("synthetic-recovery").unwrap(),
        Some(json!({ "stage": "acknowledged" }))
    );
}
#[test]
fn acknowledged_native_saves_survive_sigkill() {
    let folder = tempfile::tempdir().unwrap();
    kill_at_marker(folder.path(), "committed");
    acknowledged(&recovered(folder.path()));
}
#[test]
fn uncommitted_replacement_rolls_back_after_sigkill() {
    let folder = tempfile::tempdir().unwrap();
    kill_at_marker(folder.path(), "uncommitted");
    let mut database = recovered(folder.path());
    acknowledged(&database);
    let next = database.save(note(), 1).unwrap();
    assert_eq!(
        next.local_revision, 2,
        "Uncommitted tombstone must not survive"
    );
}
#[test]
fn acknowledged_purge_survives_sigkill_and_rejects_stale_resurrection() {
    let folder = tempfile::tempdir().unwrap();
    kill_at_marker(folder.path(), "purged");
    let mut database = recovered(folder.path());
    assert!(database.get(NOTE_ID).unwrap().is_none());
    assert!(database.placements().unwrap().is_empty());
    assert!(database.save(note(), 1).is_err());
    assert!(database.save(note(), 0).is_err());
}
#[test]
fn sqlite_page_limit_failure_preserves_acknowledged_source_and_retry() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("notes.sqlite3");
    let mut database = Database::open(&path).unwrap();
    let saved = database.save(note(), 0).unwrap();
    let original_limit: i64 = database
        .connection
        .pragma_query_value(None, "max_page_count", |row| row.get(0))
        .unwrap();
    let pages: i64 = database
        .connection
        .pragma_query_value(None, "page_count", |row| row.get(0))
        .unwrap();
    database
        .connection
        .pragma_update(None, "max_page_count", pages)
        .unwrap();
    let full = database.connection.execute(
        "INSERT INTO settings(key,value) VALUES('synthetic-full-probe',?1)",
        ["x".repeat(256 * 1024)],
    );
    assert!(
        matches!(full, Err(rusqlite::Error::SqliteFailure(error, _)) if error.code == rusqlite::ErrorCode::DiskFull)
    );
    let mut replacement = saved.clone();
    replacement.body_markdown = "Synthetic large retry fixture. ".repeat(7000);
    assert!(database.save(replacement.clone(), 1).is_err());
    let previous = database.get(NOTE_ID).unwrap().unwrap();
    assert!(previous.body_markdown == BODY);
    assert_eq!(previous.local_revision, 1);
    database
        .connection
        .pragma_update(None, "max_page_count", original_limit)
        .unwrap();
    let next = database.save(replacement.clone(), 1).unwrap();
    assert_eq!(next.local_revision, 2);
    drop(database);
    let reopened = Database::open_existing(&path).unwrap();
    assert!(reopened.get(NOTE_ID).unwrap().unwrap().body_markdown == replacement.body_markdown);
    integrity(&reopened);
}
#[test]
fn one_hundred_native_repository_reopen_cycles_keep_exact_revisions() {
    let folder = tempfile::tempdir().unwrap();
    let path = folder.path().join("notes.sqlite3");
    let mut database = Database::open(&path).unwrap();
    let mut current = database.save(note(), 0).unwrap();
    drop(database);
    for cycle in 1..=100 {
        let mut database = Database::open_existing(&path).unwrap();
        let restored = database.get(NOTE_ID).unwrap().unwrap();
        assert!(restored.body_markdown == current.body_markdown);
        assert_eq!(restored.local_revision, current.local_revision);
        current.body_markdown = format!("{BODY}\nSynthetic reopen cycle {cycle}.");
        current = database
            .save(current.clone(), current.local_revision)
            .unwrap();
        assert_eq!(current.local_revision, cycle + 1);
    }
    let reopened = Database::open_existing(&path).unwrap();
    assert!(reopened.get(NOTE_ID).unwrap().unwrap().body_markdown == current.body_markdown);
    integrity(&reopened);
}
