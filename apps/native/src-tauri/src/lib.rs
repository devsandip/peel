mod controller;
mod db;
#[cfg(all(test, unix))]
mod durability;
mod local_library;
mod login_item;
mod operations;
mod shortcuts;
use controller::{Controller, LibraryInfo};
use db::{Database, Note, Placement, Result};
use operations::{Decision, Kind};
use serde_json::Value;
use shortcuts::{
    Action, Backend, Preferences as ShortcutPreferences, Routes, Shortcuts, View as ShortcutView,
};
use std::{
    collections::BTreeMap,
    ops::{Deref, DerefMut},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

struct Store {
    controller: Mutex<Controller>,
    shortcuts: Mutex<Shortcuts>,
    edge_menus: Mutex<BTreeMap<Action, MenuItem<tauri::Wry>>>,
    login_item: Mutex<login_item::LoginItem>,
    allow_exit: AtomicBool,
}
struct DatabaseGuard<'a> {
    controller: std::sync::MutexGuard<'a, Controller>,
}
impl Deref for DatabaseGuard<'_> {
    type Target = Database;
    fn deref(&self) -> &Database {
        &self
            .controller
            .library
            .as_ref()
            .expect("checked library guard")
            .database
    }
}
impl DerefMut for DatabaseGuard<'_> {
    fn deref_mut(&mut self) -> &mut Database {
        &mut self
            .controller
            .library
            .as_mut()
            .expect("checked library guard")
            .database
    }
}
fn controller(app: &tauri::AppHandle) -> std::sync::MutexGuard<'_, Controller> {
    app.state::<Store>()
        .inner()
        .controller
        .lock()
        .unwrap_or_else(|e| e.into_inner())
}
fn lock(app: &tauri::AppHandle) -> Result<DatabaseGuard<'_>> {
    let controller = controller(app);
    if controller.library.is_none() {
        return Err(controller
            .error
            .clone()
            .unwrap_or("The selected library is unavailable.".into()));
    }
    Ok(DatabaseGuard { controller })
}
struct WindowPermit(tauri::AppHandle);
impl WindowPermit {
    fn new(app: &tauri::AppHandle) -> Result<Self> {
        controller(app).begin_window_change()?;
        Ok(Self(app.clone()))
    }
}
impl Drop for WindowPermit {
    fn drop(&mut self) {
        let mut state = controller(&self.0);
        state.window_changes = state.window_changes.saturating_sub(1);
    }
}
fn idle_write(app: &tauri::AppHandle) -> Result<DatabaseGuard<'_>> {
    let guard = lock(app)?;
    guard.controller.operations.require_idle()?;
    Ok(guard)
}
fn changed(app: &tauri::AppHandle) {
    let _ = app.emit("peel-changed", ());
}

#[tauri::command]
async fn list_notes(app: tauri::AppHandle) -> Result<Vec<Note>> {
    lock(&app)?.list()
}
#[tauri::command]
async fn get_note(app: tauri::AppHandle, note_id: String) -> Result<Option<Note>> {
    lock(&app)?.get(&note_id)
}
#[tauri::command]
async fn save_note(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    note: Note,
    expected_revision: u32,
) -> Result<Note> {
    let saved = {
        let mut guard = lock(&app)?;
        guard.controller.operations.permits_save(window.label())?;
        guard.save(note, expected_revision)?
    };
    changed(&app);
    Ok(saved)
}
#[tauri::command]
fn purge_note(app: tauri::AppHandle, note_id: String, expected_revision: u32) -> Result<()> {
    idle_write(&app)?.purge(&note_id, expected_revision)?;
    changed(&app);
    Ok(())
}
#[tauri::command]
fn list_placements(app: tauri::AppHandle) -> Result<Vec<Placement>> {
    lock(&app)?.placements()
}
#[tauri::command]
fn save_placement(app: tauri::AppHandle, placement: Placement) -> Result<()> {
    idle_write(&app)?.place(&placement)?;
    changed(&app);
    Ok(())
}
#[tauri::command]
fn get_setting(app: tauri::AppHandle, key: String) -> Result<Option<Value>> {
    lock(&app)?.setting(&key)
}
#[tauri::command]
fn set_setting(app: tauri::AppHandle, key: String, value: Value) -> Result<()> {
    if key == "libraryIdentity" || key == "globalShortcuts" || key == "launchAtLogin" {
        return Err("This setting is managed by Synkies.".into());
    }
    idle_write(&app)?.set_setting(&key, value)
}
#[tauri::command]
fn maintenance(app: tauri::AppHandle) -> Result<()> {
    idle_write(&app)?.maintenance()
}

fn clamp(p: &mut Placement, monitor: &tauri::Monitor) {
    let s = monitor.scale_factor();
    let area = monitor.work_area();
    let x = area.position.x as f64 / s;
    let y = area.position.y as f64 / s;
    let w = area.size.width as f64 / s;
    let h = area.size.height as f64 / s;
    p.width = p.width.max(280.0).min(w);
    p.height = p.height.max(180.0).min(h);
    p.x = p.x.max(x).min(x + w - p.width);
    p.y = p.y.max(y).min(y + h - p.height);
    p.display_id = monitor.name().cloned();
}
fn monitor_for(app: &tauri::AppHandle, p: Option<&Placement>) -> Option<tauri::Monitor> {
    let monitors = app.available_monitors().ok()?;
    if let Some(p) = p {
        if let Some(m) = monitors.iter().find(|m| m.name() == p.display_id.as_ref()) {
            return Some(m.clone());
        }
    }
    let cursor = app.cursor_position().ok();
    monitors
        .iter()
        .find(|m| {
            let a = m.work_area();
            cursor.is_some_and(|c| {
                c.x >= a.position.x as f64
                    && c.y >= a.position.y as f64
                    && c.x < (a.position.x as f64 + a.size.width as f64)
                    && c.y < (a.position.y as f64 + a.size.height as f64)
            })
        })
        .cloned()
        .or_else(|| monitors.first().cloned())
}
fn note_window(app: &tauri::AppHandle, note_id: &str, position: Option<(f64, f64)>) -> Result<()> {
    let _permit = WindowPermit::new(app)?;
    let label = format!("note-{note_id}");
    if let Some(window) = app.get_webview_window(&label) {
        if let Some((x, y)) = position {
            let _ = window.set_position(LogicalPosition::new(x, y));
        }
        let _ = window.show();
        return window.set_focus().map_err(|e| e.to_string());
    }
    let mut p = {
        let db = lock(app)?;
        let note = db.get(note_id)?.ok_or("Note not found.")?;
        if note.state != "active" {
            return Err("Restore this note before pinning it.".into());
        }
        db.placements()?
            .into_iter()
            .find(|p| p.note_id == note_id)
            .unwrap_or(Placement {
                note_id: note_id.into(),
                x: 140.0,
                y: 120.0,
                width: 360.0,
                height: 380.0,
                pinned: true,
                always_on_top: false,
                display_id: None,
            })
    };
    if let Some((x, y)) = position {
        p.x = x;
        p.y = y;
        p.display_id = None;
    }
    if let Some(m) = monitor_for(app, Some(&p)) {
        clamp(&mut p, &m);
    }
    p.pinned = true;
    lock(app)?.place(&p)?;
    let window = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App(format!("index.html?note={note_id}").into()),
    )
    .title("Synkies note")
    .decorations(false)
    .shadow(true)
    .resizable(true)
    .min_inner_size(280.0, 180.0)
    .inner_size(p.width, p.height)
    .position(p.x, p.y)
    .always_on_top(p.always_on_top)
    .visible(true)
    .disable_drag_drop_handler()
    .build()
    .map_err(|e| e.to_string())?;
    let handle = app.clone();
    let id = note_id.to_string();
    let w = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = w.emit("peel-request-close", ());
        }
        WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let _ = remember_window(&handle, &w, &id);
        }
        WindowEvent::Destroyed => window_destroyed(&handle, w.label()),
        _ => {}
    });
    changed(app);
    Ok(())
}
fn remember_window(app: &tauri::AppHandle, w: &tauri::WebviewWindow, id: &str) -> Result<()> {
    let scale = w.scale_factor().map_err(|e| e.to_string())?;
    let pos = w.outer_position().map_err(|e| e.to_string())?;
    let size = w.inner_size().map_err(|e| e.to_string())?;
    let db = idle_write(app)?;
    let previous = db.placements()?.into_iter().find(|p| p.note_id == id);
    db.place(&Placement {
        note_id: id.into(),
        x: pos.x as f64 / scale,
        y: pos.y as f64 / scale,
        width: size.width as f64 / scale,
        height: size.height as f64 / scale,
        pinned: true,
        always_on_top: previous.as_ref().is_some_and(|p| p.always_on_top),
        display_id: w
            .current_monitor()
            .ok()
            .flatten()
            .and_then(|m| m.name().cloned()),
    })
}
#[tauri::command]
fn new_note(app: tauri::AppHandle) -> Result<String> {
    let _permit = WindowPermit::new(&app)?;
    let note = lock(&app)?.save(Note::blank(), 0)?;
    note_window(&app, &note.note_id, None)?;
    Ok(note.note_id)
}
#[tauri::command]
fn open_note(app: tauri::AppHandle, note_id: String, x: Option<f64>, y: Option<f64>) -> Result<()> {
    note_window(&app, &note_id, x.zip(y))
}
#[tauri::command]
fn close_desktop_note(app: tauri::AppHandle, note_id: String) -> Result<()> {
    controller(&app).operations.require_idle()?;
    app.get_webview_window(&format!("note-{note_id}"))
        .ok_or("Note is not open.")?
        .emit("peel-request-close", ())
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn note_lifecycle(app: tauri::AppHandle, note_id: String, state: String) -> Result<()> {
    controller(&app).operations.require_idle()?;
    if !["active", "archived", "trashed"].contains(&state.as_str()) {
        return Err("Invalid note state.".into());
    }
    app.get_webview_window(&format!("note-{note_id}"))
        .ok_or("Note is not open.")?
        .emit("peel-lifecycle", state)
        .map_err(|e| e.to_string())
}
#[tauri::command]
fn reveal_note(window: tauri::WebviewWindow) -> Result<()> {
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
#[tauri::command]
fn finish_close(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    discard_empty: bool,
) -> Result<()> {
    let _permit = WindowPermit::new(&app)?;
    let id = window
        .label()
        .strip_prefix("note-")
        .ok_or("This is not a note window.")?;
    {
        let mut db = lock(&app)?;
        if discard_empty {
            if let Some(n) = db.get(id)? {
                if n.body_markdown.is_empty() {
                    db.purge(id, n.local_revision)?;
                }
            }
        }
        if let Some(mut p) = db.placements()?.into_iter().find(|p| p.note_id == id) {
            p.pinned = false;
            db.place(&p)?;
        }
    }
    window.destroy().map_err(|e| e.to_string())?;
    changed(&app);
    Ok(())
}
#[tauri::command]
fn keep_on_top(app: tauri::AppHandle, note_id: String, enabled: bool) -> Result<()> {
    let _permit = WindowPermit::new(&app)?;
    let window = app
        .get_webview_window(&format!("note-{note_id}"))
        .ok_or("Note is not open.")?;
    window
        .set_always_on_top(enabled)
        .map_err(|e| e.to_string())?;
    let db = lock(&app)?;
    if let Some(mut p) = db.placements()?.into_iter().find(|p| p.note_id == note_id) {
        p.always_on_top = enabled;
        db.place(&p)?;
    }
    changed(&app);
    Ok(())
}
#[tauri::command]
fn open_library(app: tauri::AppHandle) -> Result<()> {
    let _permit = WindowPermit::new(&app)?;
    if let Some(w) = app.get_webview_window("library") {
        let _ = w.unminimize();
        w.show().map_err(|e| e.to_string())?;
        return w.set_focus().map_err(|e| e.to_string());
    }
    let window = WebviewWindowBuilder::new(&app, "library", WebviewUrl::App("index.html".into()))
        .title("Synkies · Notes Library")
        .inner_size(1060.0, 720.0)
        .min_inner_size(660.0, 460.0)
        .center()
        .disable_drag_drop_handler()
        .build()
        .map_err(|e| e.to_string())?;
    let w = window.clone();
    let handle = app.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = w.emit("peel-request-close", ());
        }
        WindowEvent::Destroyed => window_destroyed(&handle, "library"),
        _ => {}
    });
    Ok(())
}
#[tauri::command]
fn finish_library_close(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<()> {
    let _permit = WindowPermit::new(&app)?;
    if window.label() != "library" {
        return Err("This is not Notes Library.".into());
    }
    window.destroy().map_err(|e| e.to_string())
}
fn window_destroyed(app: &tauri::AppHandle, label: &str) {
    let cancelled = controller(app).operations.window_lost(label);
    if let Some((id, kind)) = cancelled {
        cancel_operation(
            app,
            id,
            kind,
            "A note window became unavailable. The library was not moved.",
        );
    }
}
#[tauri::command]
fn arrange_notes(app: tauri::AppHandle, edge: String) -> Result<()> {
    let _permit = WindowPermit::new(&app)?;
    if !["left", "right", "top", "bottom"].contains(&edge.as_str()) {
        return Err("Unknown arrangement.".into());
    }
    let focused = app
        .webview_windows()
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .and_then(|w| w.current_monitor().ok().flatten());
    let monitor = focused
        .or_else(|| monitor_for(&app, None))
        .ok_or("No display is available.")?;
    let mut placements = lock(&app)?.placements()?;
    placements.retain(|p| {
        p.pinned
            && app
                .get_webview_window(&format!("note-{}", p.note_id))
                .is_some_and(|w| {
                    w.current_monitor()
                        .ok()
                        .flatten()
                        .is_some_and(|m| m.name() == monitor.name())
                })
    });
    if placements.is_empty() {
        return Ok(());
    }
    lock(&app)?.set_setting(
        "undoArrangement",
        serde_json::to_value(&placements).map_err(|e| e.to_string())?,
    )?;
    let area = monitor.work_area();
    let scale = monitor.scale_factor();
    let ax = area.position.x as f64 / scale;
    let ay = area.position.y as f64 / scale;
    let aw = area.size.width as f64 / scale;
    let ah = area.size.height as f64 / scale;
    let vertical = edge == "left" || edge == "right";
    let extent = if vertical { ah } else { aw };
    let min = if vertical { 180.0 } else { 280.0 };
    let count = placements.len() as f64;
    let fits = count * min + (count - 1.0) * 12.0 <= extent;
    let step = if fits {
        (extent - 12.0 * (count - 1.0)) / count
    } else {
        ((extent - min) / (count - 1.0).max(1.0)).clamp(0.0, 32.0)
    };
    for (i, p) in placements.iter_mut().enumerate() {
        if vertical {
            p.height = if fits {
                p.height.min(step)
            } else {
                p.height.min(180.0)
            };
        }
        if !vertical {
            p.width = if fits {
                p.width.min(step)
            } else {
                p.width.min(280.0)
            };
        }
        p.x = if edge == "right" {
            ax + aw - p.width
        } else {
            ax
        };
        p.y = if edge == "bottom" {
            ay + ah - p.height
        } else {
            ay
        };
        if vertical {
            p.y += i as f64 * (step + if fits { 12.0 } else { 0.0 });
        } else {
            p.x += i as f64 * (step + if fits { 12.0 } else { 0.0 });
        }
        clamp(p, &monitor);
        apply_placement(&app, p)?;
    }
    changed(&app);
    Ok(())
}
fn apply_placement(app: &tauri::AppHandle, p: &Placement) -> Result<()> {
    if let Some(w) = app.get_webview_window(&format!("note-{}", p.note_id)) {
        w.set_size(LogicalSize::new(p.width, p.height))
            .map_err(|e| e.to_string())?;
        w.set_position(LogicalPosition::new(p.x, p.y))
            .map_err(|e| e.to_string())?;
    }
    lock(app)?.place(p)
}
#[tauri::command]
fn undo_arrangement(app: tauri::AppHandle) -> Result<()> {
    let _permit = WindowPermit::new(&app)?;
    let saved = lock(&app)?.setting("undoArrangement")?;
    if let Some(value) = saved {
        let placements: Vec<Placement> =
            serde_json::from_value(value).map_err(|e| e.to_string())?;
        for mut p in placements {
            if let Some(m) = monitor_for(&app, Some(&p)) {
                clamp(&mut p, &m);
            }
            apply_placement(&app, &p)?;
        }
    }
    changed(&app);
    Ok(())
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct RelocationFinished {
    id: String,
    keep_frozen: bool,
    error: Option<String>,
}
fn cancel_operation(app: &tauri::AppHandle, id: String, kind: Kind, error: &str) {
    if kind == Kind::Quit {
        let _ = app.emit("peel-quit-cancelled", id);
    } else {
        let reply = {
            let mut state = controller(app);
            state.destination = None;
            state.reply.take()
        };
        if let Some(reply) = reply {
            let _ = reply.try_send(Err(error.into()));
        }
        let _ = app.emit(
            "peel-relocation-finished",
            RelocationFinished {
                id,
                keep_frozen: false,
                error: Some(error.into()),
            },
        );
    }
}
fn barrier_timeout(app: tauri::AppHandle, id: String) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(15));
        let kind = controller(&app).operations.cancel_waiting(&id);
        if let Some(kind) = kind {
            cancel_operation(&app, id, kind, "A note window did not finish saving. The library was not moved; retry when every window is responsive.");
        }
    });
}
fn begin_quit(app: &tauri::AppHandle) {
    let id = uuid::Uuid::new_v4().to_string();
    let ready = {
        let mut state = controller(app);
        if state.window_changes != 0 {
            return;
        }
        state.operations.begin(
            id.clone(),
            Kind::Quit,
            app.webview_windows().keys().cloned().collect(),
        )
    };
    match ready {
        Ok(true) => {
            app.state::<Store>()
                .allow_exit
                .store(true, Ordering::SeqCst);
            app.exit(0);
        }
        Ok(false) => {
            let _ = app.emit("peel-request-quit", id.clone());
            barrier_timeout(app.clone(), id);
        }
        Err(error) => {
            let _ = app.emit("peel-error", error);
        }
    }
}
#[tauri::command]
fn quit_ack(app: tauri::AppHandle, window: tauri::WebviewWindow, success: bool, quit_id: String) {
    let decision =
        controller(&app)
            .operations
            .acknowledge(&quit_id, Kind::Quit, window.label(), success);
    match decision {
        Decision::Cancelled(kind) => {
            cancel_operation(&app, quit_id, kind, "A note could not be saved.")
        }
        Decision::Ready(Kind::Quit) => {
            app.state::<Store>()
                .allow_exit
                .store(true, Ordering::SeqCst);
            app.exit(0);
        }
        _ => {}
    }
}
#[tauri::command]
fn request_quit(app: tauri::AppHandle) {
    begin_quit(&app);
}
#[tauri::command]
fn library_location(app: tauri::AppHandle) -> LibraryInfo {
    controller(&app).info()
}
#[tauri::command]
fn retry_open_library(app: tauri::AppHandle) -> Result<LibraryInfo> {
    let (info, restore) = {
        let mut state = controller(&app);
        let missing = state.library.is_none();
        (state.retry()?, missing)
    };
    if restore {
        restore_desktop(&app)?;
        activate_shortcuts(app.clone(), true);
    }
    changed(&app);
    Ok(info)
}
fn start_copy(app: tauri::AppHandle, id: String) {
    tauri::async_runtime::spawn_blocking(move || {
        let (result, reply, restart) = {
            let mut state = controller(&app);
            let result = match state.destination.take() {
                Some(path) => state
                    .library
                    .as_mut()
                    .ok_or("The selected library is unavailable.".to_string())
                    .and_then(|library| library.relocate(&path)),
                None => Err("The destination is unavailable.".into()),
            };
            let restart = state
                .library
                .as_ref()
                .is_some_and(|library| library.database.is_blocked());
            state.operations.finish_move(&id, restart);
            let result = result.map(|_| state.info());
            (result, state.reply.take(), restart)
        };
        let error = result.as_ref().err().cloned();
        if let Some(reply) = reply {
            let _ = reply.try_send(result);
        }
        let _ = app.emit(
            "peel-relocation-finished",
            RelocationFinished {
                id,
                keep_frozen: restart,
                error,
            },
        );
        changed(&app);
    });
}
#[tauri::command]
fn relocation_ack(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    success: bool,
    operation_id: String,
) {
    let decision = controller(&app).operations.acknowledge(
        &operation_id,
        Kind::Relocate,
        window.label(),
        success,
    );
    match decision {
        Decision::Cancelled(kind) => cancel_operation(
            &app,
            operation_id,
            kind,
            "A note could not be saved. The library remains in its previous folder.",
        ),
        Decision::Ready(Kind::Relocate) => start_copy(app, operation_id),
        _ => {}
    }
}
#[tauri::command]
async fn choose_library_folder(app: tauri::AppHandle) -> Result<Option<LibraryInfo>> {
    let id = uuid::Uuid::new_v4().to_string();
    controller(&app).begin_choice(id.clone())?;
    let picker = app.clone();
    let chosen =
        tauri::async_runtime::spawn_blocking(move || -> Result<Option<std::path::PathBuf>> {
            picker
                .dialog()
                .file()
                .set_title("Choose a folder for your Synkies library")
                .blocking_pick_folder()
                .map(|path| {
                    path.into_path()
                        .map_err(|_| "Choose a local folder.".to_string())
                })
                .transpose()
        })
        .await
        .map_err(|_| "The folder picker could not open.".to_string())
        .and_then(|value| value);
    let path = match chosen {
        Ok(Some(path)) => path,
        Ok(None) => {
            controller(&app).operations.cancel_choice(&id);
            return Ok(None);
        }
        Err(error) => {
            controller(&app).operations.cancel_choice(&id);
            return Err(error);
        }
    };
    let (reply, mut receiver) = tauri::async_runtime::channel(1);
    let ready = {
        let mut state = controller(&app);
        let ready = state.operations.begin(
            id.clone(),
            Kind::Relocate,
            app.webview_windows().keys().cloned().collect(),
        )?;
        state.destination = Some(path);
        state.reply = Some(reply);
        ready
    };
    if ready {
        start_copy(app.clone(), id.clone());
    } else {
        let _ = app.emit("peel-request-relocation", id.clone());
        barrier_timeout(app.clone(), id);
    }
    receiver
        .recv()
        .await
        .ok_or("The folder change was interrupted.".to_string())?
        .map(Some)
}
#[tauri::command]
async fn export_archive(app: tauri::AppHandle, bytes: Vec<u8>) -> Result<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .add_filter("Synkies export", &["zip"])
            .set_file_name("Synkies-notes.zip")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = path
            .into_path()
            .map_err(|_| "Choose a local export file.".to_string())?;
        std::fs::write(path, bytes)
            .map_err(|_| "Could not write the export. Choose another location.".to_string())?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn get_login_item(app: tauri::AppHandle) -> Result<login_item::View> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let item = store
            .login_item
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        Ok(item.view(&mut login_item::Os { app: app.clone() }))
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
async fn set_login_item(app: tauri::AppHandle, enabled: bool) -> Result<login_item::View> {
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = WindowPermit::new(&app)?;
        let store = app.state::<Store>();
        let item = store
            .login_item
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        Ok(item.change(enabled, &mut login_item::Os { app: app.clone() }))
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
async fn open_login_item_settings(app: tauri::AppHandle) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let item = store
            .login_item
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        item.open_settings(&mut login_item::Os { app: app.clone() })
    })
    .await
    .map_err(|error| error.to_string())?
}
struct ShortcutBackend {
    app: tauri::AppHandle,
    routes: Routes,
}
impl Backend for ShortcutBackend {
    fn register(&mut self, key: tauri_plugin_global_shortcut::Shortcut) -> Result<()> {
        let routes = self.routes.clone();
        self.app
            .global_shortcut()
            .on_shortcut(key, move |app, key, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                let action = routes
                    .read()
                    .unwrap_or_else(|e| e.into_inner())
                    .get(&key.id())
                    .copied();
                if let Some(action) = action {
                    menu_action(app, action.menu_id());
                }
            })
            .map_err(|_| "The global shortcut could not be registered.".into())
    }
    fn unregister(&mut self, key: tauri_plugin_global_shortcut::Shortcut) -> Result<()> {
        self.app
            .global_shortcut()
            .unregister(key)
            .map_err(|_| "The global shortcut could not be released.".into())
    }
}
fn update_shortcut_menus(app: &tauri::AppHandle, state: &mut Shortcuts) {
    let menus = app
        .state::<Store>()
        .edge_menus
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    for (action, item) in menus {
        let key = state.preferences.bindings[&action]
            .as_ref()
            .map(|binding| binding.accelerator());
        if item.set_accelerator(key).is_err() {
            state.warn("Global settings are saved, but a Window menu label could not refresh. Reopen Synkies to retry the label.");
        }
    }
}
fn activate_shortcuts(app: tauri::AppHandle, reload: bool) {
    tauri::async_runtime::spawn_blocking(move || {
        // Registration dispatches to the main thread. Never hold the library controller here.
        let store = app.state::<Store>();
        let mut state = store.shortcuts.lock().unwrap_or_else(|e| e.into_inner());
        let saved = if reload {
            lock(&app)
                .ok()
                .and_then(|database| database.setting("globalShortcuts").ok().flatten())
        } else {
            None
        };
        let mut backend = ShortcutBackend {
            app: app.clone(),
            routes: state.routes.clone(),
        };
        if reload {
            state.reload(saved, &mut backend);
        } else {
            state.activate(&mut backend);
        }
        update_shortcut_menus(&app, &mut state);
        let _ = app.emit("peel-shortcuts-changed", ());
    });
}
#[tauri::command]
async fn get_shortcuts(app: tauri::AppHandle) -> Result<ShortcutView> {
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let state = store.shortcuts.lock().unwrap_or_else(|e| e.into_inner());
        Ok(state.view())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_shortcuts(
    app: tauri::AppHandle,
    preferences: ShortcutPreferences,
) -> Result<ShortcutView> {
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = WindowPermit::new(&app)?;
        let store = app.state::<Store>();
        let mut state = store.shortcuts.lock().unwrap_or_else(|e| e.into_inner());
        let mut backend = ShortcutBackend {
            app: app.clone(),
            routes: state.routes.clone(),
        };
        let result = state.apply(preferences, &mut backend, |preferences| {
            let value = serde_json::to_value(preferences)
                .map_err(|_| "Could not prepare shortcut settings.".to_string())?;
            idle_write(&app)?.set_setting("globalShortcuts", value)
        });
        update_shortcut_menus(&app, &mut state);
        let _ = app.emit("peel-shortcuts-changed", ());
        result.map(|_| state.view())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn retry_shortcuts(app: tauri::AppHandle) -> Result<ShortcutView> {
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = WindowPermit::new(&app)?;
        let store = app.state::<Store>();
        let mut state = store.shortcuts.lock().unwrap_or_else(|e| e.into_inner());
        let mut backend = ShortcutBackend {
            app: app.clone(),
            routes: state.routes.clone(),
        };
        state.activate(&mut backend);
        update_shortcut_menus(&app, &mut state);
        Ok(state.view())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn menu(app: &tauri::AppHandle) -> tauri::Result<()> {
    let new = MenuItem::with_id(app, "new", "New note", true, Some("CmdOrCtrl+N"))?;
    let library = MenuItem::with_id(
        app,
        "library",
        "Notes Library",
        true,
        Some("CmdOrCtrl+Shift+L"),
    )?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, Some("CmdOrCtrl+,"))?;
    let quit = MenuItem::with_id(app, "quit", "Quit Synkies", true, Some("CmdOrCtrl+Q"))?;
    let peel = Submenu::with_items(
        app,
        "Synkies",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("About Synkies"), None)?,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &quit,
        ],
    )?;
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &new,
            &library,
            &MenuItem::with_id(app, "close", "Close note", true, Some("CmdOrCtrl+W"))?,
        ],
    )?;
    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;
    let note = Submenu::with_items(
        app,
        "Note",
        true,
        &[
            &MenuItem::with_id(app, "source", "Toggle Markdown source", true, None::<&str>)?,
            &MenuItem::with_id(app, "archive", "Archive note", true, None::<&str>)?,
            &MenuItem::with_id(app, "trash", "Move to Trash", true, None::<&str>)?,
        ],
    )?;
    let preferences = app
        .state::<Store>()
        .shortcuts
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .preferences
        .clone();
    let mut edge_items = Vec::new();
    for (edge, action) in [
        ("left", Action::Left),
        ("right", Action::Right),
        ("top", Action::Top),
        ("bottom", Action::Bottom),
    ] {
        edge_items.push(MenuItem::with_id(
            app,
            format!("arrange-{edge}"),
            format!("Arrange {edge}"),
            true,
            preferences.bindings[&action]
                .as_ref()
                .map(|binding| binding.accelerator()),
        )?);
    }
    *app.state::<Store>()
        .edge_menus
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = [
        (Action::Left, edge_items[0].clone()),
        (Action::Right, edge_items[1].clone()),
        (Action::Top, edge_items[2].clone()),
        (Action::Bottom, edge_items[3].clone()),
    ]
    .into();
    let undo = MenuItem::with_id(
        app,
        "undo-arrange",
        "Undo last arrangement",
        true,
        None::<&str>,
    )?;
    let window = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &library,
            &PredefinedMenuItem::minimize(app, None)?,
            &edge_items[0],
            &edge_items[1],
            &edge_items[2],
            &edge_items[3],
            &undo,
        ],
    )?;
    app.set_menu(Menu::with_items(
        app,
        &[&peel, &file, &edit, &note, &window],
    )?)?;
    let tray_menu = Menu::with_items(
        app,
        &[
            &new,
            &library,
            &settings,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;
    tauri::tray::TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .icon_as_template(false)
        .tooltip("Synkies")
        .menu(&tray_menu)
        .show_menu_on_left_click(true)
        .build(app)?;
    Ok(())
}
fn menu_action(app: &tauri::AppHandle, id: &str) {
    let result = match id {
        "new" => new_note(app.clone()).map(|_| ()),
        "library" => open_library(app.clone()),
        "settings" => {
            let r = open_library(app.clone());
            if let Some(w) = app.get_webview_window("library") {
                let _ = w.emit("peel-settings", ());
            }
            r
        }
        "quit" => {
            begin_quit(app);
            Ok(())
        }
        "undo-arrange" => undo_arrangement(app.clone()),
        edge if edge.starts_with("arrange-") => arrange_notes(app.clone(), edge[8..].into()),
        action => {
            if let Some(w) = app
                .webview_windows()
                .values()
                .find(|w| w.is_focused().unwrap_or(false))
            {
                if action == "close" && w.label() == "library" {
                    let _ = w.close();
                } else {
                    let _ = w.emit("peel-menu-action", action);
                }
            }
            Ok(())
        }
    };
    if let Err(error) = result {
        let _ = app.emit("peel-error", error);
    }
}
fn restore_desktop(app: &tauri::AppHandle) -> Result<()> {
    let placements = lock(app)?.placements()?;
    let mut restored = 0;
    for p in placements.into_iter().filter(|p| p.pinned) {
        if note_window(app, &p.note_id, None).is_ok() {
            restored += 1;
        }
    }
    if restored == 0
        && !app
            .webview_windows()
            .keys()
            .any(|label| label.starts_with("note-"))
    {
        new_note(app.clone())?;
    }
    Ok(())
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let folder = std::env::var_os("PEEL_DATA_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            let library_controller = Controller::open(folder);
            let saved = library_controller
                .library
                .as_ref()
                .and_then(|library| library.database.setting("globalShortcuts").ok().flatten());
            app.manage(Store {
                controller: Mutex::new(library_controller),
                shortcuts: Mutex::new(Shortcuts::new(saved)),
                edge_menus: Mutex::new(BTreeMap::new()),
                login_item: Mutex::new(login_item::LoginItem::current()),
                allow_exit: AtomicBool::new(false),
            });
            menu(app.handle())?;
            if controller(app.handle()).info().available {
                restore_desktop(app.handle()).map_err(std::io::Error::other)?;
            } else {
                open_library(app.handle().clone()).map_err(std::io::Error::other)?;
            }
            activate_shortcuts(app.handle().clone(), false);
            Ok(())
        })
        .on_menu_event(|app, event| menu_action(app, event.id().as_ref()))
        .invoke_handler(tauri::generate_handler![
            list_notes,
            get_note,
            save_note,
            purge_note,
            list_placements,
            save_placement,
            get_setting,
            set_setting,
            maintenance,
            new_note,
            open_note,
            close_desktop_note,
            note_lifecycle,
            reveal_note,
            finish_close,
            keep_on_top,
            open_library,
            finish_library_close,
            arrange_notes,
            undo_arrangement,
            quit_ack,
            request_quit,
            export_archive,
            library_location,
            retry_open_library,
            choose_library_folder,
            relocation_ack,
            get_shortcuts,
            save_shortcuts,
            retry_shortcuts,
            get_login_item,
            set_login_item,
            open_login_item_settings
        ])
        .build(tauri::generate_context!())
        .expect("Synkies could not start. Check access to your local notes folder.")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
                if !app.state::<Store>().allow_exit.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    if code.is_some() {
                        begin_quit(app);
                    }
                }
            }
        });
}
