-- Keep 0121 immutable for databases that may already have applied it, then
-- remove the retired coordinator tables in a forward-only migration.
drop table if exists briar_merge_batch_candidates;
drop table if exists briar_merge_batches;
drop table if exists briar_repository_merge_policies;
