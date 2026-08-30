#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contract_image="$repo_root/packages/contracts/briar.contracts.image.binpb"

cd "$repo_root"
buf lint packages/contracts/proto
buf build packages/contracts/proto -o "$contract_image"
buf generate \
  "$contract_image" \
  --template packages/contracts/buf.gen.yaml
