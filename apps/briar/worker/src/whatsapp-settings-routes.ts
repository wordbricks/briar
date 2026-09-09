import * as Schema from "effect/Schema";
import type { BriarAuth } from "./auth";
import { HttpError, json } from "./http-response";
import { hasWorkspaceCapability } from "./workspace-access";
import { getWorkspaceAgent } from "./workspace-agents";
import { getWorkspaceRole } from "./workspace-repository";
import { decodeRequestSync } from "./request-schema";
import { strictSchema, trimmedText, UuidString } from "./schema-codecs";
import { requireSession } from "./session-auth";
import { encryptWhatsAppToken, normalizeWhatsAppPhoneNumber } from "./whatsapp";
import {
  deleteWhatsAppUserLink,
  disconnectWhatsAppConnection,
  getWhatsAppConnectionForWorkspace,
  listWhatsAppUserLinks,
  upsertWhatsAppConnection,
  upsertWhatsAppUserLink,
  type WhatsAppConnectionRow,
} from "./whatsapp-repository";
import { sha256 } from "./crypto-digest";

const digits = (minimum: number, maximum: number) =>
  Schema.Trim.check(
    Schema.isLengthBetween(minimum, maximum),
    Schema.isPattern(/^\d+$/u),
  );

const WhatsAppConnectionInput = strictSchema(Schema.Struct({
  agentId: UuidString,
  phoneNumberId: digits(1, 64),
  wabaId: digits(1, 64),
  accessToken: trimmedText(1, 10_000),
  verifyToken: trimmedText(16, 500),
}));

const WhatsAppUserLinkInput = strictSchema(Schema.Struct({
  userId: trimmedText(1, 128),
  phoneNumber: trimmedText(8, 40),
}));

const decodeConnectionInput = decodeRequestSync(WhatsAppConnectionInput);
const decodeUserLinkInput = decodeRequestSync(WhatsAppUserLinkInput);

const connectionJson = (connection: WhatsAppConnectionRow | null) =>
  connection
    ? {
        id: connection.id,
        workspaceId: connection.organization_id,
        agentId: connection.agent_id,
        phoneNumberId: connection.phone_number_id,
        wabaId: connection.waba_id,
        status: connection.status,
        connectedAt: connection.connected_at,
        updatedAt: connection.updated_at,
      }
    : null;

async function requireWhatsAppSettingsAccess(
  auth: BriarAuth,
  db: D1Database,
  request: Request,
  workspaceId: string,
) {
  const session = await requireSession(auth, request);
  const role = await getWorkspaceRole(db, workspaceId, session.user.id);
  if (!hasWorkspaceCapability(role, "workspace:read")) {
    throw new HttpError(404, "Workspace not found");
  }
  if (!hasWorkspaceCapability(role, "workspace:update")) {
    throw new HttpError(403, "Workspace settings permission required");
  }
  return session.user.id;
}

const requestJson = (request: Request) =>
  request.json().catch(() => {
    throw new HttpError(400, "Invalid JSON body");
  });

export async function handleWhatsAppSettingsRoute(input: {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
}): Promise<Response | undefined> {
  const collectionMatch = input.url.pathname.match(
    /^\/workspaces\/([0-9a-f-]{36})\/integrations\/whatsapp$/iu,
  );
  const linksMatch = input.url.pathname.match(
    /^\/workspaces\/([0-9a-f-]{36})\/integrations\/whatsapp\/links$/iu,
  );
  const linkMatch = input.url.pathname.match(
    /^\/workspaces\/([0-9a-f-]{36})\/integrations\/whatsapp\/links\/([^/]+)$/iu,
  );
  const workspaceId = collectionMatch?.[1] ?? linksMatch?.[1] ?? linkMatch?.[1];
  if (!workspaceId) return undefined;
  const userId = await requireWhatsAppSettingsAccess(
    input.auth,
    input.db,
    input.request,
    workspaceId,
  );

  if (collectionMatch && input.request.method === "GET") {
    const [connection, links] = await Promise.all([
      getWhatsAppConnectionForWorkspace(input.db, workspaceId),
      listWhatsAppUserLinks(input.db, workspaceId),
    ]);
    return json({
      connection: connectionJson(connection),
      links: links.map((link) => ({
        id: link.id,
        userId: link.user_id,
        userName: link.user_name,
        phoneNumber: link.phone_number,
        lastInboundAt: link.last_inbound_at,
        updatedAt: link.updated_at,
      })),
    });
  }

  if (collectionMatch && input.request.method === "PUT") {
    const encryptionKey = input.env.WHATSAPP_TOKEN_ENCRYPTION_KEY?.trim();
    if (!encryptionKey) {
      throw new HttpError(503, "WhatsApp token encryption is not configured");
    }
    const request = decodeConnectionInput(await requestJson(input.request));
    const agent = await getWorkspaceAgent(input.db, workspaceId, request.agentId);
    if (!agent || agent.project_id !== null) {
      throw new HttpError(400, "Representative must be an Workspace Agent");
    }
    const encrypted = await encryptWhatsAppToken(request.accessToken, encryptionKey);
    try {
      const connection = await upsertWhatsAppConnection(input.db, {
        workspaceId,
        agentId: request.agentId,
        phoneNumberId: request.phoneNumberId,
        wabaId: request.wabaId,
        encryptedAccessToken: encrypted.encryptedToken,
        tokenIv: encrypted.iv,
        verifyTokenHash: await sha256(request.verifyToken),
        connectedByUserId: userId,
        observedAt: new Date().toISOString(),
      });
      return json({ connection: connectionJson(connection) });
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("unique")) {
        throw new HttpError(409, "WhatsApp number or verify token is already connected");
      }
      throw error;
    }
  }

  if (collectionMatch && input.request.method === "DELETE") {
    const disconnected = await disconnectWhatsAppConnection(
      input.db,
      workspaceId,
      new Date().toISOString(),
    );
    return json({ disconnected });
  }

  if (linksMatch && input.request.method === "PUT") {
    const request = decodeUserLinkInput(await requestJson(input.request));
    const phoneNumber = normalizeWhatsAppPhoneNumber(request.phoneNumber);
    if (!phoneNumber) throw new HttpError(400, "Invalid WhatsApp phone number");
    if (!(await getWorkspaceRole(input.db, workspaceId, request.userId))) {
      throw new HttpError(404, "Workspace member not found");
    }
    try {
      const link = await upsertWhatsAppUserLink(input.db, {
        workspaceId,
        userId: request.userId,
        phoneNumber,
        createdByUserId: userId,
        observedAt: new Date().toISOString(),
      });
      if (!link) throw new HttpError(409, "WhatsApp connection is not configured");
      return json({
        link: {
          id: link.id,
          userId: link.user_id,
          userName: link.user_name,
          phoneNumber: link.phone_number,
          lastInboundAt: link.last_inbound_at,
          updatedAt: link.updated_at,
        },
      });
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("unique")) {
        throw new HttpError(409, "WhatsApp phone number is linked to another member");
      }
      throw error;
    }
  }

  if (linkMatch && input.request.method === "DELETE") {
    return json({
      deleted: await deleteWhatsAppUserLink(
        input.db,
        workspaceId,
        decodeURIComponent(linkMatch[2]!),
      ),
    });
  }

  return undefined;
}
