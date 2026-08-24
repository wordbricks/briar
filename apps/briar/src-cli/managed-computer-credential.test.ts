import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadManagedComputerCredential } from "./managed-computer-credential";

const managedComputerId = "44444444-4444-4444-8444-444444444444";
const organizationId = "55555555-5555-4555-8555-555555555555";
const credential = `briar_worker_${"a".repeat(43)}`;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

async function fixture(mode = 0o640) {
  const directory = await mkdtemp(join(tmpdir(), "briar-managed-credential-"));
  directories.push(directory);
  const path = join(directory, "credential.json");
  await writeFile(path, JSON.stringify({
    credential,
    deviceId: `managed-${managedComputerId}`,
    organizationId,
    managedComputerId,
    apiOrigin: "https://briar.example",
  }), { mode });
  await chmod(path, mode);
  return path;
}

describe("managed computer credential", () => {
  it("accepts the enrollment file without exposing extra fields", async () => {
    await expect(loadManagedComputerCredential(await fixture())).resolves.toEqual({
      credential,
      deviceId: `managed-${managedComputerId}`,
      organizationId,
      managedComputerId,
      apiOrigin: "https://briar.example",
    });
  });

  it("rejects credentials readable by other users", async () => {
    await expect(loadManagedComputerCredential(await fixture(0o644)))
      .rejects.toThrow("permissions");
  });

  it("rejects a mismatched device identity without echoing the credential", async () => {
    const path = await fixture();
    const value = JSON.parse(await readFile(path, "utf8"));
    value.deviceId = "managed-00000000-0000-4000-8000-000000000000";
    await writeFile(path, JSON.stringify(value), { mode: 0o640 });
    let error: unknown;
    try {
      await loadManagedComputerCredential(path);
    } catch (cause) {
      error = cause;
    }
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain(credential);
  });
});
