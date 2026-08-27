#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
docker_bin="${DOCKER_BIN:-docker}"
command -v "$docker_bin" >/dev/null
docker_config="$(mktemp -d /tmp/briar-runtime-updater-docker.XXXXXX)"
cleanup() {
  case "$docker_config" in
    /tmp/briar-runtime-updater-docker.*) rm -rf -- "$docker_config" ;;
    *) echo "Refusing to clean unexpected Docker config path: $docker_config" >&2 ;;
  esac
}
trap cleanup EXIT

DOCKER_CONFIG="$docker_config" "$docker_bin" run --rm --interactive \
  --volume "$workspace_root:/workspace:ro" \
  debian:13-slim bash -s <<'CONTAINER'
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends jq >/dev/null

fixture=/tmp/briar-runtime-updater-qa
runtime_root="$fixture/opt/briar"
request_directory="$fixture/run"
state_directory="$fixture/state"
artifact_directory="$fixture/artifacts"
fake_bin="$fixture/bin"
mkdir -p \
  "$runtime_root/releases/1.0.0" "$request_directory" "$state_directory" \
  "$artifact_directory" "$fake_bin"
printf '1.0.0\n' > "$runtime_root/releases/1.0.0/briar-version"
ln -s "$runtime_root/releases/1.0.0" "$runtime_root/current"
printf 'public key fixture\n' > "$fixture/runtime-updater.pub"
jq -n \
  --arg apiOrigin https://briar-api.example \
  --arg credential "briar_worker_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" \
  '{apiOrigin: $apiOrigin, credential: $credential}' \
  > "$fixture/credential.json"

cat > "$fake_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
output=""
previous=""
for argument in "$@"; do
  if [[ "$previous" == "--output" ]]; then
    output="$argument"
  fi
  previous="$argument"
done
url="${!#}"
case "$url" in
  */update-handoff/status*)
    if [[ -e "$ACTIVATED_FILE" && "${FAIL_HEALTH:-}" != "1" ]]; then
      jq -n \
        --arg requestId "$REQUEST_ID" \
        --arg targetVersion "$TARGET_VERSION" \
        '{requestId: $requestId, targetVersion: $targetVersion, status: "completed", handoffState: "ready", activeWorkCount: 0, ready: true}' \
        > "$output"
    else
      jq -n \
        --arg requestId "$REQUEST_ID" \
        --arg targetVersion "$TARGET_VERSION" \
        '{requestId: $requestId, targetVersion: $targetVersion, status: "requested", handoffState: "ready", activeWorkCount: 0, ready: true}' \
        > "$output"
    fi
    ;;
  */update-handoff/fail)
    : > "$output"
    ;;
  *.tar.gz.sig)
    cp "$ARTIFACT_DIRECTORY/runtime.tar.gz.sig" "$output"
    ;;
  *.tar.gz)
    cp "$ARTIFACT_DIRECTORY/runtime.tar.gz" "$output"
    ;;
  *)
    echo "unexpected curl URL: $url" >&2
    exit 1
    ;;
esac
EOF

cat > "$fake_bin/minisign" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
exit 0
EOF

cat > "$fake_bin/systemctl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$SYSTEMCTL_LOG"
touch "$ACTIVATED_FILE"
EOF
chmod 0755 "$fake_bin/curl" "$fake_bin/minisign" "$fake_bin/systemctl"

make_release() {
  local version="$1"
  local stage="$fixture/stage-$version"
  rm -rf -- "$stage"
  mkdir -p \
    "$stage/bin" "$stage/lib/agent" \
    "$stage/skills/briar-workflow/scripts" "$stage/skills/browser"
  printf '#!/usr/bin/env bash\necho "briar %s"\n' "$version" > "$stage/bin/briar"
  chmod 0755 "$stage/bin/briar"
  printf 'remote agent\n' > "$stage/bin/briar-remote-session-agent.js"
  printf 'cli\n' > "$stage/lib/briar.js"
  printf 'runner\n' > "$stage/lib/agent/codex-runner.js"
  printf 'workflow\n' > "$stage/skills/briar-workflow/SKILL.md"
  printf '%s\n' "$version" > "$stage/skills/briar-workflow/VERSION"
  printf '#!/usr/bin/env bash\nexit 0\n' > "$stage/skills/briar-workflow/scripts/briar"
  printf 'browser\n' > "$stage/skills/browser/SKILL.md"
  printf '%s\n' "$version" > "$stage/skills/browser/VERSION"
  printf '%s\n' "$version" > "$stage/briar-version"
  printf '%s\n' aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    > "$stage/source-commit"
  jq -n \
    --arg version "$version" \
    --arg sourceCommit aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
    '{schemaVersion: 1, version: $version, sourceCommit: $sourceCommit, platform: "linux-x86_64"}' \
    > "$stage/manifest.json"
  tar -czf "$artifact_directory/runtime.tar.gz" -C "$stage" .
  printf 'signature\n' > "$artifact_directory/runtime.tar.gz.sig"
}

run_update() {
  local request="$1"
  local version="$2"
  local fail_health="$3"
  export REQUEST_ID="$request"
  export TARGET_VERSION="$version"
  export FAIL_HEALTH="$fail_health"
  export ARTIFACT_DIRECTORY="$artifact_directory"
  export ACTIVATED_FILE="$fixture/activated"
  export SYSTEMCTL_LOG="$fixture/systemctl.log"
  rm -f -- "$ACTIVATED_FILE"
  jq -n \
    --arg requestId "$request" \
    --arg targetVersion "$version" \
    --arg workerId worker-1 \
    '{requestId: $requestId, targetVersion: $targetVersion, workerId: $workerId}' \
    > "$request_directory/request-$request.json"
  BRIAR_RUNTIME_ROOT="$runtime_root" \
  BRIAR_RUNTIME_UPDATE_REQUEST_DIR="$request_directory" \
  BRIAR_RUNTIME_UPDATE_STATE_DIR="$state_directory" \
  BRIAR_RUNTIME_CREDENTIAL_FILE="$fixture/credential.json" \
  BRIAR_RUNTIME_UPDATE_PUBLIC_KEY="$fixture/runtime-updater.pub" \
  BRIAR_RUNTIME_CURL="$fake_bin/curl" \
  BRIAR_RUNTIME_MINISIGN="$fake_bin/minisign" \
  BRIAR_RUNTIME_SYSTEMCTL="$fake_bin/systemctl" \
  BRIAR_RUNTIME_UPDATE_POLL_SECONDS=1 \
  BRIAR_RUNTIME_UPDATE_HANDOFF_TIMEOUT_SECONDS=3 \
  BRIAR_RUNTIME_UPDATE_HEALTH_TIMEOUT_SECONDS=2 \
    /workspace/infrastructure/managed-computers/briar-managed-runtime-updater --once
}

make_release 2.0.0
run_update 77777777-7777-4777-8777-777777777777 2.0.0 0
test "$(readlink -f "$runtime_root/current")" = "$runtime_root/releases/2.0.0"
jq -e '.outcome == "completed" and .targetVersion == "2.0.0"' \
  "$state_directory/last-result.json" >/dev/null

make_release 2.0.1
run_update 88888888-8888-4888-8888-888888888888 2.0.1 1
test "$(readlink -f "$runtime_root/current")" = "$runtime_root/releases/2.0.0"
jq -e '.outcome == "failed" and .targetVersion == "2.0.1"' \
  "$state_directory/last-result.json" >/dev/null

make_release 1.9.0
run_update 99999999-9999-4999-8999-999999999999 1.9.0 0
test "$(readlink -f "$runtime_root/current")" = "$runtime_root/releases/2.0.0"
jq -e \
  '.outcome == "failed" and .targetVersion == "1.9.0" and
   (.detail | contains("Refusing to downgrade"))' \
  "$state_directory/last-result.json" >/dev/null

for skill_root in \
  /home/briar/.cursor/skills \
  /home/briar/.grok/skills \
  /home/briar/.gemini/config/skills; do
  mkdir -p "$skill_root"
  ln -s /opt/briar/current/skills/briar-workflow \
    "$skill_root/briar-workflow"
  ln -s /opt/briar/current/skills/browser "$skill_root/browser"
done
mkdir -p /var/lib/briar /home/admin
ln -s /bin/true /usr/local/bin/journalctl
touch /home/briar/.cursor/session.json
if /workspace/infrastructure/managed-computers/prepare-image-for-capture \
  >/dev/null 2>&1; then
  echo "image capture accepted unexpected provider runtime state" >&2
  exit 1
fi
rm -f /home/briar/.cursor/session.json
/workspace/infrastructure/managed-computers/prepare-image-for-capture >/dev/null

echo "managed runtime updater lifecycle QA passed"
CONTAINER
