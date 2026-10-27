use serde_json::{json, Value};
use std::{
    borrow::Cow,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{
    utils::assets::{AssetKey, AssetsIter, CspHash},
    Assets, Manager, WebviewUrl, WebviewWindowBuilder, Wry,
};

struct SyntheticAssets {
    bound_module: Vec<u8>,
}
const HTML: &[u8] = b"<!doctype html><html><head><meta charset='utf-8'><title>Peel synthetic runtime probe</title></head><body></body></html>";
impl Assets<Wry> for SyntheticAssets {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        println!(
            "PEEL_M0_TRACE {}",
            match key.as_ref() {
                "/index.html" | "/" => "asset-index",
                "/bound-probe.js" => "asset-module",
                _ => "asset-other",
            }
        );
        match key.as_ref() {
            "/index.html" | "/" => Some(Cow::Borrowed(HTML)),
            "/bound-probe.js" => Some(Cow::Borrowed(&self.bound_module)),
            _ => None,
        }
    }
    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(
            [
                (Cow::Borrowed("/index.html"), Cow::Borrowed(HTML)),
                (
                    Cow::Borrowed("/bound-probe.js"),
                    Cow::Borrowed(self.bound_module.as_slice()),
                ),
            ]
            .into_iter(),
        )
    }
    fn csp_hashes(&self, _: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}
struct Probe {
    finished: Arc<AtomicBool>,
    progress: Arc<Mutex<Value>>,
}
#[tauri::command]
fn probe_progress(app: tauri::AppHandle, stage: String, checks: Value) {
    if ![
        "capabilities",
        "p256",
        "crypto-key-idb",
        "crypto-key-idb-open",
        "crypto-key-idb-write",
        "crypto-key-idb-reopen",
        "crypto-key-idb-read",
        "crypto-key-idb-sign",
        "local-channel",
        "bounded-transfer",
        "transport-stats",
        "bound-module",
        "bound-channel",
    ]
    .contains(&stage.as_str())
    {
        return;
    }
    let checks: serde_json::Map<String, Value> = CHECKS
        .iter()
        .filter_map(|key| {
            checks[key]
                .as_bool()
                .map(|value| ((*key).into(), Value::Bool(value)))
        })
        .collect();
    *app.state::<Probe>()
        .progress
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = json!({ "stage": stage, "checks": checks });
}
const CHECKS: &[&str] = &[
    "customProtocol",
    "secureContext",
    "webRTC",
    "webCrypto",
    "p256SignVerify",
    "privateKeyNonExtractable",
    "cryptoKeyIndexedDBReopen",
    "dataChannelOpened",
    "boundedTransferHashMatches",
    "dtlsConnected",
];
const BOUND_CHECKS: &[&str] = &[
    "actualInstalledDescriptionsBoundToBothProofs",
    "unicodeNoteCommittedBeforeAcknowledgement",
    "quarantinedEditSendsNoAcknowledgement",
    "failedRecipientCommitSendsNoAcknowledgement",
    "lostAcknowledgementRetainsSenderDelivery",
    "recipientStoreReopenRetainsUnacknowledgedCommit",
    "retryAfterReconnectDeduplicatesRecipient",
    "purgeCommitsWithoutRetainedBody",
    "activeRevocationClosesAndRejectsNewTraffic",
    "wrongInstalledDescriptionProofRejected",
    "earlyNoteFramesRejectedBeforeStore",
    "revocationDuringClaimPreventsActivation",
    "unverifiedForwardedAuthorRejected",
    "malformedFrameClosesWithoutAcknowledgement",
    "partialTransferTimesOutWithoutAcknowledgement",
];
#[tauri::command]
fn probe_result(app: tauri::AppHandle, report: Value) {
    let finished = &app.state::<Probe>().finished;
    if finished.swap(true, Ordering::SeqCst) {
        return;
    }
    let checks: serde_json::Map<String, Value> = CHECKS
        .iter()
        .map(|key| {
            (
                (*key).into(),
                Value::Bool(report["checks"][key].as_bool().unwrap_or(false)),
            )
        })
        .collect();
    let bound_checks: serde_json::Map<String, Value> = BOUND_CHECKS
        .iter()
        .map(|key| {
            (
                (*key).into(),
                Value::Bool(report["bound"]["checks"][key].as_bool().unwrap_or(false)),
            )
        })
        .collect();
    let passed = checks
        .values()
        .chain(bound_checks.values())
        .all(|value| value == true);
    let mut sanitized = json!({
        "scope": "M0 hidden ephemeral Tauri/WKWebView local host probe; not app sync, native Keychain, disk persistence, cross-network/relay or iPhone acceptance",
        "generatedAt": chrono::Utc::now().to_rfc3339(),
        "checks": checks,
        "boundChannelChecks": bound_checks,
        "externalIceServers": 0,
        "appDatabasesOpened": 0,
        "persistentWebViewStore": false,
    });
    for key in [
        "scheme",
        "userAgent",
        "failureStage",
        "exception",
        "localCandidateType",
        "remoteCandidateType",
    ] {
        if let Some(value) = report[key].as_str().filter(|value| value.len() <= 256) {
            sanitized[key] = Value::String(value.into());
        }
    }
    for key in ["payloadBytes", "frameBytes", "frames"] {
        if let Some(value) = report[key].as_u64().filter(|value| *value <= 262144) {
            sanitized[key] = Value::from(value);
        }
    }
    if let Some(sessions) = report["bound"]["sessions"]
        .as_u64()
        .filter(|count| *count <= 16)
    {
        sanitized["boundSessions"] = Value::from(sessions);
    }
    if let Some(bytes) = report["bound"]["connectivity"]["payloadBytes"]
        .as_u64()
        .filter(|count| *count <= 262144)
    {
        sanitized["boundPayloadBytes"] = Value::from(bytes);
    }
    println!("PEEL_M0_REPORT {sanitized}");
    app.exit(if passed { 0 } else { 2 });
}
fn main() {
    assert!(
        !tauri::is_dev(),
        "Build the probe with --features tauri/custom-protocol"
    );
    let folder = PathBuf::from(
        std::env::var_os("PEEL_M0_PROBE_ROOT").expect("Use the isolated probe launcher"),
    );
    let token = std::env::var("PEEL_M0_PROBE_TOKEN").expect("Missing fixture token");
    assert!(folder.is_absolute() && token.len() == 36);
    assert_eq!(
        std::fs::read_to_string(folder.join("synthetic-fixture.marker")).unwrap(),
        token
    );
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "com.peelnotes.m0peerprobe".into();
    let bound_module = std::fs::read(folder.join("fixture/bound-peer-channel.js"))
        .expect("Missing synthetic bound-channel module");
    assert!(bound_module.len() <= 1024 * 1024);
    context.set_assets(Box::new(SyntheticAssets { bound_module }));
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![probe_result, probe_progress])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Prohibited);
            let finished = Arc::new(AtomicBool::new(false));
            let progress = Arc::new(Mutex::new(json!({ "stage": "native-startup", "checks": {} })));
            app.manage(Probe {
                finished: finished.clone(),
                progress: progress.clone(),
            });
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(30));
                if !finished.swap(true, Ordering::SeqCst) {
                    let progress = progress.lock().unwrap_or_else(|error| error.into_inner());
                    println!("PEEL_M0_REPORT {}", json!({ "failureStage": "native-watchdog", "lastStage": progress["stage"], "checks": progress["checks"], "appDatabasesOpened": 0, "persistentWebViewStore": false, "externalIceServers": 0 }));
                    handle.exit(2);
                }
            });
            WebviewWindowBuilder::new(app, "library", WebviewUrl::App("index.html".into()))
                .title("Peel synthetic runtime probe")
                .visible(false)
                .focused(false)
                .incognito(true)
                .data_directory(folder.join("ephemeral-webview"))
                .initialization_script(include_str!(
                    "../../../../tests/fixtures/native-peer-probe.js"
                ))
                .build()?;
            Ok(())
        })
        .build(context)
        .expect("Could not create the isolated native runtime probe")
        .run(|_, _| {});
}
