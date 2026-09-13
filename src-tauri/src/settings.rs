use crate::db::Db;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

/// Read a setting value, or `None` if it was never set.
pub fn read(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get::<_, String>(0)
    })
    .optional()
    .ok()
    .flatten()
}

/// Upsert a setting value.
pub fn write(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Whether native OS notifications should fire for reminders and timers.
/// Defaults to enabled when the user has never touched the setting.
pub fn desktop_notifications_enabled(conn: &Connection) -> bool {
    read(conn, "desktop_notifications_enabled").as_deref() != Some("false")
}

/// How notifications are shown: `"custom"` = todofy's own corner popup window,
/// `"native"` = the OS notification. Defaults to custom.
pub fn notification_style(conn: &Connection) -> String {
    read(conn, "notification_style").unwrap_or_else(|| "custom".into())
}

/// Which screen corner the custom popup appears in: one of `top-right`,
/// `top-left`, `bottom-right`, `bottom-left`. Defaults to bottom-right.
pub fn notification_position(conn: &Connection) -> String {
    read(conn, "notification_position").unwrap_or_else(|| "bottom-right".into())
}

/// How often an unanswered reminder repeats, in minutes. `None` (the default)
/// fires once and stops.
pub fn reminder_repeat_minutes(conn: &Connection) -> Option<i64> {
    read(conn, "reminder_repeat_minutes")?
        .parse::<i64>()
        .ok()
        .filter(|m| *m > 0)
}

/// What a task's play button does: `"tracker"` = a plain stopwatch,
/// `"pomodoro"` = the stopwatch plus a focus countdown bound to that task.
pub fn task_timer_mode(conn: &Connection) -> String {
    read(conn, "task_timer_mode").unwrap_or_else(|| "tracker".into())
}

/// POSIX precedence for the time locale.
const LOCALE_VARS: [&str; 3] = ["LC_ALL", "LC_TIME", "LANG"];

/// The desktop's locale as a BCP-47 tag (e.g. `de-DE`), or `None` if nothing
/// on this machine says.
///
/// Only meaningful on Linux, where `navigator.language` cannot stand in for it:
/// under WebKitGTK it commonly reports `en-US` regardless of the session's
/// `LC_TIME`, which is why clock and calendar formatting looked American on
/// systems that are not. macOS and Windows set no locale env vars for GUI
/// apps, so they return `None` here and the frontend uses the webview instead —
/// which is accurate on those platforms.
fn read_system_locale() -> Option<String> {
    locale_from_env().or_else(locale_from_session_config)
}

/// First entry, in POSIX precedence order, that names a real regional locale.
/// Entries that are absent, empty or `C`/`POSIX` carry no preference, so the
/// search continues past them instead of stopping: a session exporting
/// `LC_ALL=` would otherwise mask a perfectly good `LANG`.
fn pick_locale(lookup: impl Fn(&str) -> Option<String>) -> Option<String> {
    LOCALE_VARS
        .iter()
        .find_map(|key| normalize_locale(&lookup(key)?))
}

fn locale_from_env() -> Option<String> {
    pick_locale(|key| std::env::var(key).ok())
}

/// Sessions started by a display manager or an autostart entry often inherit no
/// locale env vars at all, so fall back to the files the system records it in.
#[cfg(target_os = "linux")]
fn locale_from_session_config() -> Option<String> {
    ["/etc/locale.conf", "/etc/default/locale"]
        .iter()
        .filter_map(|path| std::fs::read_to_string(path).ok())
        .find_map(|text| parse_locale_conf(&text))
}

#[cfg(not(target_os = "linux"))]
fn locale_from_session_config() -> Option<String> {
    None
}

/// Pull the highest-precedence locale out of a `KEY=value` locale config,
/// tolerating comments and the quoting Debian's `/etc/default/locale` uses.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
fn parse_locale_conf(text: &str) -> Option<String> {
    let mut found: [Option<&str>; LOCALE_VARS.len()] = [None; LOCALE_VARS.len()];
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let value = value.trim().trim_matches(['"', '\'']);
        if value.is_empty() {
            continue;
        }
        if let Some(rank) = LOCALE_VARS.iter().position(|k| *k == key.trim()) {
            found[rank].get_or_insert(value);
        }
    }
    pick_locale(|key| {
        let rank = LOCALE_VARS.iter().position(|k| *k == key)?;
        found[rank].map(str::to_owned)
    })
}

/// Turn a POSIX locale string into a BCP-47 tag: `de_DE.UTF-8@euro` -> `de-DE`.
/// The C/POSIX locales carry no regional convention, so they read as "no
/// preference" and let the app fall back to its own defaults.
fn normalize_locale(raw: &str) -> Option<String> {
    let base = raw
        .split(['.', '@'])
        .next()
        .unwrap_or_default()
        .replace('_', "-");
    if base.is_empty() || base.eq_ignore_ascii_case("C") || base.eq_ignore_ascii_case("POSIX") {
        return None;
    }
    Some(base)
}

#[tauri::command]
pub fn system_locale() -> Option<String> {
    read_system_locale()
}

#[tauri::command]
pub fn get_setting(db: State<Db>, key: String) -> Result<Option<String>, String> {
    Ok(read(&db.conn(), &key))
}

#[tauri::command]
pub fn set_setting(db: State<Db>, key: String, value: String) -> Result<(), String> {
    write(&db.conn(), &key, &value).map_err(|e| e.to_string())
}

/// Whether todofy is registered to launch when the user logs in.
#[tauri::command]
pub fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Enable or disable launch-on-login. The registered command carries the
/// `--autostart` flag (see `lib.rs`), which the app reads at startup to decide
/// whether to open its window or stay in the tray per the `startup_mode` setting.
#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable()
    } else {
        manager.disable()
    }
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::{normalize_locale, parse_locale_conf, pick_locale};

    /// The env path, without mutating this process's real environment.
    fn pick(vars: &[(&str, &str)]) -> Option<String> {
        pick_locale(|key| {
            vars.iter()
                .find(|(k, _)| *k == key)
                .map(|(_, v)| (*v).to_owned())
        })
    }

    /// An exported-but-empty `LC_ALL` used to end the search and strand the
    /// app on its own defaults, ignoring a perfectly good `LANG`.
    #[test]
    fn an_empty_high_precedence_var_does_not_mask_a_lower_one() {
        assert_eq!(
            pick(&[("LC_ALL", ""), ("LANG", "de_DE.UTF-8")]),
            Some("de-DE".into()),
        );
        assert_eq!(
            pick(&[("LC_ALL", "C"), ("LANG", "de_DE.UTF-8")]),
            Some("de-DE".into()),
        );
    }

    #[test]
    fn env_vars_follow_posix_precedence() {
        assert_eq!(
            pick(&[("LC_TIME", "de_DE.UTF-8"), ("LANG", "en_US.UTF-8")]),
            Some("de-DE".into()),
        );
        assert_eq!(pick(&[("LANG", "en_US.UTF-8")]), Some("en-US".into()));
        assert_eq!(pick(&[]), None);
    }

    #[test]
    fn strips_encoding_and_modifier() {
        assert_eq!(normalize_locale("de_DE.UTF-8"), Some("de-DE".into()));
        assert_eq!(normalize_locale("de_DE.UTF-8@euro"), Some("de-DE".into()));
        assert_eq!(normalize_locale("en_GB"), Some("en-GB".into()));
        assert_eq!(normalize_locale("fr"), Some("fr".into()));
    }

    #[test]
    fn treats_c_locales_as_no_preference() {
        assert_eq!(normalize_locale("C"), None);
        assert_eq!(normalize_locale("POSIX"), None);
        assert_eq!(normalize_locale("C.UTF-8"), None);
        assert_eq!(normalize_locale(""), None);
    }

    #[test]
    fn reads_locale_conf_in_posix_precedence() {
        assert_eq!(
            parse_locale_conf("LANG=en_US.UTF-8\nLC_TIME=de_DE.UTF-8\n"),
            Some("de-DE".into()),
        );
        assert_eq!(
            parse_locale_conf("LC_TIME=de_DE.UTF-8\nLC_ALL=fr_FR.UTF-8\n"),
            Some("fr-FR".into()),
        );
    }

    #[test]
    fn tolerates_quotes_comments_and_noise() {
        let text = "# session locale\nLANG=\"de_DE.UTF-8\"\nXMODIFIERS=@im=ibus\nnot a pair\n";
        assert_eq!(parse_locale_conf(text), Some("de-DE".into()));
    }

    /// An empty or C-valued entry must not mask a usable one further down.
    #[test]
    fn skips_entries_that_carry_no_preference() {
        assert_eq!(
            parse_locale_conf("LC_ALL=\nLANG=de_DE.UTF-8\n"),
            Some("de-DE".into()),
        );
        assert_eq!(
            parse_locale_conf("LC_ALL=C\nLANG=de_DE.UTF-8\n"),
            Some("de-DE".into()),
        );
        assert_eq!(parse_locale_conf("LANG=\n"), None);
        assert_eq!(parse_locale_conf(""), None);
    }
}
