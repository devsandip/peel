use crate::db::Result;
use std::collections::HashSet;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Quit,
    Relocate,
}
#[derive(Debug)]
enum State {
    Idle,
    Choosing(String),
    Waiting {
        id: String,
        kind: Kind,
        participants: HashSet<String>,
        pending: HashSet<String>,
    },
    Working {
        id: String,
        kind: Kind,
    },
    RestartRequired,
}
#[derive(Debug, PartialEq)]
pub enum Decision {
    Ignored,
    Waiting,
    Cancelled(Kind),
    Ready(Kind),
}
pub struct Coordinator {
    state: State,
}
impl Default for Coordinator {
    fn default() -> Self {
        Self { state: State::Idle }
    }
}
impl Coordinator {
    pub fn require_idle(&self) -> Result<()> {
        if matches!(self.state, State::Idle) {
            Ok(())
        } else {
            Err("Peel is finishing a storage operation. Please wait or complete the recovery action.".into())
        }
    }
    pub fn permits_save(&self, window: &str) -> Result<()> {
        if matches!(self.state, State::Idle | State::Choosing(_))
            || matches!(&self.state, State::Waiting { pending, .. } if pending.contains(window))
        {
            Ok(())
        } else {
            Err("This editor is frozen while Peel completes its save operation.".into())
        }
    }
    pub fn choose(&mut self, id: String) -> Result<()> {
        self.require_idle()?;
        self.state = State::Choosing(id);
        Ok(())
    }
    pub fn cancel_choice(&mut self, id: &str) -> bool {
        if matches!(&self.state, State::Choosing(current) if current == id) {
            self.state = State::Idle;
            true
        } else {
            false
        }
    }
    pub fn begin(&mut self, id: String, kind: Kind, windows: HashSet<String>) -> Result<bool> {
        let allowed = match kind {
            Kind::Quit => matches!(self.state, State::Idle | State::RestartRequired),
            Kind::Relocate => matches!(&self.state, State::Choosing(current) if current == &id),
        };
        if !allowed {
            return Err("Another storage operation is already in progress.".into());
        }
        let ready = windows.is_empty();
        self.state = if ready {
            State::Working { id, kind }
        } else {
            State::Waiting {
                id,
                kind,
                participants: windows.clone(),
                pending: windows,
            }
        };
        Ok(ready)
    }
    pub fn acknowledge(&mut self, id: &str, kind: Kind, window: &str, success: bool) -> Decision {
        let State::Waiting {
            id: current,
            kind: expected,
            pending,
            ..
        } = &mut self.state
        else {
            return Decision::Ignored;
        };
        if current != id || *expected != kind || !pending.contains(window) {
            return Decision::Ignored;
        }
        if !success {
            self.state = State::Idle;
            return Decision::Cancelled(kind);
        }
        pending.remove(window);
        if !pending.is_empty() {
            return Decision::Waiting;
        }
        self.state = State::Working {
            id: id.into(),
            kind,
        };
        Decision::Ready(kind)
    }
    pub fn cancel_waiting(&mut self, id: &str) -> Option<Kind> {
        if let State::Waiting {
            id: current, kind, ..
        } = &self.state
        {
            if current == id {
                let result = *kind;
                self.state = State::Idle;
                return Some(result);
            }
        }
        None
    }
    pub fn window_lost(&mut self, window: &str) -> Option<(String, Kind)> {
        let result = match &self.state {
            State::Waiting {
                id,
                kind,
                participants,
                ..
            } if participants.contains(window) => Some((id.clone(), *kind)),
            State::Choosing(id) => Some((id.clone(), Kind::Relocate)),
            _ => None,
        };
        if result.is_some() {
            self.state = State::Idle;
        }
        result
    }
    pub fn finish_move(&mut self, id: &str, restart: bool) -> bool {
        if !matches!(&self.state, State::Working { id: current, kind: Kind::Relocate } if current == id)
        {
            return false;
        }
        self.state = if restart {
            State::RestartRequired
        } else {
            State::Idle
        };
        true
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn windows() -> HashSet<String> {
        ["library".into(), "note-a".into()].into()
    }
    #[test]
    fn every_participant_commits_once_and_stale_or_foreign_acknowledgements_do_nothing() {
        let mut c = Coordinator::default();
        c.choose("move".into()).unwrap();
        assert!(!c.begin("move".into(), Kind::Relocate, windows()).unwrap());
        assert!(c.permits_save("library").is_ok());
        for (id, kind, window) in [
            ("old", Kind::Relocate, "library"),
            ("move", Kind::Quit, "library"),
            ("move", Kind::Relocate, "unknown"),
        ] {
            assert_eq!(c.acknowledge(id, kind, window, true), Decision::Ignored);
        }
        assert_eq!(
            c.acknowledge("move", Kind::Relocate, "library", true),
            Decision::Waiting
        );
        assert!(c.permits_save("library").is_err());
        assert!(c.permits_save("note-a").is_ok());
        assert_eq!(
            c.acknowledge("move", Kind::Relocate, "library", true),
            Decision::Ignored
        );
        assert_eq!(
            c.acknowledge("move", Kind::Relocate, "note-a", true),
            Decision::Ready(Kind::Relocate)
        );
        assert!(c.permits_save("note-a").is_err());
        assert!(c.cancel_waiting("move").is_none());
        assert!(c.finish_move("move", false));
        assert!(c.require_idle().is_ok());
    }
    #[test]
    fn failure_timeout_and_window_loss_release_waiting_rounds_without_completing_them() {
        let mut c = Coordinator::default();
        c.begin("quit".into(), Kind::Quit, windows()).unwrap();
        assert_eq!(
            c.acknowledge("quit", Kind::Quit, "note-a", false),
            Decision::Cancelled(Kind::Quit)
        );
        assert!(c.require_idle().is_ok());
        c.begin("again".into(), Kind::Quit, windows()).unwrap();
        assert!(c.cancel_waiting("old").is_none());
        assert_eq!(c.cancel_waiting("again"), Some(Kind::Quit));
        c.choose("move".into()).unwrap();
        c.begin("move".into(), Kind::Relocate, windows()).unwrap();
        c.acknowledge("move", Kind::Relocate, "note-a", true);
        assert_eq!(
            c.window_lost("note-a"),
            Some(("move".into(), Kind::Relocate))
        );
        assert!(c.require_idle().is_ok());
    }
    #[test]
    fn picker_competing_operations_and_restart_only_recovery_preserve_the_barrier() {
        let mut c = Coordinator::default();
        c.choose("first".into()).unwrap();
        assert!(c.choose("second".into()).is_err());
        assert!(c.begin("quit".into(), Kind::Quit, windows()).is_err());
        assert!(c.permits_save("library").is_ok());
        assert!(!c.cancel_choice("old"));
        assert!(c.cancel_choice("first"));
        c.choose("move".into()).unwrap();
        assert!(c
            .begin("move".into(), Kind::Relocate, HashSet::new())
            .unwrap());
        assert!(c.window_lost("library").is_none());
        assert!(!c.finish_move("old", false));
        assert!(c.finish_move("move", true));
        assert!(c.require_idle().is_err());
        assert!(c.permits_save("library").is_err());
        assert!(c.choose("other".into()).is_err());
        assert!(!c.begin("clean-quit".into(), Kind::Quit, windows()).unwrap());
    }
}
