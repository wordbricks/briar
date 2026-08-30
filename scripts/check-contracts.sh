#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
generated_root="$(mktemp -d)"
trap 'rm -rf "$generated_root"' EXIT

cd "$repo_root"
buf lint packages/contracts/proto
buf build packages/contracts/proto \
  -o "$generated_root/briar.contracts.image.binpb"

if ! cmp -s \
  "$generated_root/briar.contracts.image.binpb" \
  packages/contracts/briar.contracts.image.binpb; then
  echo "Compiled Briar contract image is stale" >&2
  echo "Run: mise exec -- bun run contracts:generate" >&2
  exit 1
fi

bun run scripts/generate-contract-fingerprint.ts \
  --check \
  --image "$generated_root/briar.contracts.image.binpb"

buf generate \
  "$generated_root/briar.contracts.image.binpb" \
  --template packages/contracts/buf.gen.yaml \
  --output "$generated_root/output"

generated_paths=(
  "packages/contracts/src/gen"
  "packages/contracts/rust/src/gen/proto"
  "packages/contracts/rust/src/gen/connect"
  "apps/briar/ios/BriarCompanion/App/Generated/Connect"
)

for generated_path in "${generated_paths[@]}"; do
  if ! diff -ru "$generated_root/output/$generated_path" "$generated_path"; then
    echo "Generated Briar contract is stale: $generated_path" >&2
    echo "Run: mise exec -- bun run contracts:generate" >&2
    exit 1
  fi
done

cargo check \
  --manifest-path packages/contracts/rust/Cargo.toml \
  --all-features \
  --locked
