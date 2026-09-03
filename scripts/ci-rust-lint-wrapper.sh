#!/bin/bash
# RUSTC_WORKSPACE_WRAPPER for local CI: compiles the workspace crates through
# clippy-driver so `cargo test` lints and builds in one pass, and denies every
# rustc and clippy warning for those crates only. Cargo invokes the wrapper as
# `<wrapper> <rustc> <args...>`; clippy-driver accepts that calling convention.
# Dependencies are compiled by plain rustc, exactly like `cargo clippy`.
set -euo pipefail

driver="${BRIAR_CLIPPY_DRIVER:?BRIAR_CLIPPY_DRIVER must point at clippy-driver}"
for argument in "$@"; do
  if [[ "$argument" == "--crate-name" ]]; then
    exec "$driver" "$@" -D warnings
  fi
done
# Version probes (`rustc -vV`) and similar calls pass through untouched.
exec "$driver" "$@"
