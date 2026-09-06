pragma foreign_keys = on;

-- One Agent can message another Agent directly. A round trip is three reply
-- jobs: the sender's turn in the person's thread (hop 0), the recipient
-- answering inside the Agent-to-Agent DM (hop 1) and the sender relaying that
-- answer back to the person (hop 2). Hop 2 may not send again, so the chain
-- terminates by construction rather than by runtime bookkeeping.
alter table briar_channel_agent_reply_jobs
  add column agent_message_hop integer not null default 0
    check (agent_message_hop between 0 and 2);

-- Ties every hop of one round trip to the job the person triggered. Cancel and
-- failure propagation, the "B is checking" indicator and the hourly cost cap
-- all key off this single ancestor rather than walking the chain.
alter table briar_channel_agent_reply_jobs
  add column origin_reply_job_id text
    references briar_channel_agent_reply_jobs (id) on delete cascade;

-- The existing channel delegation path (Organization Agent hands one question
-- to a Project Agent inside the same thread) stays untouched and stays
-- separate: a job is either a delegation child or a hop of an Agent-to-Agent
-- round trip, never both, and a hop is meaningless without its origin. Guards
-- live in triggers because a table check cannot be added to an existing table.
--> statement-breakpoint
create trigger briar_channel_reply_agent_message_hop_insert_guard
before insert on briar_channel_agent_reply_jobs
when new.agent_message_hop > 0
BEGIN
  select case
    when new.delegated_by_reply_job_id is not null
      then raise(abort, 'delegated reply cannot carry an Agent message hop')
  end;
  select case
    when new.origin_reply_job_id is null
      then raise(abort, 'Agent message hop requires an origin reply job')
  end;
END;

--> statement-breakpoint
create trigger briar_channel_reply_agent_message_hop_update_guard
before update of
  agent_message_hop, origin_reply_job_id, delegated_by_reply_job_id
on briar_channel_agent_reply_jobs
when new.agent_message_hop > 0
BEGIN
  select case
    when new.delegated_by_reply_job_id is not null
      then raise(abort, 'delegated reply cannot carry an Agent message hop')
  end;
  select case
    when new.origin_reply_job_id is null
      then raise(abort, 'Agent message hop requires an origin reply job')
  end;
END;

--> statement-breakpoint
create index briar_channel_agent_reply_jobs_agent_message_origin_idx
  on briar_channel_agent_reply_jobs (
    origin_reply_job_id, agent_message_hop, status
  );

-- Serves the per-organization hourly cap on Agent-to-Agent turns. Partial so it
-- stays proportional to the feature rather than to every channel reply.
create index briar_channel_agent_reply_jobs_agent_message_rate_idx
  on briar_channel_agent_reply_jobs (organization_id, created_at)
  where agent_message_hop > 0;

-- Links a message in the person's thread to its counterpart inside the
-- Agent-to-Agent DM. The `outbound` row is the short "sent to B" notice; the
-- `inbound` row is B's answer copied back, authored by B so the timeline can
-- render "from B". Both sides cascade with the messages they point at.
create table briar_channel_message_relays (
  message_id text primary key not null
    references briar_channel_messages (id) on delete cascade,
  direction text not null check (direction in ('outbound', 'inbound')),
  peer_channel_id text not null references briar_channels (id) on delete cascade,
  peer_message_id text not null
    references briar_channel_messages (id) on delete cascade,
  origin_reply_job_id text not null
    references briar_channel_agent_reply_jobs (id) on delete cascade,
  created_at text not null
);

-- Opening the Agent-to-Agent DM resolves the peer message back to its thread
-- row, and cancelling a round trip sweeps every relay of one origin job.
create index briar_channel_message_relays_peer_message_idx
  on briar_channel_message_relays (peer_message_id);

create index briar_channel_message_relays_origin_idx
  on briar_channel_message_relays (origin_reply_job_id);
