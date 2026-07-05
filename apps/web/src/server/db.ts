import * as schema from "@/db/schema"
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js"
import * as Effect from "effect/Effect"
import postgres, { type Sql } from "postgres"

export type DbClient = PostgresJsDatabase<typeof schema>

type DbGlobal = {
  sql?: Sql
  db?: DbClient
}

const globalForDb = globalThis as typeof globalThis & { __dfarmDb?: DbGlobal }

const state = (globalForDb.__dfarmDb ??= {})

export const databaseUrl = () =>
  process.env.DATABASE_URL ?? "postgres://dfarm:dfarm@localhost:5442/dfarm"

export const getSql = (): Sql => {
  state.sql ??= postgres(databaseUrl(), {
    max: 10,
    prepare: false,
  })
  return state.sql
}

export const getDb = (): DbClient => {
  state.db ??= drizzle(getSql(), { schema })
  return state.db
}

export class Db extends Effect.Service<Db>()("Db", {
  sync: () => ({
    client: getDb(),
    sql: getSql(),
  }),
}) {}
