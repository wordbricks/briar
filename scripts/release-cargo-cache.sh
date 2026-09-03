#!/bin/bash

# Resolves the shared Cargo target directory for a build channel ("release",
# "ci", ...) and prints its physical path. Arguments:
#   $1 channel name used in the default path
#   $2 caller-supplied override (usually an environment variable's value)
#   $3 name of that environment variable, used in the error message
# The directory is created if missing; it does not take any lock.
resolve_briar_cargo_target_dir() {
  local channel="$1"
  local override="${2:-}"
  local override_name="${3:-BRIAR_CARGO_TARGET_DIR}"
  local cache_base
  local target_dir
  cache_base="$(getconf DARWIN_USER_CACHE_DIR 2>/dev/null || true)"
  if [[ -z "$cache_base" ]]; then
    cache_base="${TMPDIR:-/tmp}"
  fi
  target_dir="${override:-${cache_base%/}/briar/${channel}/cargo-target}"
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
    release \
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
