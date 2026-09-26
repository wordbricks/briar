-- BR-5800: the PK autoindex already covers (session_id, first_sequence,
-- last_sequence) in this order. Keep the PK and remove the redundant index.
-- This is a schema-only change; it rewrites no transcript rows.
drop index if exists briar_agent_transcript_segments_session_sequence_idx;
