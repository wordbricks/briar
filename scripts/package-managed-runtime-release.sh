#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
artifact_root="${1:-$workspace_root/release-artifacts}"
version="$(bun -e "console.log((await Bun.file('package.json').json()).version)" --cwd "$workspace_root")"
tauri_version="$(bun -e "console.log((await Bun.file('apps/briar/src-tauri/tauri.conf.json').json()).version)" --cwd "$workspace_root")"
source_commit="$(git -C "$workspace_root" rev-parse HEAD)"
archive_name="briar-managed-runtime-${version}-linux-x86_64.tar.gz"
archive="$artifact_root/$archive_name"
temporary_root="$(mktemp -d /tmp/briar-managed-runtime-release.XXXXXX)"

cleanup() {
  case "$temporary_root" in
    /tmp/briar-managed-runtime-release.*) rm -rf -- "$temporary_root" ;;
    *) echo "Refusing to clean unexpected runtime release path: $temporary_root" >&2 ;;
  esac
}
trap cleanup EXIT

[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || {
  echo "Managed runtime version must be stable SemVer." >&2
  exit 1
}
[[ "$tauri_version" == "$version" ]] || {
  echo "Managed runtime and Tauri versions must match." >&2
  exit 1
}
[[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Managed runtime source commit is invalid." >&2
  exit 1
}
for required in \
  "$workspace_root/apps/briar/dist-cli/briar.js" \
  "$workspace_root/apps/briar/dist-cli/briar-remote-session-agent.js" \
  "$workspace_root/apps/briar/dist-cli/briar-box-exec.js" \
  "$workspace_root/infrastructure/managed-computers/briar-computer-executor.py" \
  "$workspace_root/infrastructure/managed-computers/briar" \
  "$workspace_root/skills/briar-workflow/SKILL.md" \
  "$workspace_root/skills/browser/SKILL.md"; do
  [[ -s "$required" ]] || {
    echo "Managed runtime input is missing: $required" >&2
    exit 1
  }
done
for skill_name in briar-workflow browser; do
  skill_version="$(tr -d '\r\n' < "$workspace_root/skills/$skill_name/VERSION")"
  [[ "$skill_version" == "$version" ]] || {
    echo "Managed runtime Skill version differs from $version: $skill_name" >&2
    exit 1
  }
done
shopt -s nullglob
runner_sources=("$workspace_root"/apps/briar/dist-agent/*-runner.js)
shopt -u nullglob
if (( ${#runner_sources[@]} != 6 )); then
  echo "Managed runtime requires exactly six provider runners." >&2
  exit 1
fi
computer_use_mcp_source="$workspace_root/apps/briar/dist-agent/computer-use-mcp-server.js"
[[ -s "$computer_use_mcp_source" ]] || {
  echo "Managed runtime requires the Computer Use MCP adapter." >&2
  exit 1
}

stage="$temporary_root/stage"
install -d -m 0755 \
  "$artifact_root" "$stage/bin" "$stage/lib/agent" "$stage/libexec" "$stage/skills"
install -m 0755 \
  "$workspace_root/infrastructure/managed-computers/briar" \
  "$stage/bin/briar"
install -m 0644 \
  "$workspace_root/apps/briar/dist-cli/briar-remote-session-agent.js" \
  "$stage/bin/briar-remote-session-agent.js"
install -m 0644 \
  "$workspace_root/apps/briar/dist-cli/briar-box-exec.js" \
  "$stage/bin/briar-box-exec.js"
install -m 0755 \
  "$workspace_root/infrastructure/managed-computers/briar-computer-executor.py" \
  "$stage/libexec/briar-computer-executor.py"
install -m 0644 \
  "$workspace_root/apps/briar/dist-cli/briar.js" \
  "$stage/lib/briar.js"
for runner in "${runner_sources[@]}"; do
  [[ -s "$runner" ]]
  install -m 0644 "$runner" "$stage/lib/agent/$(basename -- "$runner")"
done
install -m 0644 "$computer_use_mcp_source" \
  "$stage/lib/agent/computer-use-mcp-server.js"
cp -R "$workspace_root/skills/briar-workflow" "$stage/skills/"
cp -R "$workspace_root/skills/browser" "$stage/skills/"
chmod 0755 "$stage/skills/briar-workflow/scripts/briar"
printf '%s\n' "$version" > "$stage/briar-version"
printf '%s\n' "$source_commit" > "$stage/source-commit"
jq -n \
  --arg version "$version" \
  --arg sourceCommit "$source_commit" \
  '{schemaVersion: 1, version: $version, sourceCommit: $sourceCommit, platform: "linux-x86_64"}' \
  > "$stage/manifest.json"

COPYFILE_DISABLE=1 tar -czf "$archive" -C "$stage" .
bun --cwd "$workspace_root/apps/briar" tauri signer sign "$archive"
[[ -s "$archive.sig" ]]
echo "$archive"
