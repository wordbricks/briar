import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { WranglerRunner } from "./apply-remote-d1-migrations";

const leaseNamePattern = /^[a-z][a-z0-9-]{0,79}$/u;
const ownerPattern = /^[0-9a-f-]{36}$/u;
const headShaPattern = /^[0-9a-f]{40}$/u;

const NumericValue = Schema.Union([Schema.Number, Schema.NumberFromString]);
const LeaseRow = Schema.Struct({
  owner: Schema.optional(Schema.String),
  head_sha: Schema.optional(Schema.String),
  expires_at: Schema.optional(NumericValue),
});
const WranglerQueryOutput = Schema.Array(Schema.Struct({
  success: Schema.Boolean,
  results: Schema.optional(Schema.Array(LeaseRow)),
}));
const decodeWranglerQueryOutput = Schema.decodeUnknownSync(WranglerQueryOutput);

export class RemoteLeaseCommandError extends Schema.TaggedError<RemoteLeaseCommandError>()(
  "RemoteLeaseCommandError",
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

export class RemoteLeaseBusy extends Schema.TaggedError<RemoteLeaseBusy>()(
  "RemoteLeaseBusy",
  {
    expiresAt: Schema.Number,
    headSha: Schema.String,
    message: Schema.String,
    owner: Schema.String,
  },
) {}

export class RemoteLeaseLost extends Schema.TaggedError<RemoteLeaseLost>()(
  "RemoteLeaseLost",
  { message: Schema.String },
) {}

export type RemoteOperationLeaseOptions = {
  readonly database?: string;
  readonly headSha: string;
  readonly heartbeatMillis?: number;
  readonly name: string;
  readonly owner?: string;
  readonly runner: WranglerRunner;
  readonly ttlSeconds?: number;
};

type Lease = {
  readonly expiresAt: number;
  readonly headSha: string;
  readonly name: string;
  readonly owner: string;
};

const escapeSql = (value: string) => value.replaceAll("'", "''");

const leaseTableSql = `create table if not exists briar_production_operation_leases (
  name text primary key not null,
  owner text not null,
  head_sha text not null,
  acquired_at integer not null,
  expires_at integer not null,
  constraint briar_production_operation_leases_name_check
    check (length(name) between 1 and 80),
  constraint briar_production_operation_leases_owner_check
    check (length(owner) between 1 and 80),
  constraint briar_production_operation_leases_head_sha_check
    check (head_sha not glob '*[^0-9a-f]*' and length(head_sha) = 40),
  constraint briar_production_operation_leases_expiry_check
    check (expires_at > acquired_at)
) strict;`;

function validateOptions(options: RemoteOperationLeaseOptions) {
  const owner = options.owner ?? crypto.randomUUID();
  const ttlSeconds = options.ttlSeconds ?? 20 * 60;
  const heartbeatMillis = options.heartbeatMillis ?? 60_000;
  if (!leaseNamePattern.test(options.name)) {
    throw new Error("Remote operation lease name is invalid.");
  }
  if (!ownerPattern.test(owner)) {
    throw new Error("Remote operation lease owner must be a UUID.");
  }
  if (!headShaPattern.test(options.headSha)) {
    throw new Error("Remote operation lease headSha must be a full Git SHA.");
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3_600) {
    throw new Error("Remote operation lease TTL must be 60-3600 seconds.");
  }
  if (
    !Number.isInteger(heartbeatMillis) ||
    heartbeatMillis < 1_000 ||
    heartbeatMillis >= ttlSeconds * 1_000
  ) {
    throw new Error("Remote operation lease heartbeat must be shorter than its TTL.");
  }
  return {
    database: options.database ?? "briar-db",
    headSha: options.headSha,
    heartbeatMillis,
    name: options.name,
    owner,
    runner: options.runner,
    ttlSeconds,
  } as const;
}

const query = Effect.fn("remoteOperationLease.query")(
  function* queryEffect(
    runner: WranglerRunner,
    database: string,
    sql: string,
  ) {
    const result = yield* Effect.tryPromise({
      try: (signal) => runner([
        "d1",
        "execute",
        database,
        "--remote",
        "--command",
        sql,
        "--yes",
        "--json",
      ], true, signal),
      catch: (cause) => new RemoteLeaseCommandError({
        cause,
        message: "Could not execute the remote D1 lease command.",
      }),
    });
    if (result.exitCode !== 0) {
      return yield* new RemoteLeaseCommandError({
        cause: new Error(`wrangler exited with ${result.exitCode}`),
        message: `Remote D1 lease command failed with exit code ${result.exitCode}.`,
      });
    }
    return yield* Effect.try({
      try: () => decodeWranglerQueryOutput(JSON.parse(result.stdout)),
      catch: (cause) => new RemoteLeaseCommandError({
        cause,
        message: "Remote D1 lease command returned invalid JSON.",
      }),
    });
  },
);

const lastLeaseRow = (
  output: typeof WranglerQueryOutput.Type,
): typeof LeaseRow.Type | undefined => {
  if (output.some((entry) => !entry.success)) return undefined;
  return output.flatMap((entry) => entry.results ?? []).at(-1);
};

const acquire = Effect.fn("remoteOperationLease.acquire")(
  function* acquireEffect(options: ReturnType<typeof validateOptions>) {
    const name = escapeSql(options.name);
    const owner = escapeSql(options.owner);
    const headSha = escapeSql(options.headSha);
    const output = yield* query(options.runner, options.database, `${leaseTableSql}
insert into briar_production_operation_leases (
  name, owner, head_sha, acquired_at, expires_at
) values (
  '${name}', '${owner}', '${headSha}', unixepoch(), unixepoch() + ${options.ttlSeconds}
)
on conflict(name) do update set
  owner = excluded.owner,
  head_sha = excluded.head_sha,
  acquired_at = excluded.acquired_at,
  expires_at = excluded.expires_at
where briar_production_operation_leases.expires_at <= unixepoch();
select owner, head_sha, expires_at
from briar_production_operation_leases
where name = '${name}';`);
    const row = lastLeaseRow(output);
    if (
      !row ||
      typeof row.owner !== "string" ||
      typeof row.head_sha !== "string" ||
      typeof row.expires_at !== "number"
    ) {
      return yield* new RemoteLeaseCommandError({
        cause: new Error("missing lease row"),
        message: "Remote D1 did not return the production operation lease.",
      });
    }
    if (row.owner !== options.owner) {
      return yield* new RemoteLeaseBusy({
        expiresAt: row.expires_at,
        headSha: row.head_sha,
        message: `Production operation ${options.name} is already running for ${row.head_sha}.`,
        owner: row.owner,
      });
    }
    return {
      expiresAt: row.expires_at,
      headSha: options.headSha,
      name: options.name,
      owner: options.owner,
    } satisfies Lease;
  },
);

const renew = Effect.fn("remoteOperationLease.renew")(
  function* renewEffect(
    options: ReturnType<typeof validateOptions>,
    lease: Lease,
  ) {
    const name = escapeSql(lease.name);
    const owner = escapeSql(lease.owner);
    const output = yield* query(options.runner, options.database, `update briar_production_operation_leases
set expires_at = unixepoch() + ${options.ttlSeconds}
where name = '${name}' and owner = '${owner}';
select owner, head_sha, expires_at
from briar_production_operation_leases
where name = '${name}' and owner = '${owner}';`);
    const row = lastLeaseRow(output);
    if (row?.owner !== lease.owner) {
      return yield* new RemoteLeaseLost({
        message: `Lost production operation lease ${lease.name}; aborting before another deployment can cross it.`,
      });
    }
  },
);

const release = Effect.fn("remoteOperationLease.release")(
  function* releaseEffect(
    options: ReturnType<typeof validateOptions>,
    lease: Lease,
  ) {
    const result = yield* Effect.tryPromise({
      try: (signal) => options.runner([
        "d1",
        "execute",
        options.database,
        "--remote",
        "--command",
        `delete from briar_production_operation_leases where name = '${escapeSql(lease.name)}' and owner = '${escapeSql(lease.owner)}';`,
        "--yes",
      ], false, signal),
      catch: (cause) => new RemoteLeaseCommandError({
        cause,
        message: `Could not release production operation lease ${lease.name}.`,
      }),
    });
    if (result.exitCode !== 0) {
      return yield* new RemoteLeaseCommandError({
        cause: new Error(`wrangler exited with ${result.exitCode}`),
        message: `Could not release production operation lease ${lease.name}.`,
      });
    }
  },
);

export async function withRemoteOperationLease<A>(
  options: RemoteOperationLeaseOptions,
  operation: (signal: AbortSignal) => Promise<A>,
) {
  const validated = validateOptions(options);
  const program = Effect.acquireUseRelease(
    acquire(validated),
    (lease) => {
      const heartbeat = Effect.sleep(validated.heartbeatMillis).pipe(
        Effect.andThen(renew(validated, lease)),
        Effect.forever,
      );
      const use = Effect.tryPromise({
        try: operation,
        catch: (cause) => new RemoteLeaseCommandError({
          cause,
          message: `Production operation ${lease.name} failed.`,
        }),
      });
      return Effect.raceFirst(use, heartbeat);
    },
    (lease) => release(validated, lease).pipe(
      Effect.catch((error) => Effect.sync(() => console.warn(error.message))),
    ),
  );
  return Effect.runPromise(program);
}
