import { commands } from "../generated/tauri";

const TOKEN_KEY = "briar.session-token";

const isTauri = () => "__TAURI_INTERNALS__" in window;

export async function readSessionToken() {
  if (!isTauri()) return window.localStorage.getItem(TOKEN_KEY);
  return commands.readSessionToken();
}

export async function writeSessionToken(token: string) {
  if (!isTauri()) {
    window.localStorage.setItem(TOKEN_KEY, token);
    return;
  }
  await commands.writeSessionToken(token);
}

export async function clearSessionToken() {
  if (!isTauri()) {
    window.localStorage.removeItem(TOKEN_KEY);
    return;
  }
  await commands.clearSessionToken();
}
