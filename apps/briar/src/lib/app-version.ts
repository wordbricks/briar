import packageJson from "../../../../package.json";

/** App version from package.json (kept in sync with tauri.conf.json). */
export const APP_VERSION = packageJson.version;

export function formatAppVersionLabel(version: string = APP_VERSION) {
  return version.startsWith("v") ? version : `v${version}`;
}
