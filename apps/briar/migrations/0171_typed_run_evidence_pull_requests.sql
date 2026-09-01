-- Bind each PR evidence row to its immutable provider identity explicitly.
-- This replaces the transport-shaped metadata_json lookup with a relational
-- association whose foreign key also makes evidence + PR persistence atomic.
create unique index briar_run_pull_requests_full_identity_idx
  on briar_run_pull_requests (
    run_id, attempt, revision, repository_id, pull_request_number,
    pull_request_id, pull_request_node_id
  );

create table briar_run_evidence_pull_requests (
  evidence_id text primary key not null
    references briar_run_evidence (id) on delete cascade,
  run_id text not null,
  attempt integer not null check (attempt >= 1),
  revision integer not null check (revision >= 1),
  repository_id integer not null check (repository_id > 0),
  pull_request_number integer not null check (pull_request_number > 0),
  pull_request_id integer not null check (pull_request_id > 0),
  pull_request_node_id text not null check (
    length(trim(pull_request_node_id)) between 1 and 200
  ),
  foreign key (
    run_id, attempt, revision, repository_id, pull_request_number,
    pull_request_id, pull_request_node_id
  ) references briar_run_pull_requests (
    run_id, attempt, revision, repository_id, pull_request_number,
    pull_request_id, pull_request_node_id
  ) on delete cascade
);

create index briar_run_evidence_pull_requests_link_idx
  on briar_run_evidence_pull_requests (
    run_id, attempt, revision, repository_id, pull_request_number,
    pull_request_id, pull_request_node_id
  );

-- Preserve associations written before the typed protobuf field existed.
-- Rows without a matching immutable link deliberately remain unbound.
insert into briar_run_evidence_pull_requests (
  evidence_id, run_id, attempt, revision,
  repository_id, pull_request_number,
  pull_request_id, pull_request_node_id
)
select evidence.id, evidence.run_id, evidence.attempt, evidence.revision,
       link.repository_id, link.pull_request_number,
       link.pull_request_id, link.pull_request_node_id
from briar_run_evidence evidence
join briar_run_pull_requests link
  on link.run_id = evidence.run_id
 and link.attempt = evidence.attempt
 and link.revision = evidence.revision
 and link.repository_id = cast(json_extract(
   evidence.metadata_json,
   '$.githubPullRequest.repositoryId'
 ) as integer)
 and link.pull_request_id = cast(json_extract(
   evidence.metadata_json,
   '$.githubPullRequest.pullRequestId'
 ) as integer)
 and link.pull_request_node_id = json_extract(
   evidence.metadata_json,
   '$.githubPullRequest.pullRequestNodeId'
 )
 and link.pull_request_number = cast(json_extract(
   evidence.metadata_json,
   '$.githubPullRequest.pullRequestNumber'
 ) as integer)
where evidence.evidence_type = 'pull_request'
  and evidence.status in ('pending', 'passed');

-- Immutable PR identity now has a typed protobuf field and relational table.
-- Remove the old parallel JSON representation while preserving user metadata.
update briar_run_evidence
set metadata_json = case
  when json_remove(metadata_json, '$.githubPullRequest') = '{}' then null
  else json_remove(metadata_json, '$.githubPullRequest')
end
where metadata_json is not null
  and json_type(metadata_json, '$.githubPullRequest') is not null;
