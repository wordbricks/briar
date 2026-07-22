#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
release_env="$workspace_root/config/release.env"

if [[ ! -f "$release_env" ]]; then
  echo "Missing public release configuration at $release_env." >&2
  exit 1
fi
if (( $# == 0 )); then
  echo "Usage: scripts/with-release-env.sh <command> [args...]" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090 -- path is resolved from this repository.
source "$release_env"
set +a

if [[ "${VITE_BRIAR_API_URL:-}" != https://* ]]; then
  echo "VITE_BRIAR_API_URL must be an HTTPS endpoint for release builds." >&2
  exit 1
fi
if [[ "${VITE_BRIAR_DEMO:-}" != "false" ]]; then
  echo "VITE_BRIAR_DEMO must be false for release builds." >&2
  exit 1
fi

exec "$@"
