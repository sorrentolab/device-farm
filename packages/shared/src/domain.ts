import * as Schema from "effect/Schema"

export const Platform = Schema.Literal("ios", "android")
export type Platform = typeof Platform.Type

export const DeviceKind = Schema.Literal("simulator", "emulator", "physical")
export type DeviceKind = typeof DeviceKind.Type

/** online = reachable and free, busy = held by a lease, offline = gone from discovery or agent dead */
export const DeviceStatus = Schema.Literal("online", "busy", "offline")
export type DeviceStatus = typeof DeviceStatus.Type

/** Simulators/emulators can be known but not booted; failover may boot them on demand. */
export const BootState = Schema.Literal("booted", "shutdown")
export type BootState = typeof BootState.Type

export const LeaseKind = Schema.Literal("job", "interactive")
export type LeaseKind = typeof LeaseKind.Type

export const Device = Schema.Struct({
  id: Schema.String,
  udid: Schema.String,
  platform: Platform,
  kind: DeviceKind,
  name: Schema.String,
  osVersion: Schema.String,
  status: DeviceStatus,
  bootState: BootState,
  agentHost: Schema.String,
  watched: Schema.Boolean,
  lastHeartbeatAt: Schema.NullOr(Schema.String),
  /** Set while a lease holds the device */
  currentJobId: Schema.NullOr(Schema.String),
  currentLeaseKind: Schema.NullOr(LeaseKind),
})
export type Device = typeof Device.Type

/** All fields optional — an empty requirements object matches any device. */
export const DeviceRequirements = Schema.Struct({
  platform: Schema.optional(Platform),
  kind: Schema.optional(DeviceKind),
  /** Inclusive bounds, compared as dotted version strings (e.g. "17.0") */
  osMin: Schema.optional(Schema.String),
  osMax: Schema.optional(Schema.String),
  /** Case-insensitive substring or /regex/ against device name */
  namePattern: Schema.optional(Schema.String),
  /** Pin to one exact device */
  deviceUdid: Schema.optional(Schema.String),
})
export type DeviceRequirements = typeof DeviceRequirements.Type

export const JobType = Schema.Literal("run_flow", "reserve")
export type JobType = typeof JobType.Type

export const JobStatus = Schema.Literal(
  "queued",
  "assigned",
  "running",
  "passed",
  "failed",
  "canceled",
)
export type JobStatus = typeof JobStatus.Type

export const RunOutcome = Schema.Literal("passed", "failed", "device_lost", "canceled")
export type RunOutcome = typeof RunOutcome.Type

/** Flow YAML travels as content, not a host path, so a job is re-runnable on any device/host. */
export const RunFlowPayload = Schema.Struct({
  flowYaml: Schema.String,
  /** Absolute path to .app/.apk on the farm host (v1: single machine) */
  appPath: Schema.optional(Schema.String),
  appBundleId: Schema.optional(Schema.String),
  env: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
    default: () => ({}),
  }),
})
export type RunFlowPayload = typeof RunFlowPayload.Type

export const ReservePayload = Schema.Struct({
  ttlSeconds: Schema.Number,
})
export type ReservePayload = typeof ReservePayload.Type

export const Job = Schema.Struct({
  id: Schema.String,
  type: JobType,
  status: JobStatus,
  requirements: DeviceRequirements,
  payload: Schema.Union(RunFlowPayload, ReservePayload),
  /** Free-text client label (agent/project name) shown on the dashboard */
  createdBy: Schema.String,
  attempt: Schema.Number,
  maxAttempts: Schema.Number,
  createdAt: Schema.String,
  updatedAt: Schema.String,
})
export type Job = typeof Job.Type

export const Run = Schema.Struct({
  id: Schema.String,
  jobId: Schema.String,
  attempt: Schema.Number,
  deviceId: Schema.String,
  deviceName: Schema.String,
  outcome: Schema.NullOr(RunOutcome),
  exitCode: Schema.NullOr(Schema.Number),
  artifactsDir: Schema.NullOr(Schema.String),
  errorMessage: Schema.NullOr(Schema.String),
  startedAt: Schema.String,
  finishedAt: Schema.NullOr(Schema.String),
})
export type Run = typeof Run.Type

export const Lease = Schema.Struct({
  id: Schema.String,
  deviceId: Schema.String,
  jobId: Schema.NullOr(Schema.String),
  kind: LeaseKind,
  token: Schema.String,
  expiresAt: Schema.String,
  createdAt: Schema.String,
})
export type Lease = typeof Lease.Type
