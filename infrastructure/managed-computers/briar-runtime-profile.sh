#!/bin/sh

# Briar-managed runtime tools are immutable image inputs. Keep this directory
# first so interactive terminals and Agent child shells use the pinned tools.
export CARGO_HOME=/opt/briar/cargo
export RUSTUP_HOME=/opt/briar/rustup
export BUN_INSTALL_CACHE_DIR="${HOME}/.cache/bun"

case ":${PATH:-}:" in
  *:/opt/briar/bin:*) ;;
  *) PATH="/opt/briar/bin${PATH:+:${PATH}}" ;;
esac
export PATH
