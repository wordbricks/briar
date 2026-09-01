# Organization Agent context retrieval

Organization Agent replies use claim-scoped, on-demand context retrieval. A
Worker must not download every retained project record before starting a reply.

## Turn flow

1. The Worker calls the generated
   `OrganizationAgentContextService.GetManifest` client. The manifest contains
   project identity, resource counts, and resource revisions only.
2. The read-only Agent inspects the local manifest. It either returns a normal
   channel reply or a strict `contextRequests` object.
3. The Worker calls `OrganizationAgentContextService.Lookup` with its Worker
   credential and an `OrganizationAgentContextClaim` containing the active
   channel reply capability.
4. Briar revalidates the organization, claim, Worker, and every project ID,
   writes the bounded results into the private invocation directory, and
   continues the same provider conversation.
5. The private directory is removed before the durable channel reply is marked
   complete.

The Agent never receives a Briar credential or direct network access. It can
request at most 12 lookups per round and three rounds per reply. Full Agent,
issue, Skill, and session records require exact IDs obtained from the manifest
or a summary page. Lookup responses share the existing 1.5 MB encoded context
budget.

## Summary and detail boundaries

- Project settings are loaded for one selected project.
- Agent summaries include responsibility and Skill identity, but exclude Skill
  instructions. Full Skill instructions require a Skill-ID lookup.
- Issue summaries exclude descriptions, structured results, QA details, and
  other large fields. Full issues require exact issue IDs.
- Session summaries read hot-session summaries and archived-session metadata.
  They do not read R2 archive payloads. An archived payload is read only when
  its exact session ID is requested.
- Pull requests are batched by selected issue IDs.

## Revisions and caching

The manifest revision hashes project identities plus per-resource counts and
latest update timestamps. Workers retain a small in-memory manifest cache and
send its revision as `known_revision`. `GetManifest` returns a protobuf `oneof`:
either the new manifest or an `unchanged` result that lets the Worker rebuild
the new claim-scoped local manifest from the immutable cached index. Detailed
lookup files are deduplicated within an invocation.

There is no REST/ETag negotiation or legacy paginated context protocol. Method,
scope, request, response, and unchanged-result semantics all come from the
generated Worker contract.

## Operational checks

- A question answerable from the channel and manifest should make no lookup
  request.
- A single-project question must not load another project's detail.
- Listing archived sessions must not read R2 objects.
- Repeating an identical lookup in one invocation must not make another RPC.
- An expired claim, mismatched Worker, or cross-organization project ID must be
  rejected before any detail is returned.
