import type { DmMemorySettingsInput, DmMemorySpace } from "../../src/lib/dm-memory-contract";
import { sha256 } from "./crypto-digest";
import { HttpError } from "./http-response";

/**
 * DM memory spaces: one per organization, DM channel, owner, Agent and roster
 * epoch (docs/plans/memory-vault-spec.md §3, §4). A space is the identity a DM
 * vault belongs to and carries the owner's switches — `use_enabled` (recall)
 * and `auto_enabled` (the Agent may write on its own) — plus the revocation
 * epoch that ends claims and resumed conversations when permissions change.
 * The roster and permission triggers in the schema close or revoke spaces.
 */
export type DmMemoryOwner = { workspaceId: string; channelId: string; userId: string };
export type DmMemorySpaceRow = {
  id: string; organization_id: string; channel_id: string; owner_user_id: string;
  agent_id: string; roster_epoch: number; status: "active" | "closed";
  use_enabled: number; auto_enabled: number; ever_saved: number;
  memory_revision: number; revocation_epoch: number; created_at: string; updated_at: string;
};

export const dmMemorySpaceJson = (space: DmMemorySpaceRow): DmMemorySpace => ({
  id: space.id, channelId: space.channel_id, agentId: space.agent_id,
  rosterEpoch: space.roster_epoch, status: space.status,
  useEnabled: space.use_enabled === 1, autoEnabled: space.auto_enabled === 1,
  memoryRevision: space.memory_revision, revocationEpoch: space.revocation_epoch,
  createdAt: space.created_at, updatedAt: space.updated_at,
});

const ownerWhere = `space.organization_id = ? and space.channel_id = ? and space.owner_user_id = ?
  and exists (select 1 from briar_organization_members member
    where member.organization_id = space.organization_id and member.user_id = space.owner_user_id)`;
const ownerBindings = (owner: DmMemoryOwner) => [owner.workspaceId, owner.channelId, owner.userId];
const liveSpaceWhere = `space.status = 'active' and exists (
  select 1 from briar_dm_memory_live_rosters live
  where live.organization_id = space.organization_id and live.channel_id = space.channel_id
    and live.owner_user_id = space.owner_user_id and live.agent_id = space.agent_id
    and live.roster_epoch = space.roster_epoch
)`;

/** Every space the owner has in this DM, newest roster first. */
export async function listDmMemorySpaces(db: D1Database, owner: DmMemoryOwner) {
  const { results } = await db.prepare(`select space.* from briar_dm_memory_spaces space
    where ${ownerWhere} order by space.roster_epoch desc, space.id`)
    .bind(...ownerBindings(owner)).all<DmMemorySpaceRow>();
  return results;
}

async function requireSpace(db: D1Database, owner: DmMemoryOwner, spaceId: string) {
  const row = await db.prepare(`select space.* from briar_dm_memory_spaces space
    where ${ownerWhere} and space.id = ?`).bind(...ownerBindings(owner), spaceId).first<DmMemorySpaceRow>();
  if (!row) throw new HttpError(404, "Memory space not found", "memory_not_found");
  return row;
}

/** The named space, or the live roster's space (created on first use). */
export async function ensureWriteSpace(db: D1Database, owner: DmMemoryOwner, spaceId?: string) {
  if (spaceId) return requireSpace(db, owner, spaceId);
  const now = new Date().toISOString();
  await db.prepare(`insert into briar_dm_memory_spaces (
    id, organization_id, channel_id, owner_user_id, agent_id, roster_epoch, created_at, updated_at
  ) select ?, organization_id, channel_id, owner_user_id, agent_id, roster_epoch, ?, ?
    from briar_dm_memory_live_rosters
    where organization_id = ? and channel_id = ? and owner_user_id = ?
    on conflict (organization_id, channel_id, owner_user_id, agent_id, roster_epoch) do nothing`)
    .bind(crypto.randomUUID(), now, now, ...ownerBindings(owner)).run();
  const row = await db.prepare(`select space.* from briar_dm_memory_spaces space
    where ${ownerWhere} and ${liveSpaceWhere}`)
    .bind(...ownerBindings(owner)).first<DmMemorySpaceRow>();
  if (!row) throw new HttpError(409, "An active one-user, one-Agent DM is required", "memory_scope_revoked");
  return row;
}

/** Whether the DM is eligible, the owner's spaces, and the selected one (default: newest). */
export async function dmMemorySpacePage(db: D1Database, owner: DmMemoryOwner, spaceId?: string) {
  const spaces = await listDmMemorySpaces(db, owner);
  const eligible = await db.prepare(`select 1 as found from briar_dm_memory_live_rosters
    where organization_id = ? and channel_id = ? and owner_user_id = ?`)
    .bind(...ownerBindings(owner)).first();
  const selected = spaceId ? spaces.find((space) => space.id === spaceId) : spaces[0];
  if (spaceId && !selected) throw new HttpError(404, "Memory space not found", "memory_not_found");
  return { eligible: eligible !== null, spaces, selected: selected ?? null };
}

type SettingRequestRow = { id: string; payload_hash: string; applied: number };

const findSettingRequest = (db: D1Database, spaceId: string, requestId: string) =>
  db.prepare(`select id, payload_hash, applied from briar_dm_memory_setting_requests
    where space_id = ? and request_id = ?`).bind(spaceId, requestId).first<SettingRequestRow>();

/**
 * The owner's recall and automatic-writing switches. Idempotent per request id
 * and guarded by the space's memory revision; turning either switch off bumps
 * the revocation epoch, which ends claims and resumed conversations that ran
 * under the wider permission.
 */
export async function updateDmMemorySettings(db: D1Database, owner: DmMemoryOwner, input: DmMemorySettingsInput) {
  if (input.autoEnabled && !input.useEnabled) {
    throw new HttpError(400, "Enable memory use before automatic memory", "memory_invalid_settings");
  }
  const space = await ensureWriteSpace(db, owner, input.memorySpaceId);
  const payloadHash = await sha256(JSON.stringify(input));
  const previous = await findSettingRequest(db, space.id, input.requestId);
  if (previous) {
    if (previous.payload_hash !== payloadHash) throw new HttpError(409, "Request ID was already used", "idempotency_conflict");
    return dmMemorySpaceJson(await requireSpace(db, owner, space.id));
  }
  const requestRowId = crypto.randomUUID();
  const now = new Date().toISOString();
  const gate = `exists (select 1 from briar_dm_memory_setting_requests where id = ? and applied = 0)`;
  await db.batch([
    db.prepare(`insert into briar_dm_memory_setting_requests
      (id, space_id, request_id, payload_hash, created_at)
      select ?, space.id, ?, ?, ? from briar_dm_memory_spaces space
      where ${ownerWhere} and space.id = ? and space.memory_revision = ? and ${liveSpaceWhere}
      on conflict (space_id, request_id) do nothing`)
      .bind(requestRowId, input.requestId, payloadHash, now, ...ownerBindings(owner), space.id,
        input.expectedMemoryRevision),
    db.prepare(`update briar_dm_memory_spaces set use_enabled = ?, auto_enabled = ?,
      memory_revision = memory_revision + 1,
      revocation_epoch = revocation_epoch + case when ? = 0 or (auto_enabled = 1 and ? = 0) then 1 else 0 end,
      updated_at = ? where id = ? and ${gate}`)
      .bind(Number(input.useEnabled), Number(input.autoEnabled), Number(input.useEnabled),
        Number(input.autoEnabled), now, space.id, requestRowId),
    db.prepare("update briar_dm_memory_setting_requests set applied = 1 where id = ? and applied = 0")
      .bind(requestRowId),
  ]);
  const committed = await findSettingRequest(db, space.id, input.requestId);
  if (!committed?.applied || committed.payload_hash !== payloadHash) {
    throw new HttpError(409, "Memory settings changed; reload", "version_conflict");
  }
  return dmMemorySpaceJson(await requireSpace(db, owner, space.id));
}
