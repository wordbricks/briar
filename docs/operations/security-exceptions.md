# Security exceptions

## Gitleaks public promotion campaign identifier

- Recorded: 2026-09-03
- Review by: 2026-10-03
- Finding: `generic-api-key` on the public Jay slot 10 campaign identifier
  in `apps/briar/worker/src/managed-computer-promotion-campaigns.test.ts`,
  introduced by commit `1a74d6a8046ac296b40ba303c93765eb3962949a`.
- This is the public campaign identifier stored in the migration. Promotion
  credentials are separate values in `MANAGED_COMPUTER_PROMOTION_CODE`.
- Scope: the allowlist requires both that exact test file and the exact
  `code_key` line. Other identifiers, credentials, and files remain scanned.
- Removal condition: remove the entry when Gitleaks no longer flags this
  public identifier, or when the historical fixture is no longer scanned.

## GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq — temporary landing build exception

- Recorded: 2026-08-23
- Review by: 2026-09-06
- Dependency path: `vinext@0.0.50 -> image-size@2.0.2`
- Scope: landing build tooling only. Vinext calls `image-size` while Vite builds
  statically imported images and metadata routes. The landing build processes
  only repository-managed PNG, WebP, and GIF assets; it contains no ICNS, JXL,
  HEIF, or HEIC input and does not accept user-supplied build assets.
- Production exposure: the generated Cloudflare Worker bundle does not contain
  the `image-size` parser. Runtime image transformations use the Cloudflare
  `IMAGES` binding, so untrusted requests do not reach this dependency.
- Upstream status: both advisories affect every published `image-size` version
  through 2.0.2, and the advisory database lists no patched version. Vinext
  pins 2.0.2 through `1.0.0-beta.5`; `1.0.0-beta.6` removes the dependency.
- Compatibility constraint: upgrading to Vinext `1.0.0-beta.6` was tested, but
  changed the locale redirect `Location` from the current absolute
  `http://localhost/ko` contract to relative `/ko`, failing
  `apps/landing/tests/rendered-html.check.mjs`. The beta upgrade was therefore
  reverted instead of weakening that routing contract as part of a security
  dependency update.
- Removal conditions: remove both ignores as soon as a patched `image-size`
  release is accepted by Vinext, or a Vinext release without this dependency
  preserves the absolute redirect contract (or that contract is deliberately
  migrated and reviewed). Revoke this exception immediately if landing builds
  begin processing untrusted or externally supplied images.

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
