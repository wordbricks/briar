#!/bin/bash
set -euo pipefail

cargo_audit_bin="${CARGO_AUDIT_BIN:-cargo-audit}"
lockfile="apps/briar/src-tauri/Cargo.lock"
# Keep accepted warnings visible before enforcing the exact dated allowlist.
"$cargo_audit_bin" audit --file "$lockfile"

# Yanked crates have no advisory ID, so they cannot go through --ignore. Each
# entry is "name version expires-on"; past its date the crate fails again.
# zip 4.x is entirely yanked and tauri-plugin-updater (2.14.0 and the 3.0
# alphas) still requires zip ^4; revisit when the updater moves to zip 9.
yanked_allowlist=(
  "zip 4.6.1 2026-11-16"
)

ignore_args=()
for advisory in \
  RUSTSEC-2024-0370 \
  RUSTSEC-2024-0411 \
  RUSTSEC-2024-0412 \
  RUSTSEC-2024-0413 \
  RUSTSEC-2024-0414 \
  RUSTSEC-2024-0415 \
  RUSTSEC-2024-0416 \
  RUSTSEC-2024-0417 \
  RUSTSEC-2024-0418 \
  RUSTSEC-2024-0419 \
  RUSTSEC-2024-0420 \
  RUSTSEC-2024-0429 \
  RUSTSEC-2024-0436 \
  RUSTSEC-2025-0075 \
  RUSTSEC-2025-0080 \
  RUSTSEC-2025-0081 \
  RUSTSEC-2025-0098 \
  RUSTSEC-2025-0100
do
  ignore_args+=(--ignore "$advisory")
done

# The advisory DB was just fetched above; reuse it instead of fetching twice.
# cargo-audit exits non-zero on vulnerabilities; the report is checked below.
report="$("$cargo_audit_bin" audit --file "$lockfile" --no-fetch --json \
  "${ignore_args[@]}" || true)"

today="$(date -u +%F)"
allowed_yanked="$(
  for entry in "${yanked_allowlist[@]}"; do
    read -r name version expires <<<"$entry"
    if [[ "$today" > "$expires" ]]; then
      echo "Yanked-crate exception for $name $version expired on $expires." >&2
      continue
    fi
    printf '%s %s\n' "$name" "$version"
  done
)"

jq -e --arg allowed "$allowed_yanked" '
  ($allowed | split("\n") | map(select(length > 0))) as $allow
  | [
      (.vulnerabilities.list[]? | "vulnerability \(.advisory.id) in \(.package.name) \(.package.version)"),
      (.warnings | to_entries[] | .key as $kind | .value[]
        | "\(.package.name) \(.package.version)" as $crate
        | select(($kind == "yanked" and ($allow | index($crate))) | not)
        | "\($kind) \(.advisory.id // "-") in \(.package.name) \(.package.version)")
    ] as $denied
  | if ($denied | length) == 0 then true
    else ($denied[] | "denied: \(.)\n" | stderr) | false end
' <<<"$report" >/dev/null || {
  echo "Rust dependency audit found denied findings (see above)." >&2
  exit 1
}
