#!/bin/bash
set -euo pipefail

isolated_merge_group=false

if [[ "${BRIAR_TRUSTED_MERGE_GROUP_CI:-}" == "1" ]]; then
  isolated_merge_group=true
  export CARGO_NET_OFFLINE=true
  [[ -n "${BRIAR_CI_WORKSPACE_ROOT:-}" &&
    -n "${BRIAR_CI_REPOSITORY_BUNDLE:-}" &&
    -r "${BRIAR_CI_BUN_CONFIG:-}" &&
    -r "${BRIAR_CI_VITEST_CONFIG:-}" &&
    "${BUN_INSTALL_CACHE_DIR:-}" == "/opt/briar/bun-cache" &&
    "${CARGO_HOME:-}" == "/opt/briar/cargo" &&
    "${RUSTUP_HOME:-}" == "/opt/briar/rustup" &&
    "${BRIAR_CI_HEAD_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
    echo "[local-ci] Missing isolated workspace root." >&2
    exit 75
  }
  runtime_cache_root="/scratch/runtime-cache"
  mkdir -p "$runtime_cache_root/bun" \
    "$runtime_cache_root/cargo" "$runtime_cache_root/rustup" \
    "$runtime_cache_root/home" "$runtime_cache_root/tmp"
  cp -a /opt/briar/bun-cache/. "$runtime_cache_root/bun/"
  cp -a /opt/briar/cargo/. "$runtime_cache_root/cargo/"
  cp -a /opt/briar/rustup/. "$runtime_cache_root/rustup/"
  chmod -R u+w "$runtime_cache_root/bun" \
    "$runtime_cache_root/cargo" "$runtime_cache_root/rustup"
  export BUN_INSTALL_CACHE_DIR="$runtime_cache_root/bun"
  export CARGO_HOME="$runtime_cache_root/cargo"
  export RUSTUP_HOME="$runtime_cache_root/rustup"
  export HOME="$runtime_cache_root/home"
  export TMPDIR="$runtime_cache_root/tmp"
  workspace_root="$BRIAR_CI_WORKSPACE_ROOT"
  mkdir -p "$workspace_root"
  git -C "$workspace_root" init --quiet || {
    echo "[local-ci] Infrastructure: isolated Git repository could not be initialized." >&2
    exit 75
  }
  git -C "$workspace_root" fetch --no-tags \
    "$BRIAR_CI_REPOSITORY_BUNDLE" "$BRIAR_CI_HEAD_SHA" || {
    echo "[local-ci] Infrastructure: exact commit could not be fetched from the trusted Git bundle." >&2
    exit 75
  }
  git -C "$workspace_root" reset --hard "$BRIAR_CI_HEAD_SHA" >/dev/null || {
    echo "[local-ci] Infrastructure: exact candidate tree could not be created." >&2
    exit 75
  }
else
  workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
fi
cd "$workspace_root"

bun() {
  if $isolated_merge_group; then
    case "${1:-}" in
      run)
        shift
        command bun run --no-env-file \
          --config="$BRIAR_CI_BUN_CONFIG" "$@"
        ;;
      install)
        shift
        command bun install --config="$BRIAR_CI_BUN_CONFIG" "$@"
        ;;
      --version)
        command bun --version
        ;;
      *)
        echo "[local-ci] Unapproved Bun invocation in trusted CI." >&2
        return 75
        ;;
    esac
  else
    command bun "$@"
  fi
}

readonly rust_toolchain="1.96.0"
readonly node_version="v22.23.2"
readonly cargo_audit_version="0.22.2"
readonly gitleaks_version="8.30.1"
readonly all_contexts=("app-worker" "d1-migrations" "rust" "security")

selected_contexts=()
should_signoff=false
ci_temp=""
ci_temp_base="${TMPDIR:-/tmp}"
ci_temp_base="${ci_temp_base%/}"

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

infra_fail() {
  echo "[local-ci] Infrastructure: $*" >&2
  exit 75
}

is_infrastructure_failure() {
  local status="$1"
  local log_path="$2"
  [[ "$status" -eq 75 || "$status" -eq 125 || "$status" -eq 126 ||
    "$status" -eq 127 || "$status" -eq 137 ]] ||
    grep -Eiq \
      'EADDRNOTAVAIL|ENOSPC|No space left on device|ENOMEM|heap out of memory|Infrastructure:|attempting to make an HTTP request.*offline|failed to download|failed to get .* as a dependency' \
      "$log_path"
}

cleanup() {
  if [[ -n "$ci_temp" ]]; then
    case "$ci_temp" in
      "$ci_temp_base"/briar-local-ci.*) rm -rf -- "$ci_temp" ;;
      *) echo "[local-ci] Refusing to clean unexpected path: $ci_temp" >&2 ;;
    esac
  fi
}
trap cleanup EXIT

require_command() {
  local command_name="$1"
  local install_hint="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    if $isolated_merge_group; then
      infra_fail "Missing ${command_name} from the pinned executor image."
    fi
    fail "Missing ${command_name}. ${install_hint}"
  fi
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
  bun run test:d1:prepare
  # Keep Miniflare and Node worker fan-out within the executor's fixed memory
  # budget. Unbounded host-core parallelism can turn fixture startup into a
  # timeout even when every suite passes in isolation.
  if $isolated_merge_group; then
    node ./node_modules/vitest/vitest.mjs run \
      --config "$BRIAR_CI_VITEST_CONFIG" \
      --exclude worker/src/migrations.test.ts \
      --exclude worker/src/db.test.ts \
      --reporter=dot --silent=passed-only \
      --maxWorkers=1
  else
    bun run test -- --maxWorkers=1
  fi
  bash -n \
    scripts/import-apple-signing-assets.sh \
    scripts/release-ios.sh \
    scripts/verify-ios-archive.sh \
    scripts/package-macos-release.sh \
    scripts/package-production-release.sh \
    scripts/release-macos-candidate.sh \
    scripts/release-macos-production.sh \
    scripts/verify-bundled-runtime.sh \
    scripts/qa-production-updater-build.sh \
    scripts/qa-macos-lifecycle.sh \
    scripts/release-cargo-cache.sh
  bun run ios:release:verify
  bun run build
  bun run build:release
  bun run worker:check
  bun run worker:build
  bun run worker:startup
}

run_d1_migrations() {
  local d1_state_dir
  local migration_log
  local migration_status
  d1_state_dir="$(mktemp -d "${TMPDIR:-/tmp}/briar-local-ci-d1.XXXXXX")"
  migration_log="$d1_state_dir/migration-tests.log"
  trap 'rm -rf "$d1_state_dir"' RETURN

  bun run d1:migrate:local -- --persist-to "$d1_state_dir"
  set +e
  if $isolated_merge_group; then
    BRIAR_D1_TEST_CACHE_RECOVERY=1 \
      node ./node_modules/vitest/vitest.mjs run \
      --config "$BRIAR_CI_VITEST_CONFIG" \
      --no-file-parallelism \
      --reporter=dot --silent=passed-only \
      worker/src/migrations.test.ts worker/src/db.test.ts \
      worker/src/test-helpers/d1-template.test.ts \
      >"$migration_log" 2>&1
  else
    bun run test:d1:migrations >"$migration_log" 2>&1
  fi
  migration_status="$?"
  set -e
  cat "$migration_log"
  if [[ "$migration_status" -ne 0 ]]; then
    if is_infrastructure_failure "$migration_status" "$migration_log"; then
      infra_fail "D1 migration tests encountered a sandbox, network, memory, or disk failure."
    fi
    return "$migration_status"
  fi

  rm -rf "$d1_state_dir"
  trap - RETURN
}

run_rust() {
  if ! rustup toolchain install "$rust_toolchain" \
    --profile minimal \
    --component rustfmt,clippy; then
    $isolated_merge_group && infra_fail "Pinned Rust toolchain is unavailable."
    return 1
  fi
  rustup run "$rust_toolchain" cargo fmt \
    --manifest-path src-tauri/Cargo.toml --all --check
  rustup run "$rust_toolchain" cargo clippy \
    --manifest-path src-tauri/Cargo.toml \
    --all-targets \
    -- \
    -D warnings
  rustup run "$rust_toolchain" cargo test --manifest-path src-tauri/Cargo.toml
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
  bun run secrets:verify-encrypted
  gitleaks git \
    --config .gitleaks.toml \
    --redact \
    --no-banner \
    --log-opts="--all" \
    .
}

context_runner() {
  case "$1" in
    app-worker) echo run_app_worker ;;
    d1-migrations) echo run_d1_migrations ;;
    rust) echo run_rust ;;
    security) echo run_security ;;
    *) fail "Unknown CI context: $1" ;;
  esac
}

prepare_parallel_inputs() {
  if includes_context rust; then
    echo
    echo "[local-ci] === shared build inputs ==="
    if ! bun run runtime:prepare || ! bun run cli:build || ! bun run agent:build; then
      $isolated_merge_group && infra_fail "Pinned shared build inputs are unavailable."
      return 1
    fi
    echo "[local-ci] ✓ shared build inputs"
  fi
}

run_selected_contexts() {
  local context
  local runner
  local log_path
  local index
  local pid
  local context_exit
  local failed=false
  local infrastructure_failed=false
  local contexts_to_run=("${selected_contexts[@]}")
  local pids=()
  local logs=()

  if includes_context app-worker && includes_context d1-migrations; then
    echo
    echo "[local-ci] Running d1-migrations before the parallel contexts."
    run_context d1-migrations run_d1_migrations
    contexts_to_run=()
    for context in "${selected_contexts[@]}"; do
      [[ "$context" == "d1-migrations" ]] || contexts_to_run+=("$context")
    done
  fi

  ci_temp="$(mktemp -d "$ci_temp_base/briar-local-ci.XXXXXX")"
  echo
  echo "[local-ci] Running ${#contexts_to_run[@]} context(s) in parallel."

  for context in "${contexts_to_run[@]}"; do
    runner="$(context_runner "$context")"
    log_path="$ci_temp/${context}.log"
    logs+=("$log_path")
    (
      run_context "$context" "$runner"
    ) >"$log_path" 2>&1 &
    pid="$!"
    pids+=("$pid")
    echo "[local-ci] Started ${context} (pid ${pid})."
  done

  for index in "${!contexts_to_run[@]}"; do
    set +e
    wait "${pids[$index]}"
    context_exit="$?"
    set -e
    if [[ "$context_exit" -ne 0 ]]; then
      failed=true
      if is_infrastructure_failure "$context_exit" "${logs[$index]}"; then
        infrastructure_failed=true
      fi
    fi
    cat "${logs[$index]}"
  done

  if [[ "$infrastructure_failed" == true ]]; then
    infra_fail "One or more CI contexts encountered a sandbox, network, memory, or disk failure."
  fi
  if [[ "$failed" == true ]]; then
    fail "One or more CI contexts failed."
  fi
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
if $isolated_merge_group; then
  require_command node "Install the pinned Node runtime in the executor image."
  [[ "$(node --version)" == "$node_version" ]] ||
    infra_fail "Expected Node ${node_version} in the executor image."
fi

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

if $isolated_merge_group; then
  # Bun 1.4 has no install --offline flag. The container network namespace is
  # absent, while this explicit scratch cache is seeded from the audited image;
  # a missing package therefore fails as infrastructure instead of fetching.
  install_command=(bun install --frozen-lockfile \
    --cache-dir="$BUN_INSTALL_CACHE_DIR" --no-progress)
else
  install_command=(bun install --frozen-lockfile)
fi
if ! "${install_command[@]}"; then
  $isolated_merge_group && infra_fail "Dependencies are absent from the pinned executor cache."
  exit 1
fi

prepare_parallel_inputs
run_selected_contexts

if $should_signoff; then
  gh signoff "${selected_contexts[@]}"
else
  echo
  echo "[local-ci] All selected checks passed."
  echo "[local-ci] After committing and pushing, run: bun run ci:signoff"
fi
