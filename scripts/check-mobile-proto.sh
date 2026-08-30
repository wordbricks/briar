#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
generated_root="$(mktemp -d)"
trap 'rm -rf "$generated_root"' EXIT

cd "$repo_root"
buf lint packages/mobile-contracts/proto
buf generate \
  --template packages/mobile-contracts/buf.gen.yaml \
  --output "$generated_root"

generated_paths=(
  "packages/mobile-contracts/src/gen"
  "apps/briar/ios/BriarCompanion/App/Generated/Connect"
)

for generated_path in "${generated_paths[@]}"; do
  if ! diff -ru "$generated_root/$generated_path" "$generated_path"; then
    echo "Generated mobile contract is stale: $generated_path" >&2
    echo "Run: mise exec -- bun run mobile:proto:generate" >&2
    exit 1
  fi
done
