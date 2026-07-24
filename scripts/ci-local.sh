#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$workspace_root"

readonly rust_toolchain="1.96.0"
readonly cargo_audit_version="0.22.2"
readonly gitleaks_version="8.30.1"
readonly all_contexts=("app-worker" "d1-migrations" "rust" "security")

selected_contexts=()
should_signoff=false

usage() {
  cat <<'EOF'
Usage: scripts/ci-local.sh [--signoff] [all|app-worker|d1-migrations|rust|security ...]

Runs all repository CI checks locally. The default is all contexts.
Pass --signoff only after committing and pushing the exact revision under test.
EOF
}

fail() {
  echo "[local-ci] $*" >&2
  exit 1
}

require_command() {
  local command_name="$1"
  local install_hint="$2"
  command -v "$command_name" >/dev/null 2>&1 ||
    fail "Missing ${command_name}. ${install_hint}"
}

includes_context() {
  local expected="$1"
  local context
  for context in "${selected_contexts[@]}"; do
    [[ "$context" == "$expected" ]] && return 0
  done
  return 1
}

run_context() {
  local context="$1"
  shift
  echo
  echo "[local-ci] === ${context} ==="
  "$@"
  echo "[local-ci] ✓ ${context}"
}

run_app_worker() {
  if [[ -d .github/workflows ]] &&
    find .github/workflows -type f -print -quit | grep -q .; then
    fail "GitHub Actions workflows are not allowed; use the local CI and release scripts."
  fi
  bun run check
  bun run test
  bash -n \
    scripts/import-apple-signing-assets.sh \
    scripts/package-macos-release.sh \
    scripts/package-production-release.sh \
    scripts/release-macos-candidate.sh \
    scripts/release-macos-production.sh \
    scripts/qa-production-updater-build.sh \
    scripts/qa-macos-lifecycle.sh
  bun run build
  bun run build:release
  bun run worker:check
  bun run worker:build
  bun run worker:startup
}

run_d1_migrations() {
  local d1_state_dir
  d1_state_dir="$(mktemp -d "${TMPDIR:-/tmp}/briar-local-ci-d1.XXXXXX")"
  trap 'rm -rf "$d1_state_dir"' RETURN

  bun run d1:migrate:local -- --persist-to "$d1_state_dir"
  bun run test -- worker/src/db.test.ts

  rm -rf "$d1_state_dir"
  trap - RETURN
}

run_rust() {
  rustup toolchain install "$rust_toolchain" \
    --profile minimal \
    --component rustfmt,clippy
  bun run cli:build
  cargo +"$rust_toolchain" fmt --manifest-path src-tauri/Cargo.toml --all --check
  cargo +"$rust_toolchain" clippy \
    --manifest-path src-tauri/Cargo.toml \
    --all-targets \
    -- \
    -D warnings
  cargo +"$rust_toolchain" test --manifest-path src-tauri/Cargo.toml
}

run_security() {
  local detected_cargo_audit_version
  local detected_gitleaks_version

  detected_cargo_audit_version="$(cargo-audit --version)"
  [[ "$detected_cargo_audit_version" == "cargo-audit ${cargo_audit_version}" ]] ||
    fail "Expected cargo-audit ${cargo_audit_version}, found ${detected_cargo_audit_version}."

  detected_gitleaks_version="$(gitleaks version)"
  [[ "$detected_gitleaks_version" == "$gitleaks_version" ]] ||
    fail "Expected gitleaks ${gitleaks_version}, found ${detected_gitleaks_version}."

  bun run audit:dependencies
  bun run audit:rust
  gitleaks git \
    --config .gitleaks.toml \
    --redact \
    --no-banner \
    --log-opts="--all" \
    .
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --signoff)
      should_signoff=true
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    all)
      selected_contexts=("${all_contexts[@]}")
      ;;
    app-worker|d1-migrations|rust|security)
      selected_contexts+=("$1")
      ;;
    *)
      usage >&2
      fail "Unknown argument: $1"
      ;;
  esac
  shift
done

if [[ ${#selected_contexts[@]} -eq 0 ]]; then
  selected_contexts=("${all_contexts[@]}")
fi

require_command bun "Install Bun before running local CI."
require_command rustup "Install rustup before running the Rust checks."

if includes_context security; then
  require_command cargo-audit \
    "Run: cargo install cargo-audit --version ${cargo_audit_version} --locked"
  require_command gitleaks \
    "Install gitleaks ${gitleaks_version}: https://github.com/gitleaks/gitleaks"
fi

if $should_signoff; then
  require_command gh "Install the GitHub CLI and authenticate it."
  gh extension list | grep -q '^gh signoff' ||
    fail "Install gh-signoff first: gh extension install basecamp/gh-signoff"
fi

bun install --frozen-lockfile

includes_context app-worker && run_context app-worker run_app_worker
includes_context d1-migrations && run_context d1-migrations run_d1_migrations
includes_context rust && run_context rust run_rust
includes_context security && run_context security run_security

if $should_signoff; then
  gh signoff "${selected_contexts[@]}"
else
  echo
  echo "[local-ci] All selected checks passed."
  echo "[local-ci] After committing and pushing, run: bun run ci:signoff"
fi
