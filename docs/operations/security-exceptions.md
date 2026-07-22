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
