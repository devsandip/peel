use crate::{db::Result, local_library::LocalLibrary, operations::Coordinator};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryInfo {
    pub available: bool,
    pub folder: Option<String>,
    pub previous_folder: Option<String>,
    pub requires_restart: bool,
    pub error: Option<String>,
}
pub struct Controller {
    pub library: Option<LocalLibrary>,
    pub root: PathBuf,
    pub error: Option<String>,
    pub operations: Coordinator,
    pub window_changes: usize,
    pub destination: Option<PathBuf>,
    pub reply: Option<tauri::async_runtime::Sender<Result<LibraryInfo>>>,
}
impl Controller {
    pub fn open(root: PathBuf) -> Self {
        let (library, error) = match LocalLibrary::open(&root) {
            Ok(library) => (Some(library), None),
            Err(error) => (None, Some(error)),
        };
        Self {
            library,
            root,
            error,
            operations: Coordinator::default(),
            window_changes: 0,
            destination: None,
            reply: None,
        }
    }
    pub fn info(&self) -> LibraryInfo {
        let current = self.library.as_ref();
        let storage_error = current.and_then(|library| library.database.ensure_storage().err());
        LibraryInfo {
            available: current.is_some() && storage_error.is_none(),
            folder: current.map(|library| library.folder().to_string_lossy().into()),
            previous_folder: current
                .and_then(|library| library.previous_folder())
                .map(|path| path.to_string_lossy().into()),
            requires_restart: current.is_some_and(|library| library.database.is_blocked()),
            error: storage_error.or_else(|| self.error.clone()),
        }
    }
    pub fn retry(&mut self) -> Result<LibraryInfo> {
        self.operations.require_idle()?;
        if self.library.is_none() {
            match LocalLibrary::open(&self.root) {
                Ok(library) => {
                    self.library = Some(library);
                    self.error = None;
                }
                Err(error) => {
                    self.error = Some(error.clone());
                    return Err(error);
                }
            }
        }
        let info = self.info();
        if info.available {
            Ok(info)
        } else {
            Err(info
                .error
                .unwrap_or("Reconnect the notes folder and reopen Peel.".into()))
        }
    }
    pub fn begin_choice(&mut self, id: String) -> Result<()> {
        if self.window_changes != 0 {
            return Err("A note window is opening or closing. Try again in a moment.".into());
        }
        if !self.info().available {
            return Err("Reconnect the selected library before choosing another folder.".into());
        }
        self.operations.choose(id)
    }
    pub fn begin_window_change(&mut self) -> Result<()> {
        self.operations.require_idle()?;
        self.window_changes = self
            .window_changes
            .checked_add(1)
            .ok_or("Too many pending windows.")?;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Note;
    #[test]
    fn unavailable_selected_storage_is_recoverable_without_default_fallback() {
        let root = tempfile::tempdir().unwrap();
        let destination = tempfile::tempdir().unwrap();
        let mut controller = Controller::open(root.path().into());
        let mut note = Note::blank();
        note.body_markdown = "Synthetic cold recovery fixture".into();
        let saved = controller
            .library
            .as_mut()
            .unwrap()
            .database
            .save(note, 0)
            .unwrap();
        controller
            .library
            .as_mut()
            .unwrap()
            .relocate(destination.path())
            .unwrap();
        drop(controller);
        let path = destination.path().join("notes.sqlite3");
        let away = destination.path().join("disconnected.sqlite3");
        std::fs::rename(&path, &away).unwrap();
        let mut controller = Controller::open(root.path().into());
        assert!(!controller.info().available);
        assert!(controller.library.is_none());
        assert!(controller.retry().is_err());
        assert!(!path.exists());
        std::fs::rename(&away, &path).unwrap();
        assert!(controller.retry().unwrap().available);
        assert_eq!(
            controller
                .library
                .as_ref()
                .unwrap()
                .database
                .get(&saved.note_id)
                .unwrap()
                .unwrap()
                .body_markdown,
            saved.body_markdown
        );
    }
    #[test]
    fn window_changes_and_unavailable_libraries_cannot_start_a_selection() {
        let root = tempfile::tempdir().unwrap();
        let mut controller = Controller::open(root.path().into());
        controller.begin_window_change().unwrap();
        assert!(controller.begin_choice("move".into()).is_err());
        controller.window_changes -= 1;
        controller.begin_choice("move".into()).unwrap();
        assert!(controller.begin_window_change().is_err());
        let bad = tempfile::tempdir().unwrap();
        std::fs::write(
            bad.path().join("library-location.json"),
            b"Synthetic bad selection",
        )
        .unwrap();
        let mut controller = Controller::open(bad.path().into());
        assert!(controller.begin_choice("other".into()).is_err());
        assert!(!bad.path().join("notes.sqlite3").exists());
    }
}
