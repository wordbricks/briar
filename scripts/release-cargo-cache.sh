#!/bin/bash

# Resolves the shared Cargo target directory and prints its physical path.
# Local CI and the release scripts share one directory: Cargo keeps the
# `debug` and `release` profiles apart, so CI runs and release builds warm each
# other's dependency artifacts. The default lives under the user's XDG cache
# (`~/.cache/briar/cargo-target`), deliberately not under
# `DARWIN_USER_CACHE_DIR`: macOS treats that directory as purgeable, and every
# eviction turned a ~20s incremental Rust check into a ~10 minute cold build.
# Arguments:
#   $1 caller-supplied override (usually an environment variable's value)
#   $2 name of that environment variable, used in the error message
# The directory is created if missing; it does not take any lock.
resolve_briar_cargo_target_dir() {
  local override="${1:-}"
  local override_name="${2:-BRIAR_CARGO_TARGET_DIR}"
  local cache_base="${XDG_CACHE_HOME:-$HOME/.cache}"
  local target_dir
  target_dir="${override:-${cache_base%/}/briar/cargo-target}"
  case "$target_dir" in
    /*/cargo-target) ;;
    *)
      echo "${override_name} must be an absolute path ending in /cargo-target." >&2
      return 1
      ;;
  esac
  mkdir -p "$target_dir"
  (cd "$target_dir" && pwd -P)
}

configure_release_cargo_cache() {
  local target_dir
  target_dir="$(resolve_briar_cargo_target_dir \
    "${BRIAR_RELEASE_CARGO_TARGET_DIR:-}" \
    BRIAR_RELEASE_CARGO_TARGET_DIR)" || return 1
  BRIAR_RELEASE_CARGO_LOCK="$target_dir/.briar-release-lock"
  if ! mkdir "$BRIAR_RELEASE_CARGO_LOCK" 2>/dev/null; then
    echo "Another Briar release is using the shared Cargo cache: $target_dir" >&2
    return 1
  fi
  export BRIAR_RELEASE_CARGO_LOCK
  export BRIAR_RELEASE_CARGO_TARGET_DIR="$target_dir"
  export CARGO_TARGET_DIR="$target_dir"
  echo "Using shared release Cargo cache at $target_dir"
}

reset_release_bundle_output() {
  local target_dir="${BRIAR_RELEASE_CARGO_TARGET_DIR:?Release Cargo cache is not configured}"
  case "$target_dir" in
    /*/cargo-target) rm -rf -- "$target_dir/release/bundle" ;;
    *)
      echo "Refusing to clean unexpected Cargo target: $target_dir" >&2
      return 1
      ;;
  esac
}

release_cargo_cache_cleanup() {
  if [[ -n "${BRIAR_RELEASE_CARGO_LOCK:-}" ]]; then
    rmdir "$BRIAR_RELEASE_CARGO_LOCK" >/dev/null 2>&1 || true
  fi
}
