#!/bin/bash
set -euo pipefail

if [[ "${BRIAR_TRUSTED_MERGE_GROUP_CI:-}" == "1" ]]; then
  expected_lock="/opt/briar/audited-bun-lock.sha256"
  [[ -r "$expected_lock" ]] || {
    echo "The isolated executor lacks its audited Bun lock proof." >&2
    exit 75
  }
  sha256sum --check --status "$expected_lock" || {
    echo "Candidate bun.lock differs from the image-audited lock." >&2
    exit 1
  }
  echo "Verified bun.lock against the audit baked into the OCI image."
else
  # Temporary exception documented in docs/operations/security-exceptions.md.
  # Keep this GHSA visible here so dependency updates can remove it deliberately.
  bun audit --audit-level high --ignore GHSA-f88m-g3jw-g9cj
fi
