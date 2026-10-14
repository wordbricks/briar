import * as Schema from "effect/Schema";

/**
 * Which half of `worker:deploy` goes first. The default applies pending D1
 * migrations, then deploys the code: right for a widening change, which the new
 * code needs and the old code ignores. A narrowing change — a migration that
 * drops what the live code still reads — needs the opposite order, or the old
 * code fails against the new schema until the deploy lands
 * (docs/operations/d1-schema-changes.md, "Applying it").
 */
export const WorkerDeployOrder = Schema.Literals(["migrations-first", "code-first"]);
export type WorkerDeployOrder = typeof WorkerDeployOrder.Type;

export async function runWorkerDeployInOrder(input: {
  readonly order: WorkerDeployOrder;
  readonly migrate: () => Promise<number>;
  readonly deploy: () => Promise<number>;
}): Promise<number> {
  const [first, second] = input.order === "code-first"
    ? [input.deploy, input.migrate]
    : [input.migrate, input.deploy];
  const exitCode = await first();
  if (exitCode !== 0) return exitCode;
  return second();
}
