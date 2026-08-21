#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
runtime="${OCI_RUNTIME:-docker}"
platform="${OCI_PLATFORM:-linux/arm64}"
tag="${OCI_TAG:-briar-merge-group-ci:review}"
iid_file="$(mktemp "${TMPDIR:-/tmp}/briar-merge-group-image.XXXXXX")"
trap 'rm -f "$iid_file"' EXIT

[[ "$runtime" == "docker" ]] || {
  echo "OCI_RUNTIME must be docker" >&2
  exit 2
}

"$runtime" build \
  --iidfile "$iid_file" \
  --platform "$platform" \
  --file "$workspace_root/containers/merge-group-ci/Dockerfile" \
  --tag "$tag" \
  --build-arg SOURCE_DATE_EPOCH=1787270400 \
  "$workspace_root"

image_id="$(cat "$iid_file")"
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "OCI build did not return an immutable image ID" >&2
  exit 1
}

inspection="$("$runtime" image inspect \
  --format '{{.Id}} {{.Config.User}} {{index .Config.Labels "io.briar.merge-group-ci.protocol"}}' \
  "$tag")"
[[ "$inspection" == "$image_id 65532:65532 1" ]] || {
  echo "OCI image identity, non-root user, or protocol label mismatch: $inspection" >&2
  exit 1
}

echo "Review image built locally as $tag ($image_id)."
echo "The rollout manifest intentionally remains unpublished and disabled."
