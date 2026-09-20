use base64::Engine;
use minisign_verify::{PublicKey, Signature};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::{db::Db, settings};

const CATALOG_URL: &str =
    "https://github.com/salarzeidanlou/todofy/releases/latest/download/voice-catalog.json";
// Same release key as the signed Tauri updater. The private key stays in CI.
const PUBLIC_KEY: &str = "RWQACIxsjt28eA2jMqZt4mkBwUhT5e+889A91DmD1taHYdUdlGbDNKA/";
const MAX_CATALOG_BYTES: usize = 256 * 1024;
const MAX_ASSET_BYTES: u64 = 500 * 1024 * 1024;
const MODE_KEY: &str = "voice_mode_enabled";
const MODEL_KEY: &str = "voice_model";
const CATALOG_ID_KEY: &str = "voice_catalog_id";
const PENDING_CATALOG_ID_KEY: &str = "voice_pending_catalog_id";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Asset {
    pub url: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct Catalog {
    pub schema: u32,
    pub version: String,
    pub engines: HashMap<String, Asset>,
    pub models: HashMap<String, Asset>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceStatus {
    pub enabled: bool,
    pub ready: bool,
    pub engine_installed: bool,
    pub models_installed: HashMap<String, bool>,
    pub selected_model: String,
    pub catalog_version: Option<String>,
    pub update_version: Option<String>,
    pub update_engine_installed: bool,
    pub update_models_installed: HashMap<String, bool>,
    pub platform_supported: bool,
    pub development_assets: bool,
}

// Explicit local files are accepted only by `tauri dev`/debug builds. Release
// builds always require the signed catalog and verified downloads.
#[cfg(debug_assertions)]
struct DevelopmentAssets {
    engine: PathBuf,
    tiny: Option<PathBuf>,
    base: Option<PathBuf>,
}

#[cfg(debug_assertions)]
impl DevelopmentAssets {
    fn model(&self, name: &str) -> Option<&PathBuf> {
        match name {
            "tiny" => self.tiny.as_ref(),
            "base" => self.base.as_ref(),
            _ => None,
        }
    }
}

#[cfg(debug_assertions)]
fn development_assets() -> Option<DevelopmentAssets> {
    let engine = std::env::var_os("TODOFY_VOICE_DEV_ENGINE")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)?;
    Some(DevelopmentAssets {
        engine,
        tiny: std::env::var_os("TODOFY_VOICE_DEV_MODEL_TINY").map(PathBuf::from),
        base: std::env::var_os("TODOFY_VOICE_DEV_MODEL_BASE").map(PathBuf::from),
    })
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    asset: String,
    received: u64,
    total: u64,
}

pub fn platform_key() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("linux-x86_64"),
        ("macos", "x86_64") => Some("darwin-x86_64"),
        ("macos", "aarch64") => Some("darwin-aarch64"),
        ("windows", "x86_64") => Some("windows-x86_64"),
        _ => None,
    }
}

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("voice-assets");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn client() -> Result<Client, String> {
    Client::builder()
        .user_agent("todofy-voice/1")
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30 * 60))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || attempt.url().scheme() != "https" {
                attempt.error("unsafe download redirect")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}

fn get_limited(client: &Client, url: &str, limit: usize) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .send()
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err("Voice catalog is too large".into());
    }
    let mut bytes = Vec::new();
    response
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > limit {
        return Err("Voice catalog is too large".into());
    }
    Ok(bytes)
}

fn verify_catalog(bytes: &[u8], signature: &[u8]) -> Result<Catalog, String> {
    verify_catalog_signature(bytes, signature, PUBLIC_KEY)?;
    let catalog: Catalog = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    validate_catalog(&catalog)?;
    Ok(catalog)
}

fn verify_catalog_signature(
    bytes: &[u8],
    signature: &[u8],
    public_key: &str,
) -> Result<(), String> {
    let key = PublicKey::from_base64(public_key).map_err(|e| e.to_string())?;
    // Tauri's signer writes the Minisign signature itself as base64, like
    // updater artifact .sig files. Decode that wrapper before Minisign.
    let encoded = std::str::from_utf8(signature).map_err(|e| e.to_string())?;
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded.trim())
        .map_err(|e| e.to_string())?;
    let signature = Signature::decode(std::str::from_utf8(&decoded).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    key.verify(bytes, &signature, true)
        .map_err(|e| format!("Voice catalog signature failed: {e}"))?;
    Ok(())
}

fn validate_asset(asset: &Asset) -> Result<(), String> {
    let url = reqwest::Url::parse(&asset.url).map_err(|e| e.to_string())?;
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || !url
            .path()
            .starts_with("/salarzeidanlou/todofy/releases/download/")
        || asset.size == 0
        || asset.size > MAX_ASSET_BYTES
        || asset.sha256.len() != 64
        || !asset.sha256.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err("Voice catalog contains an invalid asset".into());
    }
    Ok(())
}

fn validate_catalog(catalog: &Catalog) -> Result<(), String> {
    if catalog.schema != 1 || catalog.version.is_empty() || catalog.version.len() > 64 {
        return Err("Unsupported voice catalog".into());
    }
    for asset in catalog.engines.values().chain(catalog.models.values()) {
        validate_asset(asset)?;
    }
    for model in ["tiny", "base"] {
        if !catalog.models.contains_key(model) {
            return Err("Voice catalog is missing a model".into());
        }
    }
    Ok(())
}

pub fn refresh_catalog(app: &AppHandle) -> Result<Catalog, String> {
    let client = client()?;
    let bytes = get_limited(&client, CATALOG_URL, MAX_CATALOG_BYTES)?;
    let sig = get_limited(&client, &format!("{CATALOG_URL}.sig"), 4096)?;
    let catalog = verify_catalog(&bytes, &sig)?;
    let current = cached_catalog(app)?;
    if current.as_ref() == Some(&catalog) {
        let db = app.state::<Db>();
        settings::write(&db.conn(), PENDING_CATALOG_ID_KEY, "").map_err(|e| e.to_string())?;
        return Ok(catalog);
    }
    // Each catalog is immutable. Switching the SQLite pointer after both files
    // are written avoids a half-updated JSON/signature pair on every platform.
    let id = uuid::Uuid::new_v4().to_string();
    let dir = root(app)?.join("catalogs").join(&id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("catalog.json"), &bytes).map_err(|e| e.to_string())?;
    fs::write(dir.join("catalog.json.sig"), &sig).map_err(|e| e.to_string())?;
    let db = app.state::<Db>();
    let key = if current.is_some() {
        PENDING_CATALOG_ID_KEY
    } else {
        CATALOG_ID_KEY
    };
    settings::write(&db.conn(), key, &id).map_err(|e| e.to_string())?;
    drop(db);
    if current.is_some() {
        activate_pending_if_ready(app, &catalog)?;
    }
    Ok(catalog)
}

fn catalog_by_key(app: &AppHandle, key: &str) -> Result<Option<Catalog>, String> {
    let db = app.state::<Db>();
    let Some(id) = settings::read(&db.conn(), key).filter(|id| !id.is_empty()) else {
        return Ok(None);
    };
    uuid::Uuid::parse_str(&id).map_err(|_| "Invalid voice catalog reference")?;
    let dir = root(app)?.join("catalogs").join(id);
    let bytes = fs::read(dir.join("catalog.json")).map_err(|e| e.to_string())?;
    let sig = fs::read(dir.join("catalog.json.sig")).map_err(|e| e.to_string())?;
    Ok(Some(verify_catalog(&bytes, &sig)?))
}

pub fn cached_catalog(app: &AppHandle) -> Result<Option<Catalog>, String> {
    catalog_by_key(app, CATALOG_ID_KEY)
}

fn pending_catalog(app: &AppHandle) -> Result<Option<Catalog>, String> {
    catalog_by_key(app, PENDING_CATALOG_ID_KEY)
}

fn asset_path(app: &AppHandle, kind: &str, name: &str, asset: &Asset) -> Result<PathBuf, String> {
    let dir = root(app)?;
    let ext = if kind == "engine" && cfg!(windows) {
        "exe"
    } else if kind == "engine" {
        "bin"
    } else {
        "ggml"
    };
    Ok(dir.join(format!("{kind}-{name}-{}.{}", asset.sha256, ext)))
}

fn digest(path: &Path) -> Result<(u64, String), String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut size = 0;
    let mut chunk = [0u8; 64 * 1024];
    loop {
        let n = file.read(&mut chunk).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        size += n as u64;
        hash.update(&chunk[..n]);
    }
    Ok((size, format!("{:x}", hash.finalize())))
}

fn installed(app: &AppHandle, kind: &str, name: &str, asset: &Asset) -> bool {
    let Ok(path) = asset_path(app, kind, name, asset) else {
        return false;
    };
    digest(&path).is_ok_and(|(size, sha)| size == asset.size && sha == asset.sha256)
}

pub fn selected_model(app: &AppHandle) -> String {
    let db = app.state::<Db>();
    let stored = settings::read(&db.conn(), MODEL_KEY);
    #[cfg(debug_assertions)]
    if stored.is_none() {
        if let Some(dev) = development_assets() {
            if dev.tiny.as_ref().is_some_and(|path| path.is_file())
                && !dev.base.as_ref().is_some_and(|path| path.is_file())
            {
                return "tiny".into();
            }
        }
    }
    let model = stored.unwrap_or_else(|| "base".into());
    if model == "tiny" {
        model
    } else {
        "base".into()
    }
}

pub fn status(app: &AppHandle) -> Result<VoiceStatus, String> {
    let db = app.state::<Db>();
    let enabled = settings::read(&db.conn(), MODE_KEY).as_deref() == Some("true");
    drop(db);
    let selected_model = selected_model(app);
    #[cfg(debug_assertions)]
    if let Some(dev) = development_assets() {
        let engine_installed = dev.engine.is_file();
        let models_installed = ["tiny", "base"]
            .into_iter()
            .map(|name| {
                (
                    name.to_string(),
                    dev.model(name).is_some_and(|path| path.is_file()),
                )
            })
            .collect::<HashMap<_, _>>();
        let ready =
            enabled && engine_installed && models_installed.get(&selected_model) == Some(&true);
        return Ok(VoiceStatus {
            enabled,
            ready,
            engine_installed,
            models_installed,
            selected_model,
            catalog_version: None,
            update_version: None,
            update_engine_installed: false,
            update_models_installed: [("tiny".to_string(), false), ("base".to_string(), false)]
                .into_iter()
                .collect(),
            platform_supported: true,
            development_assets: true,
        });
    }
    let catalog = cached_catalog(app)?;
    let pending = pending_catalog(app)?;
    let engine_installed = catalog
        .as_ref()
        .and_then(|c| platform_key().and_then(|key| c.engines.get(key)))
        .is_some_and(|asset| installed(app, "engine", platform_key().unwrap_or_default(), asset));
    let models_installed = ["tiny", "base"]
        .into_iter()
        .map(|name| {
            (
                name.to_string(),
                catalog
                    .as_ref()
                    .and_then(|c| c.models.get(name))
                    .is_some_and(|asset| installed(app, "model", name, asset)),
            )
        })
        .collect::<HashMap<_, _>>();
    let update_engine_installed = pending
        .as_ref()
        .and_then(|c| platform_key().and_then(|key| c.engines.get(key)))
        .is_some_and(|asset| installed(app, "engine", platform_key().unwrap_or_default(), asset));
    let update_models_installed = ["tiny", "base"]
        .into_iter()
        .map(|name| {
            (
                name.to_string(),
                pending
                    .as_ref()
                    .and_then(|c| c.models.get(name))
                    .is_some_and(|asset| installed(app, "model", name, asset)),
            )
        })
        .collect::<HashMap<_, _>>();
    let ready = enabled && engine_installed && models_installed.get(&selected_model) == Some(&true);
    Ok(VoiceStatus {
        enabled,
        ready,
        engine_installed,
        models_installed,
        selected_model,
        catalog_version: catalog.map(|c| c.version),
        update_version: pending.map(|c| c.version),
        update_engine_installed,
        update_models_installed,
        platform_supported: platform_key().is_some(),
        development_assets: false,
    })
}

fn activate_pending_if_ready(app: &AppHandle, catalog: &Catalog) -> Result<(), String> {
    let Some(key) = platform_key() else {
        return Ok(());
    };
    let model_name = selected_model(app);
    let engine_ready = catalog
        .engines
        .get(key)
        .is_some_and(|asset| installed(app, "engine", key, asset));
    let model_ready = catalog
        .models
        .get(&model_name)
        .is_some_and(|asset| installed(app, "model", &model_name, asset));
    if engine_ready && model_ready {
        let db = app.state::<Db>();
        let pending_id =
            settings::read(&db.conn(), PENDING_CATALOG_ID_KEY).ok_or("Voice update is missing")?;
        settings::write(&db.conn(), CATALOG_ID_KEY, &pending_id).map_err(|e| e.to_string())?;
        settings::write(&db.conn(), PENDING_CATALOG_ID_KEY, "").map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn checked_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let status = status(app)?;
    if !status.ready {
        if status.development_assets {
            return Err("Enable Voice Mode with an available local engine and model.".into());
        }
        return Err(
            "Enable Voice Mode after downloading the engine and a model in Settings.".into(),
        );
    }
    #[cfg(debug_assertions)]
    if let Some(dev) = development_assets() {
        let model = dev
            .model(&status.selected_model)
            .ok_or("Local voice model is unavailable")?
            .clone();
        return Ok((dev.engine, model));
    }
    let catalog = cached_catalog(app)?.ok_or("Voice catalog is missing")?;
    let key = platform_key().ok_or("This platform is not supported")?;
    let engine = catalog
        .engines
        .get(key)
        .ok_or("Voice engine is unavailable")?;
    let model = catalog
        .models
        .get(&status.selected_model)
        .ok_or("Voice model is unavailable")?;
    Ok((
        asset_path(app, "engine", key, engine)?,
        asset_path(app, "model", &status.selected_model, model)?,
    ))
}

pub fn download(
    app: &AppHandle,
    kind: &str,
    model: Option<&str>,
    cancelled: impl Fn() -> bool,
) -> Result<(), String> {
    // Keep a working installed version stable until the person explicitly
    // checks for updates. A failed asset download cannot switch the catalog.
    let catalog = if let Some(pending) = pending_catalog(app)? {
        pending
    } else if let Some(active) = cached_catalog(app)? {
        active
    } else {
        refresh_catalog(app)?
    };
    let name = if kind == "engine" {
        platform_key().ok_or("This platform is not supported")?
    } else {
        model.ok_or("Choose a model")?
    };
    if kind != "engine" && (kind != "model" || !["tiny", "base"].contains(&name)) {
        return Err("Unknown voice asset".into());
    }
    let asset = if kind == "engine" {
        catalog.engines.get(name)
    } else {
        catalog.models.get(name)
    }
    .ok_or("Voice asset is unavailable")?;
    let dest = asset_path(app, kind, name, asset)?;
    if installed(app, kind, name, asset) {
        if pending_catalog(app)?.as_ref() == Some(&catalog) {
            activate_pending_if_ready(app, &catalog)?;
        }
        return Ok(());
    }
    let temp = dest.with_extension("part");
    let result = (|| -> Result<(), String> {
        let client = client()?;
        let mut response = client
            .get(&asset.url)
            .send()
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let mut file = fs::File::create(&temp).map_err(|e| e.to_string())?;
        let mut hash = Sha256::new();
        let mut received = 0u64;
        let mut chunk = [0u8; 64 * 1024];
        loop {
            if cancelled() {
                return Err("Download cancelled".into());
            }
            let n = response.read(&mut chunk).map_err(|e| e.to_string())?;
            if n == 0 {
                break;
            }
            received += n as u64;
            if received > asset.size {
                return Err("Voice asset exceeded its expected size".into());
            }
            file.write_all(&chunk[..n]).map_err(|e| e.to_string())?;
            hash.update(&chunk[..n]);
            let _ = app.emit(
                "voice-download-progress",
                DownloadProgress {
                    asset: format!("{kind}:{name}"),
                    received,
                    total: asset.size,
                },
            );
        }
        file.sync_all().map_err(|e| e.to_string())?;
        if received != asset.size || format!("{:x}", hash.finalize()) != asset.sha256 {
            return Err("Voice asset checksum did not match the signed catalog".into());
        }
        #[cfg(unix)]
        {
            if kind == "engine" {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&temp, fs::Permissions::from_mode(0o700))
                    .map_err(|e| e.to_string())?;
            }
        }
        let notice = if kind == "engine" {
            (
                "whisper.cpp.LICENSE",
                include_str!("../../../docs/third_party/whisper.cpp.LICENSE"),
            )
        } else {
            (
                "openai-whisper.LICENSE",
                include_str!("../../../docs/third_party/openai-whisper.LICENSE"),
            )
        };
        fs::write(root(app)?.join(notice.0), notice.1).map_err(|e| e.to_string())?;
        // On Windows rename cannot replace an existing corrupted file.
        if dest.exists() {
            fs::remove_file(&dest).map_err(|e| e.to_string())?;
        }
        fs::rename(&temp, &dest).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    if result.is_ok() && pending_catalog(app)?.as_ref() == Some(&catalog) {
        activate_pending_if_ready(app, &catalog)?;
    }
    result
}

pub fn remove(app: &AppHandle, kind: &str, model: Option<&str>) -> Result<(), String> {
    let dir = root(app)?;
    let prefixes = if kind == "all" {
        vec!["engine-".to_string(), "model-".to_string()]
    } else if kind == "engine" {
        vec!["engine-".to_string()]
    } else if kind == "model" && ["tiny", "base"].contains(&model.unwrap_or("")) {
        vec![format!("model-{}-", model.unwrap())]
    } else {
        return Err("Unknown voice asset".into());
    };
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if prefixes
            .iter()
            .any(|prefix| entry.file_name().to_string_lossy().starts_with(prefix))
        {
            fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    if kind == "all" || kind == "engine" || model == Some(selected_model(app).as_str()) {
        let db = app.state::<Db>();
        settings::write(&db.conn(), MODE_KEY, "false").map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn set_mode(app: &AppHandle, enabled: bool) -> Result<VoiceStatus, String> {
    if enabled {
        let status = status(app)?;
        if !status.engine_installed
            || status.models_installed.get(&status.selected_model) != Some(&true)
        {
            return Err("Download the voice engine and selected model first".into());
        }
    }
    let db = app.state::<Db>();
    settings::write(&db.conn(), MODE_KEY, if enabled { "true" } else { "false" })
        .map_err(|e| e.to_string())?;
    drop(db);
    status(app)
}

pub fn set_model(app: &AppHandle, model: &str) -> Result<VoiceStatus, String> {
    if !["tiny", "base"].contains(&model) {
        return Err("Unknown voice model".into());
    }
    let db = app.state::<Db>();
    settings::write(&db.conn(), MODEL_KEY, model).map_err(|e| e.to_string())?;
    drop(db);
    if let Some(pending) = pending_catalog(app)? {
        activate_pending_if_ready(app, &pending)?;
    }
    let current = status(app)?;
    if current.enabled && !current.ready {
        return set_mode(app, false);
    }
    Ok(current)
}

#[cfg(test)]
mod tests {
    use super::*;
    const TEST_PUBLIC_KEY: &str = "RWRwHwK721m1VDhzW74GmdgF3BPXzp4s7PR1cUHuXGTrIUI7DBROPEQV";
    const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSd0h3SzcyMW0xVkJYTy9nS0FZYnc1enpZdmZsYlUxcEVYb3Zzc1Iya1pCQ3J0VEduK3djT1NlQWN4Y0NPS2E2VlVXcjJWM0hXaFJBKzVmVzNnVnRNUmtuTzRqNERwYndjPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg5ODQ1MjAzCWZpbGU6dG9kb2Z5LXZvaWNlLXRlc3QudHh0CjdxMXhqNXRJYjZNSnNGUUVydlFJQ2Q2ZnM5NXViVDhVL3h0dWFjZ0lnM3pkY1RTOU4wQ0NRa3RuMDI2QWZCcjh0YkNuMStRWit0TDdVOW8vNE9HSER3PT0K";

    #[test]
    fn accepts_tauri_signer_output_and_rejects_changed_bytes() {
        assert!(verify_catalog_signature(
            b"test catalog",
            TEST_SIGNATURE.as_bytes(),
            TEST_PUBLIC_KEY
        )
        .is_ok());
        assert!(verify_catalog_signature(
            b"altered catalog",
            TEST_SIGNATURE.as_bytes(),
            TEST_PUBLIC_KEY
        )
        .is_err());
    }

    #[test]
    fn rejects_untrusted_asset_location() {
        let asset = Asset {
            url: "http://example.com/evil".into(),
            size: 10,
            sha256: "0".repeat(64),
        };
        assert!(validate_asset(&asset).is_err());
    }
}
