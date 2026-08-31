import { HttpError } from "./http-response";

// The caller derives these identities from an authenticated, live server claim.
// Neither the model nor a request-supplied namespace is an authority.
export type DmMemoryAccess = {
  organizationId: string; channelId: string; ownerUserId: string;
  agentId: string; spaceId: string; revocationEpoch: number;
};
export type DmMemorySnapshot = { memory_revision: number; revocation_epoch: number; use_enabled: number };

export async function expireDmMemories(db: D1Database, now: string, spaceId?: string) {
  const result = await db.prepare(`update briar_dm_memory_documents set expired_version = current_version
    where id in (select doc.id from briar_dm_memory_documents doc
      join briar_dm_memory_revisions rev on rev.document_id = doc.id and rev.version = doc.current_version
      where doc.status = 'active' and doc.expired_version <> doc.current_version
        and (? is null or doc.space_id = ?) and rev.valid_until is not null
        and julianday(rev.valid_until) <= julianday(?) order by rev.valid_until, doc.id limit 100)
    returning id`)
    .bind(spaceId ?? null, spaceId ?? null, now).all<{ id: string }>();
  return result.results.length;
}

export async function requireDmMemoryAccess(db: D1Database, access: DmMemoryAccess, now: string) {
  await expireDmMemories(db, now, access.spaceId);
  const space = await db.prepare(`select space.memory_revision, space.revocation_epoch, space.use_enabled
    from briar_dm_memory_spaces space join briar_dm_memory_live_rosters live
      on live.organization_id = space.organization_id and live.channel_id = space.channel_id
      and live.owner_user_id = space.owner_user_id and live.agent_id = space.agent_id
      and live.roster_epoch = space.roster_epoch
    where space.id = ? and space.organization_id = ? and space.channel_id = ?
      and space.owner_user_id = ? and space.agent_id = ? and space.status = 'active'
      and space.use_enabled = 1 and space.revocation_epoch = ?`)
    .bind(access.spaceId, access.organizationId, access.channelId, access.ownerUserId,
      access.agentId, access.revocationEpoch).first<DmMemorySnapshot>();
  if (!space) throw new HttpError(409, "Memory permissions changed", "memory_scope_revoked");
  return space;
}

export const dmMemoryReadableDocument = `doc.status = 'active' and doc.expired_version <> doc.current_version
  and (rev.valid_until is null or julianday(rev.valid_until) > julianday(?))
  and not exists (select 1 from briar_dm_memory_sources source
    join briar_dm_memory_exclusions excluded on excluded.space_id = source.space_id
      and excluded.source_type = source.source_type and excluded.source_id = source.source_id
    where source.document_id = doc.id and source.document_version = doc.current_version)`;
