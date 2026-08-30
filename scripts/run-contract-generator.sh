#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 2 ]]; then
  echo "usage: $0 <mise-tool@version> <relative-executable> [args...]" >&2
  exit 64
fi

tool_spec="$1"
relative_executable="$2"
shift 2

tool_root="$(mise where "$tool_spec")"
exec "$tool_root/$relative_executable" "$@"
