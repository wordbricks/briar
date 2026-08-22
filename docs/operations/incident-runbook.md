# Production incident runbook

## Targets and ownership

- Desktop availability: signed install/update succeeds for 99.9% of attempts.
- API availability: 99.9% successful non-user-error requests over 30 days.
- API error budget alert: investigate when 5xx exceeds 1% for 5 minutes.
- Recovery time objective: 60 minutes for API or update-channel incidents.
- Recovery point objective: 15 minutes for D1 using Time Travel bookmarks;
  release metadata and binaries are immutable and have an RPO of zero.

The release approver owns desktop promotion. The Worker operator owns API/R2
recovery. One person may fill both roles during the initial launch, but must
record every decision in the incident timeline.

## Detect and triage

1. Check `/health`, Cloudflare Workers Logs, traces, request/error metrics, and
   the latest GitHub deployment. Observability is enabled in
   `apps/briar/wrangler.jsonc`.
2. Compare `latest.json` with the signed GitHub Release, `SHA256SUMS`, SBOM, and
   provenance subjects. Treat any digest/signature mismatch as severity 1.
3. Use `bun --cwd apps/briar wrangler tail --status error` for a bounded live
   sample. Never log auth,
   agent, claim, Apple, Cloudflare, or updater private tokens.
4. Confirm whether the fault is desktop-only, update distribution, Worker, D1,
   or an external identity provider before changing state.

## Contain and recover

- Bad update metadata: restore the last known-good `latest.json`. Tauri's
  normal comparator does not downgrade, so issue a higher patch version for an
  automatic binary rollback. Keep the retained DMG for manual rollback.
- Bad versioned object: do not overwrite it. Remove promotion from
  `latest.json`, build a new patch version, and preserve evidence.
- Worker regression: use `bun --cwd apps/briar wrangler rollback` to the
  verified deployment, then
  confirm `/health`, auth, project dashboard, and update endpoints.
- Channel issue approval regression: migration 0090 is a paired, forward-only
  Worker/D1 rollout. Do not roll back the Worker independently; follow
  [`channel-issue-approval-rollout.md`](channel-issue-approval-rollout.md).
- D1 regression: prefer a forward migration. If unsafe, restore a pre-migration
  Time Travel bookmark only after recording the affected window and impact.
- Key compromise: stop releases, remove environment access, rotate Apple and
  Cloudflare credentials, and follow the offline updater-key recovery plan.
  The updater public key itself can only be rotated through an update signed by
  the previously trusted key.

## Close

Verify login session, Briar project selection through the native select control, Auto
Hunt status ingestion, a fresh update check, checksums, notarization, and both
main workflows. Record the incident cause, affected versions/users, recovery
commands, final SHA, and follow-up issue in Briar.

Cloudflare references: [Workers observability](https://developers.cloudflare.com/workers/observability/),
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/),
and [traces](https://developers.cloudflare.com/workers/observability/traces/).
