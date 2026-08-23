const TOKEN_KEY = "briar.session-token";

const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function readSessionToken() {
  if (!isTauri()) return window.localStorage.getItem(TOKEN_KEY);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("read_session_token");
}

export async function writeSessionToken(token: string) {
  if (!isTauri()) {
    window.localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("write_session_token", { token });
}

export async function clearSessionToken() {
  if (!isTauri()) {
    window.localStorage.removeItem(TOKEN_KEY);
    return;
  }
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("clear_session_token");
}
