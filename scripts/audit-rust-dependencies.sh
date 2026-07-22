#!/bin/bash
set -euo pipefail

cargo_audit_bin="${CARGO_AUDIT_BIN:-cargo-audit}"
lockfile="src-tauri/Cargo.lock"

# Keep accepted warnings visible before enforcing the exact dated allowlist.
"$cargo_audit_bin" audit --file "$lockfile"

"$cargo_audit_bin" audit --file "$lockfile" --deny warnings \
  --ignore RUSTSEC-2024-0370 \
  --ignore RUSTSEC-2024-0411 \
  --ignore RUSTSEC-2024-0412 \
  --ignore RUSTSEC-2024-0413 \
  --ignore RUSTSEC-2024-0414 \
  --ignore RUSTSEC-2024-0415 \
  --ignore RUSTSEC-2024-0416 \
  --ignore RUSTSEC-2024-0417 \
  --ignore RUSTSEC-2024-0418 \
  --ignore RUSTSEC-2024-0419 \
  --ignore RUSTSEC-2024-0420 \
  --ignore RUSTSEC-2024-0429 \
  --ignore RUSTSEC-2025-0075 \
  --ignore RUSTSEC-2025-0080 \
  --ignore RUSTSEC-2025-0081 \
  --ignore RUSTSEC-2025-0098 \
  --ignore RUSTSEC-2025-0100
