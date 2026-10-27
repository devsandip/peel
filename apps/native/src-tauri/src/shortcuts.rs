use crate::db::Result;
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{Arc, RwLock},
};
use tauri_plugin_global_shortcut::Shortcut;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Action {
    Capture,
    Left,
    Right,
    Top,
    Bottom,
}
pub const ACTIONS: [Action; 5] = [
    Action::Capture,
    Action::Left,
    Action::Right,
    Action::Top,
    Action::Bottom,
];
impl Action {
    pub fn menu_id(self) -> &'static str {
        match self {
            Self::Capture => "new",
            Self::Left => "arrange-left",
            Self::Right => "arrange-right",
            Self::Top => "arrange-top",
            Self::Bottom => "arrange-bottom",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub control: bool,
    pub option: bool,
    pub command: bool,
    pub shift: bool,
    pub key: String,
}
impl Binding {
    pub fn accelerator(&self) -> String {
        let mut parts = Vec::new();
        if self.control {
            parts.push("Ctrl");
        }
        if self.option {
            parts.push("Alt");
        }
        if self.command {
            parts.push("Super");
        }
        if self.shift {
            parts.push("Shift");
        }
        parts.push(&self.key);
        parts.join("+")
    }
    fn shortcut(&self) -> Result<Shortcut> {
        let letter = self
            .key
            .strip_prefix("Key")
            .is_some_and(|s| s.len() == 1 && s.as_bytes()[0].is_ascii_uppercase());
        let digit = self
            .key
            .strip_prefix("Digit")
            .is_some_and(|s| s.len() == 1 && s.as_bytes()[0].is_ascii_digit());
        let function = self
            .key
            .strip_prefix('F')
            .and_then(|n| n.parse::<u8>().ok())
            .is_some_and(|n| (1..=20).contains(&n) && self.key == format!("F{n}"));
        let arrow =
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].contains(&self.key.as_str());
        if !letter && !digit && !function && !arrow {
            return Err("Choose a letter, number, arrow or F1 to F20 key.".into());
        }
        let modifiers = [self.control, self.option, self.command, self.shift]
            .into_iter()
            .filter(|v| *v)
            .count();
        if !function && (modifiers < 2 || (!self.control && !self.command)) {
            return Err("Use at least two modifiers, including Control or Command, to keep ordinary typing available.".into());
        }
        if self.command
            && !self.control
            && !self.option
            && [
                "KeyA", "KeyB", "KeyC", "KeyF", "KeyH", "KeyL", "KeyM", "KeyN", "KeyO", "KeyP",
                "KeyQ", "KeyS", "KeyV", "KeyW", "KeyX", "KeyY", "KeyZ",
            ]
            .contains(&self.key.as_str())
        {
            return Err(
                "This combination is reserved for standard editing or app commands.".into(),
            );
        }
        self.accelerator()
            .parse()
            .map_err(|_| "The selected shortcut is unsupported.".into())
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub schema_version: u32,
    pub bindings: BTreeMap<Action, Option<Binding>>,
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            schema_version: 1,
            bindings: ACTIONS
                .into_iter()
                .zip(["KeyN", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"])
                .map(|(action, key)| {
                    (
                        action,
                        Some(Binding {
                            control: true,
                            option: true,
                            command: action != Action::Capture,
                            shift: false,
                            key: key.into(),
                        }),
                    )
                })
                .collect(),
        }
    }
}
impl Preferences {
    fn keys(&self) -> Result<BTreeMap<u32, Shortcut>> {
        if self.schema_version != 1
            || self.bindings.len() != ACTIONS.len()
            || ACTIONS
                .iter()
                .any(|action| !self.bindings.contains_key(action))
        {
            return Err("Unrecognized shortcut settings. All five actions are required.".into());
        }
        let mut keys = BTreeMap::new();
        for binding in self.bindings.values().flatten() {
            let shortcut = binding.shortcut()?;
            if keys.insert(shortcut.id(), shortcut).is_some() {
                return Err("Each global shortcut must use a different combination.".into());
            }
        }
        Ok(keys)
    }
    fn routing(&self) -> BTreeMap<u32, Action> {
        self.bindings
            .iter()
            .filter_map(|(action, binding)| {
                binding
                    .as_ref()
                    .and_then(|b| b.shortcut().ok())
                    .map(|s| (s.id(), *action))
            })
            .collect()
    }
}
pub type Routes = Arc<RwLock<BTreeMap<u32, Action>>>;
pub trait Backend {
    fn register(&mut self, key: Shortcut) -> Result<()>;
    fn unregister(&mut self, key: Shortcut) -> Result<()>;
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub active: bool,
    pub error: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub preferences: Preferences,
    pub defaults: Preferences,
    pub status: BTreeMap<Action, Status>,
    pub cleanup_required: bool,
    pub warning: Option<String>,
}
pub struct Shortcuts {
    pub routes: Routes,
    pub preferences: Preferences,
    registered: BTreeMap<u32, Shortcut>,
    uncertain: BTreeSet<u32>,
    warning: Option<String>,
}
impl Shortcuts {
    pub fn new(saved: Option<serde_json::Value>) -> Self {
        let (preferences, warning) = match saved {
            None => (Preferences::default(), None),
            Some(value) => match serde_json::from_value::<Preferences>(value)
                .ok()
                .filter(|preferences| preferences.keys().is_ok())
            {
                Some(preferences) => (preferences, None),
                None => (
                    Preferences::default(),
                    Some("Saved shortcut settings need review. Defaults are being used without replacing the saved value.".into()),
                ),
            },
        };
        Self {
            routes: Arc::new(RwLock::new(preferences.routing())),
            preferences,
            registered: BTreeMap::new(),
            uncertain: BTreeSet::new(),
            warning,
        }
    }
    // Only successful OS calls change our registration inventory. Routes are swapped separately.
    fn reconcile(
        &mut self,
        desired: &BTreeMap<u32, Shortcut>,
        backend: &mut impl Backend,
        cleanup_on_error: bool,
    ) -> bool {
        let mut okay = true;
        for id in self.uncertain.clone() {
            if let Some(key) = self.registered.get(&id).copied() {
                if backend.unregister(key).is_ok() {
                    self.registered.remove(&id);
                    self.uncertain.remove(&id);
                } else {
                    okay = false;
                }
            }
        }
        for (id, key) in desired {
            if !self.registered.contains_key(id) {
                if backend.register(*key).is_ok() {
                    self.registered.insert(*id, *key);
                } else {
                    okay = false;
                }
            }
        }
        if okay || cleanup_on_error {
            for (id, key) in self.registered.clone() {
                if !desired.contains_key(&id) && !self.uncertain.contains(&id) {
                    if backend.unregister(key).is_ok() {
                        self.registered.remove(&id);
                    } else {
                        self.uncertain.insert(id);
                        okay = false;
                    }
                }
            }
        }
        okay
    }
    pub fn activate(&mut self, backend: &mut impl Backend) -> View {
        let keys = self.preferences.keys().expect("validated preferences");
        self.reconcile(&keys, backend, true);
        self.view()
    }
    pub fn apply(
        &mut self,
        next: Preferences,
        backend: &mut impl Backend,
        persist: impl FnOnce(&Preferences) -> Result<()>,
    ) -> Result<View> {
        let desired = next.keys()?;
        let old = self.preferences.keys()?;
        if !self.reconcile(&desired, backend, false) {
            self.reconcile(&old, backend, true);
            return Err("The shortcut could not be activated. Previous settings were kept; review their status and use the File or Window menu.".into());
        }
        if let Err(error) = persist(&next) {
            self.reconcile(&old, backend, true);
            return Err(format!(
                "Shortcut settings were not saved. Previous settings were kept. {error}"
            ));
        }
        *self.routes.write().unwrap_or_else(|e| e.into_inner()) = next.routing();
        self.preferences = next;
        self.warning = None;
        Ok(self.view())
    }
    pub fn reload(&mut self, saved: Option<serde_json::Value>, backend: &mut impl Backend) -> View {
        let loaded = Self::new(saved);
        let desired = loaded.preferences.keys().expect("validated preferences");
        self.reconcile(&desired, backend, true);
        *self.routes.write().unwrap_or_else(|e| e.into_inner()) = loaded.preferences.routing();
        self.preferences = loaded.preferences;
        self.warning = loaded.warning;
        self.view()
    }
    pub fn warn(&mut self, message: &str) {
        self.warning = Some(message.into());
    }
    pub fn view(&self) -> View {
        let wanted = self.preferences.keys().expect("validated preferences");
        let status = ACTIONS
            .into_iter()
            .map(|action| {
                let key = self.preferences.bindings[&action]
                    .as_ref()
                    .and_then(|binding| binding.shortcut().ok());
                let active = key.is_some_and(|key| {
                    self.registered.contains_key(&key.id())
                        && !self.uncertain.contains(&key.id())
                });
                let error = if key.is_some() && !active {
                    Some("Global shortcut unavailable. Choose another combination or retry activation; the menu action still works.".into())
                } else {
                    None
                };
                (action, Status { active, error })
            })
            .collect();
        View {
            preferences: self.preferences.clone(),
            defaults: Preferences::default(),
            status,
            cleanup_required: !self.uncertain.is_empty()
                || self.registered.keys().any(|id| !wanted.contains_key(id)),
            warning: self.warning.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    #[derive(Default)]
    struct Fake {
        keys: BTreeSet<u32>,
        fail_add: BTreeSet<u32>,
        fail_remove: BTreeSet<u32>,
        calls: usize,
    }
    impl Backend for Fake {
        fn register(&mut self, key: Shortcut) -> Result<()> {
            self.calls += 1;
            if self.fail_add.contains(&key.id()) {
                Err("Synthetic OS collision".into())
            } else {
                self.keys.insert(key.id());
                Ok(())
            }
        }
        fn unregister(&mut self, key: Shortcut) -> Result<()> {
            self.calls += 1;
            if self.fail_remove.contains(&key.id()) {
                Err("Synthetic unregister failure".into())
            } else {
                self.keys.remove(&key.id());
                Ok(())
            }
        }
    }
    fn replacement() -> Preferences {
        let mut next = Preferences::default();
        next.bindings
            .get_mut(&Action::Capture)
            .unwrap()
            .as_mut()
            .unwrap()
            .key = "KeyJ".into();
        next
    }
    #[test]
    fn validation_precedes_os_calls_and_protects_typing_and_app_commands() {
        let mut manager = Shortcuts::new(None);
        let mut os = Fake::default();
        let mut duplicate = Preferences::default();
        duplicate
            .bindings
            .insert(Action::Left, duplicate.bindings[&Action::Capture].clone());
        let future = Preferences {
            schema_version: 2,
            ..Preferences::default()
        };
        let mut missing = Preferences::default();
        missing.bindings.remove(&Action::Capture);
        for bad in [duplicate, future, missing] {
            assert!(manager.apply(bad, &mut os, |_| Ok(())).is_err());
            assert_eq!(os.calls, 0);
        }
        for binding in [
            Binding {
                control: false,
                option: false,
                command: false,
                shift: false,
                key: "KeyN".into(),
            },
            Binding {
                control: false,
                option: false,
                command: true,
                shift: true,
                key: "KeyQ".into(),
            },
            Binding {
                control: true,
                option: true,
                command: false,
                shift: false,
                key: "Enter".into(),
            },
        ] {
            assert!(binding.shortcut().is_err());
        }
        let mut incomplete = Preferences::default();
        incomplete.bindings.remove(&Action::Bottom);
        assert!(incomplete.keys().is_err());
    }
    #[test]
    fn swaps_reuse_ids_and_only_publish_routes_after_persistence() {
        let mut manager = Shortcuts::new(None);
        let mut os = Fake::default();
        manager.activate(&mut os);
        let calls = os.calls;
        let mut next = Preferences::default();
        next.bindings.insert(
            Action::Capture,
            Preferences::default().bindings[&Action::Left].clone(),
        );
        next.bindings.insert(
            Action::Left,
            Preferences::default().bindings[&Action::Capture].clone(),
        );
        let routes = manager.routes.clone();
        let before = routes.read().unwrap().clone();
        manager
            .apply(next.clone(), &mut os, |_| {
                assert_eq!(*routes.read().unwrap(), before);
                Ok(())
            })
            .unwrap();
        assert_eq!(os.calls, calls);
        assert_eq!(manager.preferences, next);
        assert_ne!(*routes.read().unwrap(), before);
    }
    #[test]
    fn collisions_and_failed_persistence_restore_previous_preferences_and_keys() {
        let mut manager = Shortcuts::new(None);
        let mut os = Fake::default();
        manager.activate(&mut os);
        let old = os.keys.clone();
        let next = replacement();
        let id = next.bindings[&Action::Capture]
            .as_ref()
            .unwrap()
            .shortcut()
            .unwrap()
            .id();
        os.fail_add.insert(id);
        let mut persisted = false;
        assert!(manager
            .apply(next.clone(), &mut os, |_| {
                persisted = true;
                Ok(())
            })
            .is_err());
        assert!(!persisted);
        assert_eq!(os.keys, old);
        os.fail_add.clear();
        assert!(manager
            .apply(next, &mut os, |_| Err("Synthetic disk failure".into()))
            .is_err());
        assert_eq!(os.keys, old);
        assert_eq!(manager.preferences, Preferences::default());
    }
    #[test]
    fn failed_rollback_is_visible_and_activation_repairs_it() {
        let mut manager = Shortcuts::new(None);
        let mut os = Fake::default();
        manager.activate(&mut os);
        let old = manager.preferences.bindings[&Action::Capture]
            .as_ref()
            .unwrap()
            .shortcut()
            .unwrap()
            .id();
        let next = replacement();
        let new = next.bindings[&Action::Capture]
            .as_ref()
            .unwrap()
            .shortcut()
            .unwrap()
            .id();
        os.fail_remove.insert(new);
        os.fail_add.insert(old);
        assert!(manager
            .apply(next, &mut os, |_| Err("Synthetic disk failure".into()))
            .is_err());
        assert!(!manager.view().status[&Action::Capture].active);
        assert!(manager.view().cleanup_required);
        os.fail_add.clear();
        os.fail_remove.clear();
        let view = manager.activate(&mut os);
        assert!(view.status.values().all(|s| s.active));
        assert!(!view.cleanup_required);
    }
    #[test]
    fn disabled_bindings_persist_and_bad_saved_data_is_not_overwritten() {
        let mut manager = Shortcuts::new(None);
        let mut os = Fake::default();
        manager.activate(&mut os);
        let mut next = Preferences::default();
        next.bindings.insert(Action::Capture, None);
        let mut stored = None;
        manager
            .apply(next.clone(), &mut os, |p| {
                stored = Some(serde_json::to_value(p).unwrap());
                Ok(())
            })
            .unwrap();
        let restored = Shortcuts::new(stored);
        assert_eq!(restored.preferences, next);
        let bad = Shortcuts::new(Some(serde_json::json!({"schemaVersion":9})));
        assert!(bad.view().warning.is_some());
        assert_eq!(bad.preferences, Preferences::default());
    }
    #[test]
    fn failed_release_is_reported_uncertain_even_if_previous_os_key_still_exists() {
        let mut manager = Shortcuts::new(None);
        let mut os = Fake::default();
        manager.activate(&mut os);
        let old = manager.preferences.bindings[&Action::Capture]
            .as_ref()
            .unwrap()
            .shortcut()
            .unwrap()
            .id();
        os.fail_remove.insert(old);
        assert!(manager.apply(replacement(), &mut os, |_| Ok(())).is_err());
        assert!(os.keys.contains(&old));
        assert!(!manager.view().status[&Action::Capture].active);
        assert!(manager.view().cleanup_required);
        os.fail_remove.clear();
        let repaired = manager.activate(&mut os);
        assert!(repaired.status[&Action::Capture].active);
        assert!(!repaired.cleanup_required);
    }
    #[test]
    fn loading_saved_preferences_reports_the_saved_binding_even_when_registration_fails() {
        let mut manager = Shortcuts::new(None);
        let mut os = Fake::default();
        manager.activate(&mut os);
        let desired = replacement();
        let id = desired.bindings[&Action::Capture]
            .as_ref()
            .unwrap()
            .shortcut()
            .unwrap()
            .id();
        os.fail_add.insert(id);
        let view = manager.reload(Some(serde_json::to_value(&desired).unwrap()), &mut os);
        assert_eq!(view.preferences, desired);
        assert!(!view.status[&Action::Capture].active);
        assert!(view.status[&Action::Capture].error.is_some());
    }
}
