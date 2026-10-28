use crate::db::Result;
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    NotRegistered,
    Enabled,
    RequiresApproval,
    NotFound,
    Unavailable,
    Unsupported,
    Development,
    Isolated,
}
impl Status {
    fn can_change(self) -> bool {
        !matches!(self, Self::Unsupported | Self::Development | Self::Isolated)
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub status: Status,
    pub can_change: bool,
    pub error: Option<String>,
}
pub trait Backend {
    fn status(&mut self) -> Status;
    fn change(&mut self, enable: bool) -> Result<()>;
    fn open_settings(&mut self) -> Result<()>;
}
// No persisted Boolean: an external System Settings change must remain authoritative.
pub struct LoginItem {
    blocked: Option<Status>,
}
impl LoginItem {
    pub fn current() -> Self {
        Self {
            blocked: if std::env::var_os("PEEL_DATA_DIR").is_some() {
                Some(Status::Isolated)
            } else if cfg!(debug_assertions) {
                Some(Status::Development)
            } else if !cfg!(target_os = "macos") {
                Some(Status::Unsupported)
            } else {
                None
            },
        }
    }
    pub fn view(&self, backend: &mut impl Backend) -> View {
        let status = self.blocked.unwrap_or_else(|| backend.status());
        View {
            status,
            can_change: status.can_change(),
            error: None,
        }
    }
    pub fn change(&self, enable: bool, backend: &mut impl Backend) -> View {
        let before = self.view(backend);
        if !before.can_change {
            return before;
        }
        if (enable && matches!(before.status, Status::Enabled | Status::RequiresApproval))
            || (!enable && before.status == Status::NotRegistered)
        {
            return before;
        }
        let result = backend.change(enable);
        let mut after = self.view(backend);
        after.error = result.err();
        if after.error.is_none()
            && if enable {
                !matches!(after.status, Status::Enabled | Status::RequiresApproval)
            } else {
                after.status != Status::NotRegistered
            }
        {
            after.error = Some("macOS has not confirmed the change. Check again or review Login Items in System Settings.".into());
        }
        after
    }
    pub fn open_settings(&self, backend: &mut impl Backend) -> Result<()> {
        if !self.view(backend).can_change {
            return Err(
                "Login item settings are unavailable in this build or isolated run.".into(),
            );
        }
        backend.open_settings()
    }
}

pub struct Os {
    pub app: tauri::AppHandle,
}
#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn peel_login_item_status() -> i32;
    fn peel_login_item_change(enable: i32) -> i32;
    fn peel_login_item_open_settings() -> i32;
}
impl Os {
    #[cfg(target_os = "macos")]
    fn dispatch(&self, operation: impl FnOnce() -> i32 + Send + 'static) -> Result<i32> {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        self.app
            .run_on_main_thread(move || {
                let _ = sender.send(operation());
            })
            .map_err(|_| "macOS login settings could not be reached.".to_string())?;
        receiver
            .recv()
            .map_err(|_| "macOS login settings did not respond.".into())
    }
}
impl Backend for Os {
    fn status(&mut self) -> Status {
        #[cfg(target_os = "macos")]
        {
            // Each C call owns an autorelease pool; only integer values cross the bridge.
            match self.dispatch(|| unsafe { peel_login_item_status() }) {
                Ok(0) => Status::NotRegistered,
                Ok(1) => Status::Enabled,
                Ok(2) => Status::RequiresApproval,
                Ok(3) => Status::NotFound,
                Ok(6) => Status::Development,
                Ok(7) => Status::Isolated,
                _ => Status::Unavailable,
            }
        }
        #[cfg(not(target_os = "macos"))]
        Status::Unsupported
    }
    fn change(&mut self, enable: bool) -> Result<()> {
        #[cfg(target_os = "macos")]
        if self.dispatch(move || unsafe { peel_login_item_change(i32::from(enable)) })? != 0 {
            return Ok(());
        }
        Err("macOS could not change the login item. Use the installed, signed Synkies app and review Login Items in System Settings, then check again.".into())
    }
    fn open_settings(&mut self) -> Result<()> {
        #[cfg(target_os = "macos")]
        if self.dispatch(|| unsafe { peel_login_item_open_settings() })? != 0 {
            return Ok(());
        }
        Err(
            "Login Items could not be opened. Open System Settings, General, Login Items manually."
                .into(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fake {
        status: Status,
        outcome: Status,
        fail: bool,
        reads: usize,
        changes: Vec<bool>,
        opened: usize,
    }
    impl Fake {
        fn new() -> Self {
            Self {
                status: Status::NotRegistered,
                outcome: Status::Enabled,
                fail: false,
                reads: 0,
                changes: vec![],
                opened: 0,
            }
        }
    }
    impl Backend for Fake {
        fn status(&mut self) -> Status {
            self.reads += 1;
            self.status
        }
        fn change(&mut self, enable: bool) -> Result<()> {
            self.changes.push(enable);
            if self.fail {
                Err("Synthetic OS failure".into())
            } else {
                self.status = self.outcome;
                Ok(())
            }
        }
        fn open_settings(&mut self) -> Result<()> {
            self.opened += 1;
            Ok(())
        }
    }
    #[test]
    fn queries_never_register_and_changes_report_observed_os_state() {
        let item = LoginItem { blocked: None };
        let mut os = Fake::new();
        assert_eq!(item.view(&mut os).status, Status::NotRegistered);
        assert!(os.changes.is_empty());
        assert_eq!(item.change(true, &mut os).status, Status::Enabled);
        item.change(true, &mut os);
        assert_eq!(os.changes, [true]);
        os.outcome = Status::NotRegistered;
        assert_eq!(item.change(false, &mut os).status, Status::NotRegistered);
        item.change(false, &mut os);
        assert_eq!(os.changes, [true, false]);
        os.status = Status::RequiresApproval;
        assert_eq!(item.view(&mut os).status, Status::RequiresApproval);
    }
    #[test]
    fn approval_is_not_enabled_and_no_automatic_reregistration_overrides_it() {
        let item = LoginItem { blocked: None };
        let mut os = Fake::new();
        os.outcome = Status::RequiresApproval;
        let view = item.change(true, &mut os);
        assert_eq!(view.status, Status::RequiresApproval);
        assert!(view.error.is_none());
        item.change(true, &mut os);
        assert_eq!(os.changes, [true]);
        item.open_settings(&mut os).unwrap();
        assert_eq!(os.opened, 1);
        os.outcome = Status::NotRegistered;
        assert_eq!(item.change(false, &mut os).status, Status::NotRegistered);
    }
    #[test]
    fn failures_keep_actual_state_and_unconfirmed_success_is_visible() {
        let item = LoginItem { blocked: None };
        let mut os = Fake::new();
        os.fail = true;
        let view = item.change(true, &mut os);
        assert_eq!(view.status, Status::NotRegistered);
        assert!(view.error.is_some());
        os.fail = false;
        os.outcome = Status::NotRegistered;
        assert!(item.change(true, &mut os).error.is_some());
        os.status = Status::Enabled;
        os.outcome = Status::RequiresApproval;
        let view = item.change(false, &mut os);
        assert_eq!(view.status, Status::RequiresApproval);
        assert!(view.error.is_some());
    }
    #[test]
    fn blocked_runs_do_not_even_query_or_open_real_os_settings() {
        for blocked in [Status::Development, Status::Isolated, Status::Unsupported] {
            let item = LoginItem {
                blocked: Some(blocked),
            };
            let mut os = Fake::new();
            assert!(!item.view(&mut os).can_change);
            assert_eq!(item.change(true, &mut os).status, blocked);
            assert!(item.open_settings(&mut os).is_err());
            assert_eq!(os.reads, 0);
            assert!(os.changes.is_empty());
            assert_eq!(os.opened, 0);
        }
    }
    #[test]
    #[cfg(target_os = "macos")]
    fn compiled_bridge_rejects_the_unbundled_test_executable() {
        // Check the guard before any mutation entry point. No SMAppService call is reached.
        let status = unsafe { peel_login_item_status() };
        assert!(matches!(status, 6 | 7));
        assert_eq!(unsafe { peel_login_item_change(1) }, 0);
        assert_eq!(unsafe { peel_login_item_open_settings() }, 0);
    }
}
