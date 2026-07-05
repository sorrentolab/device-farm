import * as Schema from "effect/Schema"
import {
  Device,
  DeviceRequirements,
  Job,
  Run,
  RunFlowPayload,
} from "./domain.js"

// ---------- /api/jobs ----------

export const JobSubmitRequest = Schema.Struct({
  requirements: Schema.optionalWith(DeviceRequirements, { default: () => ({}) }),
  payload: RunFlowPayload,
  createdBy: Schema.optionalWith(Schema.String, { default: () => "anonymous" }),
  maxAttempts: Schema.optionalWith(Schema.Number, { default: () => 3 }),
})
export type JobSubmitRequest = typeof JobSubmitRequest.Type

export const JobDetail = Schema.Struct({
  job: Job,
  runs: Schema.Array(Run),
})
export type JobDetail = typeof JobDetail.Type

export const JobList = Schema.Struct({ jobs: Schema.Array(Job) })
export type JobList = typeof JobList.Type

// ---------- /api/devices ----------

export const DeviceList = Schema.Struct({ devices: Schema.Array(Device) })
export type DeviceList = typeof DeviceList.Type

export const WatchRequest = Schema.Struct({ watched: Schema.Boolean })
export type WatchRequest = typeof WatchRequest.Type

// ---------- /api/reservations ----------

export const ReservationCreateRequest = Schema.Struct({
  requirements: Schema.optionalWith(DeviceRequirements, { default: () => ({}) }),
  ttlSeconds: Schema.optionalWith(Schema.Number, { default: () => 900 }),
  createdBy: Schema.optionalWith(Schema.String, { default: () => "anonymous" }),
})
export type ReservationCreateRequest = typeof ReservationCreateRequest.Type

/** status mirrors the underlying reserve job: queued until a device is acquired. */
export const Reservation = Schema.Struct({
  id: Schema.String,
  jobId: Schema.String,
  status: Schema.Literal("queued", "active", "released", "expired", "canceled"),
  device: Schema.NullOr(Device),
  token: Schema.NullOr(Schema.String),
  expiresAt: Schema.NullOr(Schema.String),
  createdBy: Schema.String,
})
export type Reservation = typeof Reservation.Type

export const ExecRequest = Schema.Struct({
  /** argv passed to the allow-listed command runner, e.g. ["adb", "install", "/tmp/app.apk"] */
  argv: Schema.Array(Schema.String),
})
export type ExecRequest = typeof ExecRequest.Type

export const ExecResult = Schema.Struct({
  exitCode: Schema.Number,
  stdout: Schema.String,
  stderr: Schema.String,
})
export type ExecResult = typeof ExecResult.Type

export const ExtendRequest = Schema.Struct({ ttlSeconds: Schema.Number })
export type ExtendRequest = typeof ExtendRequest.Type

// ---------- run detail ----------

export const RunLogChunk = Schema.Struct({
  runId: Schema.String,
  seq: Schema.Number,
  line: Schema.String,
  at: Schema.String,
})
export type RunLogChunk = typeof RunLogChunk.Type
