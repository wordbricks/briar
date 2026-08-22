import * as D1Client from "@effect/sql-d1/D1Client";
import type * as Config from "effect/Config";
import type * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type * as SqlClient from "effect/unstable/sql/SqlClient";

type D1Runtime = ManagedRuntime.ManagedRuntime<
  D1Client.D1Client | SqlClient.SqlClient,
  Config.ConfigError
>;

const runtimes = new WeakMap<D1Database, D1Runtime>();

const runtimeFor = (db: D1Database): D1Runtime => {
  const existing = runtimes.get(db);
  if (existing !== undefined) {
    return existing;
  }
  const runtime = ManagedRuntime.make(D1Client.layer({ db }));
  runtimes.set(db, runtime);
  return runtime;
};

export const runD1 = <A, E>(
  db: D1Database,
  effect: Effect.Effect<
    A,
    E,
    D1Client.D1Client | SqlClient.SqlClient
  >,
): Promise<A> => runtimeFor(db).runPromise(effect);
