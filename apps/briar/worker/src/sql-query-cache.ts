import type * as SqlClient from "effect/unstable/sql/SqlClient";

export const makeSqlQueryCache = <Queries>(
  makeQueries: (sql: SqlClient.SqlClient) => Queries,
) => {
  const cache = new WeakMap<SqlClient.SqlClient, Queries>();

  return (sql: SqlClient.SqlClient): Queries => {
    const existing = cache.get(sql);
    if (existing !== undefined) return existing;
    const queries = makeQueries(sql);
    cache.set(sql, queries);
    return queries;
  };
};
