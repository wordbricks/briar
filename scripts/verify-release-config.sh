#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
release_env="$workspace_root/config/release.env"
frontend_root="$workspace_root/dist"

set -a
# shellcheck disable=SC1090 -- path is resolved from this repository.
source "$release_env"
set +a

if [[ "${VITE_BRIAR_API_URL:-}" != https://* ]]; then
  echo "Release configuration must use an HTTPS Briar API URL." >&2
  exit 1
fi
if [[ "${VITE_BRIAR_DEMO:-}" != "false" ]]; then
  echo "Release configuration enables demo mode." >&2
  exit 1
fi
if [[ ! -d "$frontend_root" ]]; then
  echo "Missing built frontend at $frontend_root." >&2
  exit 1
fi
if ! grep -R -F -q --include='*.js' "$VITE_BRIAR_API_URL" "$frontend_root"; then
  echo "Built frontend does not contain the configured Briar API URL." >&2
  exit 1
fi

echo "Verified release frontend API: $VITE_BRIAR_API_URL (demo=false)"
