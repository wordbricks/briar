#!/bin/bash
set -euo pipefail

workspace_root="$(cd "$(dirname "$0")/../.." && pwd -P)"
runtime="${OCI_RUNTIME:-docker}"
platform="${OCI_PLATFORM:-linux/arm64}"
tag="${OCI_TAG:-briar-merge-group-ci:review}"

case "$runtime" in
  docker|container) ;;
  *) echo "OCI_RUNTIME must be docker or container" >&2; exit 2 ;;
esac

"$runtime" build \
  --platform "$platform" \
  --file "$workspace_root/containers/merge-group-ci/Dockerfile" \
  --tag "$tag" \
  --build-arg SOURCE_DATE_EPOCH=1787270400 \
  "$workspace_root"

"$runtime" image inspect "$tag"
