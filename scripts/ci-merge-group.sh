#!/bin/bash
set -Eeuo pipefail

# The parent mounts this signed-base file at a second, read-only path. Keeping
# the Bun policy here avoids a candidate-writable shim directory.
if [[ "${0##*/}" == "bun" ]]; then
  [[ "${BRIAR_TRUSTED_MERGE_GROUP_CI:-}" == "1" &&
    "${BRIAR_CI_BUN_CONFIG:-}" == "/opt/briar/bunfig.toml" &&
    -r /opt/briar/bunfig.toml ]] || exit 75
  case "${1:-}" in
    install)
      shift
      exec /usr/local/bin/bun install \
        --config=/opt/briar/bunfig.toml \
        --cache-dir=/opt/briar/bun-cache \
        --frozen-lockfile --ignore-scripts --no-progress "$@"
      ;;
    run)
      shift
      exec /usr/local/bin/bun run --no-env-file \
        --config=/opt/briar/bunfig.toml "$@"
      ;;
    *)
      exec /usr/local/bin/bun --no-env-file \
        --config=/opt/briar/bunfig.toml "$@"
      ;;
  esac
fi

context="${1:-}"
phase="${2:-}"
case "$context:$phase" in
  app-worker:app-check|app-worker:app-d1-prepare|app-worker:app-test|\
  app-worker:app-shell|app-worker:app-ios-verify|app-worker:app-build|\
  app-worker:app-release-build|app-worker:app-worker-check|\
  app-worker:app-worker-build|app-worker:app-worker-startup|\
  d1-migrations:d1-apply|d1-migrations:d1-test|\
  rust:rust-fmt|rust:rust-clippy|rust:rust-test|\
  security:security-bun-audit|security:security-rust-audit|\
  security:security-encrypted-env|security:security-gitleaks) ;;
  *) echo "A fixed merge-group CI context and phase are required." >&2; exit 75 ;;
esac

[[ "${BRIAR_TRUSTED_MERGE_GROUP_CI:-}" == "1" &&
  "${BRIAR_CI_WORKSPACE_ROOT:-}" == "/scratch/workspace" &&
  "${BRIAR_CI_REPOSITORY_BUNDLE:-}" == "/opt/briar/repository.bundle" &&
  "${BRIAR_CI_BUN_CONFIG:-}" == "/opt/briar/bunfig.toml" &&
  "${BRIAR_CI_HEAD_SHA:-}" =~ ^[0-9a-f]{40}$ &&
  -r /opt/briar/repository.bundle &&
  -x /opt/briar/trusted-bin/bun &&
  -r /opt/briar/bunfig.toml ]] || {
  echo "The isolated merge-group input contract is incomplete." >&2
  exit 75
}

export BUN_INSTALL_CACHE_DIR=/opt/briar/bun-cache
export CARGO_HOME=/scratch/cargo
export CARGO_NET_OFFLINE=true
export GIT_ATTR_NOSYSTEM=1
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_CONFIG_SYSTEM=/dev/null
export GIT_GRAFT_FILE=/dev/null
export GIT_NO_REPLACE_OBJECTS=1
export GIT_OPTIONAL_LOCKS=0
export HOME=/scratch/home
export PATH=/opt/briar/trusted-bin:/opt/briar/cargo/bin:/usr/local/bin:/usr/bin:/bin
export RUSTUP_HOME=/scratch/rustup
export TMPDIR=/tmp

infrastructure_failure() {
  echo "The isolated merge-group phase failed during trusted setup." >&2
  exit 75
}
trap infrastructure_failure ERR

mkdir -p \
  "$HOME" "$BRIAR_CI_WORKSPACE_ROOT" \
  "$CARGO_HOME" "$RUSTUP_HOME/downloads" "$RUSTUP_HOME/tmp"

for cargo_entry in bin registry git advisory-db; do
  if [[ -e "/opt/briar/cargo/$cargo_entry" ]]; then
    ln -s "/opt/briar/cargo/$cargo_entry" "$CARGO_HOME/$cargo_entry"
  fi
done
ln -s /opt/briar/rustup/toolchains "$RUSTUP_HOME/toolchains"
if [[ -d /opt/briar/rustup/update-hashes ]]; then
  cp -a /opt/briar/rustup/update-hashes "$RUSTUP_HOME/update-hashes"
fi
if [[ -f /opt/briar/rustup/settings.toml ]]; then
  cp /opt/briar/rustup/settings.toml "$RUSTUP_HOME/settings.toml"
fi

bundle_heads="$(git --no-replace-objects bundle list-heads \
  "$BRIAR_CI_REPOSITORY_BUNDLE")"
[[ "$bundle_heads" =~ ^${BRIAR_CI_HEAD_SHA}[[:space:]](refs/briar/merge-group-validation/[a-z0-9._-]+)$ ]] || {
  echo "The repository bundle does not advertise exactly the claimed ref." >&2
  exit 75
}
bundle_ref="${BASH_REMATCH[1]}"

git --no-replace-objects -C "$BRIAR_CI_WORKSPACE_ROOT" init --quiet
git --no-replace-objects -C "$BRIAR_CI_WORKSPACE_ROOT" fetch --no-tags \
  "$BRIAR_CI_REPOSITORY_BUNDLE" "$bundle_ref" >/dev/null
git --no-replace-objects -C "$BRIAR_CI_WORKSPACE_ROOT" reset --hard \
  "$BRIAR_CI_HEAD_SHA" >/dev/null
[[ "$(git --no-replace-objects -C "$BRIAR_CI_WORKSPACE_ROOT" rev-parse HEAD)" == \
  "$BRIAR_CI_HEAD_SHA" ]] || {
  echo "The isolated workspace did not resolve to the exact claimed SHA." >&2
  exit 75
}

cd "$BRIAR_CI_WORKSPACE_ROOT"
bun install
if [[ "$context" == "rust" ]]; then
  rustup run 1.96.0 rustc --version | grep -Eq '^rustc 1\.96\.0 '
  rustup component list --toolchain 1.96.0 --installed |
    grep -Eq '^rustfmt-'
  rustup component list --toolchain 1.96.0 --installed |
    grep -Eq '^clippy-'
fi
trap - ERR

prepare_rust_inputs() {
  bun run runtime:prepare
  bun run cli:build
  bun run agent:build
}

run_phase() {
  case "$context:$phase" in
    app-worker:app-check) bun run check ;;
    app-worker:app-d1-prepare) bun run test:d1:prepare ;;
    app-worker:app-test) bun run test ;;
    app-worker:app-shell)
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
      ;;
    app-worker:app-ios-verify) bun run ios:release:verify ;;
    app-worker:app-build) bun run build ;;
    app-worker:app-release-build) bun run build:release ;;
    app-worker:app-worker-check) bun run worker:check ;;
    app-worker:app-worker-build) bun run worker:build ;;
    app-worker:app-worker-startup) bun run worker:startup ;;
    d1-migrations:d1-apply)
      d1_state_dir="$(mktemp -d /tmp/briar-merge-group-d1.XXXXXX)"
      bun run d1:migrate:local -- --persist-to "$d1_state_dir"
      ;;
    d1-migrations:d1-test) bun run test:d1:migrations ;;
    rust:rust-fmt)
      prepare_rust_inputs
      rustup run 1.96.0 cargo fmt \
        --manifest-path apps/briar/src-tauri/Cargo.toml --all --check
      ;;
    rust:rust-clippy)
      prepare_rust_inputs
      rustup run 1.96.0 cargo clippy \
        --manifest-path apps/briar/src-tauri/Cargo.toml --all-targets -- -D warnings
      ;;
    rust:rust-test)
      prepare_rust_inputs
      rustup run 1.96.0 cargo test --manifest-path apps/briar/src-tauri/Cargo.toml
      ;;
    security:security-bun-audit) bun run audit:dependencies ;;
    security:security-rust-audit) bun run audit:rust ;;
    security:security-encrypted-env) bun run secrets:verify-encrypted ;;
    security:security-gitleaks)
      gitleaks git \
        --config .gitleaks.toml \
        --redact \
        --no-banner \
        --log-opts="--all" \
        .
      ;;
  esac
}

# Candidate/tool failures are deterministic CI failures. Exit 75 remains
# reserved for trusted setup above so a candidate cannot force retry forever.
set +e
(
  set -Eeuo pipefail
  run_phase
)
phase_exit="$?"
set -e
if (( phase_exit != 0 )); then
  exit 1
fi
