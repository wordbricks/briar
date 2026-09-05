import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";

import type { WranglerRunner } from "./apply-remote-d1-migrations";

const leaseNamePattern = /^[a-z][a-z0-9-]{0,79}$/u;
const ownerPattern = /^[0-9a-f-]{36}$/u;
const headShaPattern = /^[0-9a-f]{40}$/u;

const LeaseConfiguration = Schema.Struct({
  database: Schema.NonEmptyString,
  headSha: Schema.String.check(Schema.isPattern(headShaPattern)),
  heartbeatMillis: Schema.Int.check(
    Schema.isBetween({ minimum: 1_000, maximum: 3_599_999 }),
  ),
  name: Schema.String.check(Schema.isPattern(leaseNamePattern)),
  owner: Schema.String.check(Schema.isPattern(ownerPattern)),
  ttlSeconds: Schema.Int.check(
    Schema.isBetween({ minimum: 60, maximum: 3_600 }),
  ),
});

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

export class RemoteLeaseConfigurationError extends Schema.TaggedError<RemoteLeaseConfigurationError>()(
  "RemoteLeaseConfigurationError",
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

type ValidatedLeaseOptions = typeof LeaseConfiguration.Type & {
  readonly runner: WranglerRunner;
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

const validateOptions = Effect.fn("remoteOperationLease.validateOptions")(
  function* validateRemoteOperationLeaseOptionsEffect(
    options: RemoteOperationLeaseOptions,
  ): Effect.fn.Return<ValidatedLeaseOptions, RemoteLeaseConfigurationError> {
    const configuration = yield* Schema.decodeUnknownEffect(LeaseConfiguration)({
      database: options.database ?? "briar-db",
      headSha: options.headSha,
      heartbeatMillis: options.heartbeatMillis ?? 60_000,
      name: options.name,
      owner: options.owner ?? crypto.randomUUID(),
      ttlSeconds: options.ttlSeconds ?? 20 * 60,
    }).pipe(
      Effect.mapError((cause) => new RemoteLeaseConfigurationError({
        cause,
        message: "Remote operation lease configuration is invalid.",
      })),
    );
    if (configuration.heartbeatMillis >= configuration.ttlSeconds * 1_000) {
      return yield* new RemoteLeaseConfigurationError({
        cause: new Error("heartbeat must be shorter than TTL"),
        message: "Remote operation lease heartbeat must be shorter than its TTL.",
      });
    }
    return { ...configuration, runner: options.runner };
  },
);

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
  function* acquireEffect(options: ValidatedLeaseOptions) {
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
    options: ValidatedLeaseOptions,
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
    options: ValidatedLeaseOptions,
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

export const withRemoteOperationLease = Effect.fn("withRemoteOperationLease")(
  function* withRemoteOperationLeaseEffect<A>(
    options: RemoteOperationLeaseOptions,
    operation: (signal: AbortSignal) => Promise<A>,
  ) {
    const validated = yield* validateOptions(options);
    return yield* Effect.acquireUseRelease(
      acquire(validated),
      (lease) => {
        // A D1 import makes the database unavailable to serve queries, and a
        // lease command issued inside that window fails with a transient
        // internal error. Retrying keeps the lease alive across long imports;
        // only a genuinely lost lease may interrupt the protected operation.
        const heartbeat = Effect.sleep(validated.heartbeatMillis).pipe(
          Effect.andThen(renew(validated, lease).pipe(
            Effect.retry({
              schedule: Schedule.min([
                Schedule.spaced("10 seconds"),
                Schedule.recurs(11),
              ]),
              while: (error) => error._tag === "RemoteLeaseCommandError",
            }),
            Effect.catchIf(
              (error) => error._tag === "RemoteLeaseCommandError",
              (error) => Effect.logWarning(error.message),
            ),
          )),
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
        Effect.catch((error) => Effect.logWarning(error.message)),
      ),
    );
  },
);
