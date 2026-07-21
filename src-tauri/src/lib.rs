const KEYRING_SERVICE: &str = "app.briar.desktop";
const KEYRING_USER: &str = "better-auth-session";

fn session_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|error| error.to_string())
}

#[tauri::command]
fn read_session_token() -> Result<Option<String>, String> {
    match session_entry()?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn write_session_token(token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("session token cannot be empty".to_string());
    }
    session_entry()?
        .set_password(&token)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_session_token() -> Result<(), String> {
    match session_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            read_session_token,
            write_session_token,
            clear_session_token
        ])
        .run(tauri::generate_context!())
        .expect("error while running Briar");
}
