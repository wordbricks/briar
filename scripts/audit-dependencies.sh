#!/bin/bash
set -euo pipefail

# Temporary exception documented in docs/operations/security-exceptions.md.
# Keep this GHSA visible here so dependency updates can remove it deliberately.
bun audit --audit-level high --ignore GHSA-f88m-g3jw-g9cj
