#!/bin/sh

# Briar-managed runtime tools are immutable image inputs. The managed user gets
# writable Cargo and rustup state layered over the pinned toolchain so ordinary
# issue work can build Rust projects without mutating the image installation.
if [ "${HOME:-}" = "/home/briar" ]; then
  export CARGO_HOME=/home/briar/.cargo
  export RUSTUP_HOME=/home/briar/.rustup
  # gh waits for its browser launcher to exit before completing device auth.
  # Keep this gh-specific and preserve an explicit user override.
  export GH_BROWSER="${GH_BROWSER:-/opt/briar/bin/briar-open-browser}"
else
  export CARGO_HOME=/opt/briar/cargo
  export RUSTUP_HOME=/opt/briar/rustup
fi
export BUN_INSTALL_CACHE_DIR="${HOME}/.cache/bun"
export BRIAR_CI_SERIAL_CONTEXTS=true
export VITEST_MAX_WORKERS=2

case ":${PATH:-}:" in
  *:/opt/briar/bin:*) ;;
  *) PATH="/opt/briar/bin${PATH:+:${PATH}}" ;;
esac
case ":${PATH:-}:" in
  *:"${CARGO_HOME}/bin":*) ;;
  *) PATH="${PATH:+${PATH}:}${CARGO_HOME}/bin" ;;
esac
export PATH
