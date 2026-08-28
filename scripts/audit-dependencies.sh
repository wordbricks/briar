#!/bin/bash
set -euo pipefail

# Temporary exceptions documented in docs/operations/security-exceptions.md.
# Keep each GHSA visible here so dependency updates can remove it deliberately.
bun audit --audit-level high \
  --ignore GHSA-w3rx-r6r6-pgpr \
  --ignore GHSA-5p2g-fcmc-qvqq
