#!/usr/bin/env bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/.." && pwd -P)"
fixture="$(mktemp -d "${TMPDIR:-/tmp}/briar-managed-computer-health.XXXXXX")"
cleanup() {
  case "$fixture" in
    "${TMPDIR:-/tmp}"/briar-managed-computer-health.*)
      rm -rf -- "$fixture"
      ;;
    *)
      echo "Refusing to clean unexpected health fixture: $fixture" >&2
      ;;
  esac
}
trap cleanup EXIT

fake_bin="$fixture/bin"
active_file="$fixture/active"
systemctl_log="$fixture/systemctl.log"
credential_file="$fixture/worker-credential.json"
mkdir -p "$fake_bin"
printf '%s\n' credential > "$credential_file"
: > "$systemctl_log"
printf '%s\n' briar-managed-enroll.service > "$active_file"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'case "${1:-}" in' \
  '  is-active)' \
  '    unit="${3:-}"' \
  '    grep -Fxq "$unit" "$ACTIVE_FILE"' \
  '    ;;' \
  '  start|restart)' \
  '    unit="${2:-}"' \
  '    printf "%s %s\\n" "$1" "$unit" >> "$SYSTEMCTL_LOG"' \
  '    if [[ "${FAIL_START_UNIT:-}" == "$unit" ]]; then exit 1; fi' \
  '    active_tmp="${ACTIVE_FILE}.tmp"' \
  '    grep -Fvx "$unit" "$ACTIVE_FILE" > "$active_tmp" || true' \
  '    printf "%s\\n" "$unit" >> "$active_tmp"' \
  '    mv "$active_tmp" "$ACTIVE_FILE"' \
  '    ;;' \
  '  *) exit 2 ;;' \
  'esac' > "$fake_bin/systemctl"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "LISTEN 0 5 %s 0.0.0.0:*\\n" "${TEST_LISTENER:-127.0.0.1:5901}"' \
  > "$fake_bin/ss"
printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'printf "%s\\n" "root:briar 640"' \
  > "$fake_bin/stat"
chmod 0755 "$fake_bin/systemctl" "$fake_bin/ss" "$fake_bin/stat"

health_environment=(
  BRIAR_HEALTH_TEST_MODE=1
  BRIAR_HEALTH_SYSTEMCTL="$fake_bin/systemctl"
  BRIAR_HEALTH_SS="$fake_bin/ss"
  BRIAR_HEALTH_STAT="$fake_bin/stat"
  BRIAR_MANAGED_CREDENTIAL_FILE="$credential_file"
  BRIAR_REMOTE_DISPLAY_PORT=5901
  BRIAR_HEALTH_RECHECK_DELAY_SECONDS=0
  ACTIVE_FILE="$active_file"
  SYSTEMCTL_LOG="$systemctl_log"
)
health_script="$workspace_root/infrastructure/managed-computers/briar-managed-computer-health"
env "${health_environment[@]}" "$health_script" >/dev/null
for expected in \
  "start briar-managed-runtime-updater.service" \
  "start briar-managed-worker.service" \
  "start briar-remote-desktop.service" \
  "start briar-remote-session-agent.service" \
  "start briar-managed-computer.target"; do
  grep -Fqx "$expected" "$systemctl_log"
done
if grep -Fq 'briar_worker_' "$systemctl_log"; then
  echo "health watchdog leaked credential material" >&2
  exit 1
fi

line_count_before="$(wc -l < "$systemctl_log")"
env "${health_environment[@]}" "$health_script" >/dev/null
test "$(wc -l < "$systemctl_log")" = "$line_count_before"

grep -Fvx briar-remote-session-agent.service "$active_file" > "$active_file.tmp"
mv "$active_file.tmp" "$active_file"
if env \
  "${health_environment[@]}" \
  FAIL_START_UNIT=briar-remote-session-agent.service \
  "$health_script" >/dev/null 2>&1; then
  echo "health watchdog accepted a failed recovery" >&2
  exit 1
fi

echo "managed computer health watchdog QA passed"
