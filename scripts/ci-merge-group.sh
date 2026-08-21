#!/bin/bash
set -euo pipefail

case "${1:-}" in
  app-worker|d1-migrations|rust|security) context="$1" ;;
  *) echo "A single fixed merge-group CI context is required." >&2; exit 75 ;;
esac

[[ "${BRIAR_TRUSTED_MERGE_GROUP_CI:-}" == "1" &&
  "${BRIAR_CI_WORKSPACE_ROOT:-}" == "/scratch/workspace" &&
  "${BRIAR_CI_REPOSITORY_BUNDLE:-}" == "/opt/briar/repository.bundle" &&
  "${BRIAR_CI_BUN_CONFIG:-}" == "/opt/briar/bunfig.toml" &&
  "${BRIAR_CI_HEAD_SHA:-}" =~ ^[0-9a-f]{40}$ &&
  -r /opt/briar/repository.bundle &&
  -r /opt/briar/ci-local.sh &&
  -r /opt/briar/bunfig.toml ]] || {
  echo "The isolated merge-group input contract is incomplete." >&2
  exit 75
}

export CARGO_NET_OFFLINE=true
export BUN_INSTALL_CACHE_DIR=/opt/briar/bun-cache
export HOME=/scratch/home
export TMPDIR=/tmp
export CARGO_HOME=/scratch/cargo
export RUSTUP_HOME=/scratch/rustup

mkdir -p \
  "$HOME" "/scratch/bin" "$BRIAR_CI_WORKSPACE_ROOT" \
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

bundle_heads="$(git bundle list-heads "$BRIAR_CI_REPOSITORY_BUNDLE")"
[[ "$bundle_heads" =~ ^${BRIAR_CI_HEAD_SHA}[[:space:]](refs/briar/merge-group-validation/[a-z0-9._-]+)$ ]] || {
  echo "The repository bundle does not advertise exactly the claimed ref." >&2
  exit 75
}
bundle_ref="${BASH_REMATCH[1]}"

git -C "$BRIAR_CI_WORKSPACE_ROOT" init --quiet
git -C "$BRIAR_CI_WORKSPACE_ROOT" fetch --no-tags \
  "$BRIAR_CI_REPOSITORY_BUNDLE" "$bundle_ref" >/dev/null
git -C "$BRIAR_CI_WORKSPACE_ROOT" reset --hard \
  "$BRIAR_CI_HEAD_SHA" >/dev/null
[[ "$(git -C "$BRIAR_CI_WORKSPACE_ROOT" rev-parse HEAD)" == "$BRIAR_CI_HEAD_SHA" ]] || {
  echo "The isolated workspace did not resolve to the exact claimed SHA." >&2
  exit 75
}

# The candidate copy is never trusted, even though the parent rejects changes
# to scripts/. Install the signed-base profile over it before execution.
install -m 0555 /opt/briar/ci-local.sh \
  "$BRIAR_CI_WORKSPACE_ROOT/scripts/ci-local.sh"

cat > /scratch/bin/bun <<'EOF'
#!/bin/bash
set -euo pipefail
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
EOF
chmod 0555 /scratch/bin/bun

export PATH="/scratch/bin:/opt/briar/cargo/bin:/usr/local/bin:/usr/bin:/bin"
cd "$BRIAR_CI_WORKSPACE_ROOT"
exec /bin/bash scripts/ci-local.sh "$context"
