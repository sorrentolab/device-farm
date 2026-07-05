import type { DeviceRequirements, RunFlowPayload, ReservePayload } from "@dfarm/shared"
import { relations, sql } from "drizzle-orm"
import {
  bigserial,
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core"

export const devices = pgTable(
  "devices",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    udid: text("udid").notNull(),
    agentHost: text("agent_host").notNull(),
    agentUrl: text("agent_url").notNull(),
    platform: text("platform").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    osVersion: text("os_version").notNull(),
    status: text("status").notNull().default("offline"),
    bootState: text("boot_state").notNull().default("shutdown"),
    watched: boolean("watched").notNull().default(false),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    /** Janitor soft-delete: offline > 7 days. Hidden from the API, kept for run history joins. */
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("devices_agent_host_udid_unique").on(table.agentHost, table.udid),
  ],
)

export const jobs = pgTable("jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull().default("queued"),
  requirements: jsonb("requirements")
    .$type<DeviceRequirements>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  payload: jsonb("payload").$type<RunFlowPayload | ReservePayload>().notNull(),
  createdBy: text("created_by").notNull(),
  attempt: integer("attempt").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  excludedDeviceIds: jsonb("excluded_device_ids")
    .$type<string[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  /** why the farm failed this job (impossible requirements, retries exhausted) */
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const runs = pgTable("runs", {
  id: uuid("id").defaultRandom().primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id, { onDelete: "restrict" }),
  outcome: text("outcome"),
  exitCode: integer("exit_code"),
  artifactsDir: text("artifacts_dir"),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
})

export const runLogs = pgTable("run_logs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  runId: uuid("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  line: text("line").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull(),
})

export const leases = pgTable(
  "leases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    token: text("token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("leases_device_id_unique").on(table.deviceId)],
)

export const deviceRelations = relations(devices, ({ many }) => ({
  runs: many(runs),
  leases: many(leases),
}))

export const jobRelations = relations(jobs, ({ many }) => ({
  runs: many(runs),
  leases: many(leases),
}))

export const runRelations = relations(runs, ({ one, many }) => ({
  job: one(jobs, { fields: [runs.jobId], references: [jobs.id] }),
  device: one(devices, { fields: [runs.deviceId], references: [devices.id] }),
  logs: many(runLogs),
}))

export const leaseRelations = relations(leases, ({ one }) => ({
  job: one(jobs, { fields: [leases.jobId], references: [jobs.id] }),
  device: one(devices, { fields: [leases.deviceId], references: [devices.id] }),
}))
