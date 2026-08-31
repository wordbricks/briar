import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

export type ManagedComputerCredential = {
  credential: string;
  deviceId: string;
  organizationId: string;
  managedComputerId: string;
  apiOrigin: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const credentialPattern = /^briar_worker_[A-Za-z0-9_-]{43}$/u;

export const defaultManagedComputerCredentialPath =
  "/var/lib/briar/worker-credential.json";

export function configuredManagedComputerCredentialPath() {
  const configured = process.env.BRIAR_MANAGED_CREDENTIAL_FILE?.trim();
  const path = configured || defaultManagedComputerCredentialPath;
  if (!isAbsolute(path)) {
    throw new Error("BRIAR_MANAGED_CREDENTIAL_FILE must be an absolute path");
  }
  return path;
}

export function decodeManagedComputerCredential(
  value: unknown,
): ManagedComputerCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Managed computer credential file is invalid");
  }
  const record = value as Record<string, unknown>;
  const credential = typeof record.credential === "string"
    ? record.credential
    : "";
  const deviceId = typeof record.deviceId === "string" ? record.deviceId : "";
  const organizationId = typeof record.organizationId === "string"
    ? record.organizationId
    : "";
  const managedComputerId = typeof record.managedComputerId === "string"
    ? record.managedComputerId
    : "";
  const apiOrigin = typeof record.apiOrigin === "string" ? record.apiOrigin : "";
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(apiOrigin);
  } catch {
    throw new Error("Managed computer credential API origin is invalid");
  }
  if (
    !credentialPattern.test(credential) ||
    deviceId !== `managed-${managedComputerId}` ||
    !uuidPattern.test(managedComputerId) ||
    !uuidPattern.test(organizationId) ||
    parsedOrigin.protocol !== "https:" ||
    parsedOrigin.origin !== apiOrigin.replace(/\/$/u, "") ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search ||
    parsedOrigin.hash
  ) {
    throw new Error("Managed computer credential file is invalid");
  }
  return {
    credential,
    deviceId,
    organizationId,
    managedComputerId,
    apiOrigin: parsedOrigin.origin,
  };
}

export async function loadManagedComputerCredential(
  path = configuredManagedComputerCredentialPath(),
) {
  if (!isAbsolute(path)) {
    throw new Error("Managed computer credential path must be absolute");
  }
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Managed computer credential must be a regular file");
  }
  if ((metadata.mode & 0o027) !== 0) {
    throw new Error(
      "Managed computer credential permissions must not allow group writes or any access by other users",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Managed computer credential file is invalid JSON");
    }
    throw error;
  }
  return decodeManagedComputerCredential(value);
}

export async function loadOptionalManagedComputerCredential(
  path = configuredManagedComputerCredentialPath(),
) {
  try {
    return await loadManagedComputerCredential(path);
  } catch (error) {
    if (
      error && typeof error === "object" && "code" in error &&
      error.code === "ENOENT"
    ) return null;
    throw error;
  }
}
