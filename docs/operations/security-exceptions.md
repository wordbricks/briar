# Security exceptions

## GHSA-f88m-g3jw-g9cj — temporary development-only exception

- Recorded: 2026-07-22
- Review by: 2026-08-05
- Dependency path: `wrangler -> miniflare -> sharp@0.34.5`
- Scope: development and CI tooling only; `sharp` is not bundled into the Briar
  desktop application or deployed Worker.
- Exposure: Briar does not pass untrusted images to Miniflare's image handling in
  local tests or CI.
- Upstream status: Wrangler 4.113.0 currently resolves Miniflare
  4.20260721.0, which pins the affected Sharp version. Sharp 0.35.x is not
  forced with an override because Miniflare declares 0.34.5 exactly and an
  unsupported override could invalidate Worker simulation.
- Removal condition: remove `--ignore GHSA-f88m-g3jw-g9cj` from
  `scripts/audit-dependencies.sh` as soon as a compatible Wrangler/Miniflare
  release resolves Sharp 0.35.0 or newer.

This exception does not lower the gate for any other high or critical advisory.

## RustSec Tauri transitive warning allowlist

- Recorded: 2026-07-22
- Review by: 2026-08-05
- Linux GTK3 graph: `RUSTSEC-2024-0411` through `RUSTSEC-2024-0420` as listed in
  `scripts/audit-rust-dependencies.sh`. These are unmaintained GTK3 bindings
  pulled by Tauri's Linux target graph.
- Linux GLib graph: `RUSTSEC-2024-0429`, an unsound `glib@0.18.5`
  `VariantStrIter` implementation pulled through `wry/webkit2gtk`.
- Build-time graph: `RUSTSEC-2024-0370`, `RUSTSEC-2025-0075`,
  `RUSTSEC-2025-0080`, `RUSTSEC-2025-0081`, `RUSTSEC-2025-0098`, and
  `RUSTSEC-2025-0100`, all unmaintained macro or Unicode crates pulled through
  Tauri and `urlpattern` build tooling.
- Scope: Briar Beta produces only a macOS desktop artifact. GTK/GLib are not
  compiled into that binary; the remaining entries are build-time warnings
  without a known vulnerability.
- Constraint: Briar must not add a Linux release target while the GTK/GLib
  entries remain allowlisted.
- Removal condition: review and remove entries after every Tauri upgrade, or
  before adding Linux builds. Remove an entry as soon as it disappears from the
  lockfile.

The audit runs once without warning denial to keep accepted debt visible, then
again with `--deny warnings` and this exact allowlist. Vulnerabilities and any
new unmaintained, unsound, or yanked advisory therefore fail the gate.
