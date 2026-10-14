import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { runWorkerDeployInOrder, WorkerDeployOrder } from "./worker-deploy-order";

const steps = (exitCodes: { migrate?: number; deploy?: number } = {}) => {
  const ran: string[] = [];
  return {
    ran,
    migrate: async () => { ran.push("migrate"); return exitCodes.migrate ?? 0; },
    deploy: async () => { ran.push("deploy"); return exitCodes.deploy ?? 0; },
  };
};

describe("worker deploy order", () => {
  it("applies migrations before the code by default", async () => {
    const run = steps();
    expect(await runWorkerDeployInOrder({ order: "migrations-first", ...run })).toBe(0);
    expect(run.ran).toEqual(["migrate", "deploy"]);
  });

  it("deploys the code first for a narrowing migration", async () => {
    const run = steps();
    expect(await runWorkerDeployInOrder({ order: "code-first", ...run })).toBe(0);
    expect(run.ran).toEqual(["deploy", "migrate"]);
  });

  it("stops at the first failing half", async () => {
    const migrationFails = steps({ migrate: 3 });
    expect(await runWorkerDeployInOrder({ order: "migrations-first", ...migrationFails })).toBe(3);
    expect(migrationFails.ran).toEqual(["migrate"]);
    const deployFails = steps({ deploy: 5 });
    expect(await runWorkerDeployInOrder({ order: "code-first", ...deployFails })).toBe(5);
    expect(deployFails.ran).toEqual(["deploy"]);
  });

  it("accepts only the two orders", () => {
    expect(Schema.decodeUnknownSync(WorkerDeployOrder)("code-first")).toBe("code-first");
    expect(() => Schema.decodeUnknownSync(WorkerDeployOrder)("code-only")).toThrow();
  });
});
