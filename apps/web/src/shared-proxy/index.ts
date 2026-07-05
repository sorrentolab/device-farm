import * as Data from "effect/Data"
import * as Schema from "effect/Schema"

export const Platform = Schema.Literal("ios", "android")
export type Platform = typeof Platform.Type

export const DeviceKind = Schema.Literal("simulator", "emulator", "physical")
export type DeviceKind = typeof DeviceKind.Type

export const DeviceStatus = Schema.Literal("online", "busy", "offline")
export type DeviceStatus = typeof DeviceStatus.Type

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
  currentJobId: Schema.NullOr(Schema.String),
  currentLeaseKind: Schema.NullOr(LeaseKind),
})
export type Device = typeof Device.Type

export const DeviceRequirements = Schema.Struct({
  platform: Schema.optional(Platform),
  kind: Schema.optional(DeviceKind),
  osMin: Schema.optional(Schema.String),
  osMax: Schema.optional(Schema.String),
  namePattern: Schema.optional(Schema.String),
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

export const RunFlowPayload = Schema.Struct({
  flowYaml: Schema.String,
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

export const DeviceList = Schema.Struct({ devices: Schema.Array(Device) })
export type DeviceList = typeof DeviceList.Type

export const WatchRequest = Schema.Struct({ watched: Schema.Boolean })
export type WatchRequest = typeof WatchRequest.Type

export const ReservationCreateRequest = Schema.Struct({
  requirements: Schema.optionalWith(DeviceRequirements, { default: () => ({}) }),
  ttlSeconds: Schema.optionalWith(Schema.Number, { default: () => 900 }),
  createdBy: Schema.optionalWith(Schema.String, { default: () => "anonymous" }),
})
export type ReservationCreateRequest = typeof ReservationCreateRequest.Type

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

export const RunLogChunk = Schema.Struct({
  runId: Schema.String,
  seq: Schema.Number,
  line: Schema.String,
  at: Schema.String,
})
export type RunLogChunk = typeof RunLogChunk.Type

export const DiscoveredDevice = Schema.Struct({
  udid: Schema.String,
  platform: Platform,
  kind: DeviceKind,
  name: Schema.String,
  osVersion: Schema.String,
  bootState: BootState,
})
export type DiscoveredDevice = typeof DiscoveredDevice.Type

export const AgentReport = Schema.Struct({
  agentHost: Schema.String,
  agentUrl: Schema.String,
  devices: Schema.Array(DiscoveredDevice),
})
export type AgentReport = typeof AgentReport.Type

export const AgentReportResponse = Schema.Struct({
  watchedUdids: Schema.Array(Schema.String),
})
export type AgentReportResponse = typeof AgentReportResponse.Type

export const RunEvent = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("log"),
    line: Schema.String,
    at: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("exit"),
    exitCode: Schema.Number,
    artifactsDir: Schema.NullOr(Schema.String),
    at: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("device_lost"),
    message: Schema.String,
    at: Schema.String,
  }),
)
export type RunEvent = typeof RunEvent.Type

export const RunEventBatch = Schema.Struct({
  runId: Schema.String,
  events: Schema.Array(RunEvent),
})
export type RunEventBatch = typeof RunEventBatch.Type

export const AgentRunRequest = Schema.Struct({
  runId: Schema.String,
  udid: Schema.String,
  platform: Platform,
  kind: DeviceKind,
  flowYaml: Schema.String,
  appPath: Schema.optional(Schema.String),
  appBundleId: Schema.optional(Schema.String),
  env: Schema.optionalWith(Schema.Record({ key: Schema.String, value: Schema.String }), {
    default: () => ({}),
  }),
})
export type AgentRunRequest = typeof AgentRunRequest.Type

export const AgentCancelRequest = Schema.Struct({ runId: Schema.String })
export type AgentCancelRequest = typeof AgentCancelRequest.Type

export const AgentScreenshotRequest = Schema.Struct({ udid: Schema.String })
export type AgentScreenshotRequest = typeof AgentScreenshotRequest.Type

export const AgentExecRequest = Schema.Struct({
  udid: Schema.String,
  argv: Schema.Array(Schema.String),
})
export type AgentExecRequest = typeof AgentExecRequest.Type

export const AgentBootRequest = Schema.Struct({ udid: Schema.String })
export type AgentBootRequest = typeof AgentBootRequest.Type

export const EXEC_ALLOW_LIST = [
  "adb",
  "xcrun",
  "idevicescreenshot",
  "ideviceinstaller",
  "maestro",
] as const

export const StubCommand = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("disconnect"),
    udid: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("reconnect"),
    udid: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("configure_run"),
    udid: Schema.String,
    durationMs: Schema.Number,
    exitCode: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  }),
  Schema.Struct({
    type: Schema.Literal("add_device"),
    device: DiscoveredDevice,
  }),
)
export type StubCommand = typeof StubCommand.Type

export const RealtimeMessage = Schema.Union(
  Schema.Struct({ type: Schema.Literal("device.updated"), device: Device }),
  Schema.Struct({ type: Schema.Literal("job.updated"), job: Job }),
  Schema.Struct({ type: Schema.Literal("run.updated"), run: Run }),
  Schema.Struct({
    type: Schema.Literal("run.log"),
    runId: Schema.String,
    line: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("frame"),
    deviceId: Schema.String,
    jpegBase64: Schema.String,
    at: Schema.String,
  }),
)
export type RealtimeMessage = typeof RealtimeMessage.Type

export class DeviceLostError extends Data.TaggedError("DeviceLostError")<{
  readonly deviceId: string
  readonly message: string
}> {}

export class NoDeviceAvailableError extends Data.TaggedError("NoDeviceAvailableError")<{
  readonly requirements: unknown
  readonly bootableCandidateUdid?: string
}> {}

export class LeaseExpiredError extends Data.TaggedError("LeaseExpiredError")<{
  readonly leaseId: string
}> {}

export class AgentUnreachableError extends Data.TaggedError("AgentUnreachableError")<{
  readonly agentHost: string
  readonly message: string
}> {}

export class ApiError extends Data.TaggedError("ApiError")<{
  readonly status: number
  readonly message: string
}> {}
