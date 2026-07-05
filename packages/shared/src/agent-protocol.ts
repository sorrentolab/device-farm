import * as Schema from "effect/Schema"
import { BootState, DeviceKind, Platform } from "./domain"

// ---------- agent -> server (web /api/internal/*) ----------

/** One entry per device currently visible to the agent's discovery loop. */
export const DiscoveredDevice = Schema.Struct({
  udid: Schema.String,
  platform: Platform,
  kind: DeviceKind,
  name: Schema.String,
  osVersion: Schema.String,
  bootState: BootState,
})
export type DiscoveredDevice = typeof DiscoveredDevice.Type

/**
 * Sent every ~5s; doubles as registration, heartbeat, and disconnect signal.
 * Devices previously reported by this agent but absent here are marked offline immediately.
 */
export const AgentReport = Schema.Struct({
  agentHost: Schema.String,
  /** Base URL the server uses to reach this agent's local HTTP server */
  agentUrl: Schema.String,
  devices: Schema.Array(DiscoveredDevice),
})
export type AgentReport = typeof AgentReport.Type

export const AgentReportResponse = Schema.Struct({
  /** udids the agent should stream ~1fps frames for */
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
  /** Tooling broke (driver/connection), not the flow — the farm retries without excluding the device. */
  Schema.Struct({
    type: Schema.Literal("infra_failure"),
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

// ---------- server -> agent (agent local HTTP) ----------

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

/**
 * soft = kill every user app and land on the home screen (SpringBoard restart
 * on iOS sims, HOME + force-stop on Android); device stays booted.
 * hard = reboot the OS (shutdown+boot / adb reboot / devicectl reboot).
 */
export const AgentResetRequest = Schema.Struct({
  udid: Schema.String,
  mode: Schema.optionalWith(Schema.Literal("soft", "hard"), { default: () => "soft" as const }),
})
export type AgentResetRequest = typeof AgentResetRequest.Type

/** Commands the /exec allow-list accepts (first argv element). */
export const EXEC_ALLOW_LIST = [
  "adb",
  "xcrun",
  "idevicescreenshot",
  "ideviceinstaller",
  "maestro",
] as const

// ---------- e2e stub control (only in --stub mode) ----------

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
    /** how long the next fake run takes */
    durationMs: Schema.Number,
    /** force the next fake run to fail with this exit code */
    exitCode: Schema.optionalWith(Schema.Number, { default: () => 0 }),
    /** "infra" makes the fake run end with an infra_failure event instead of an exit */
    failureKind: Schema.optional(Schema.Literal("exit", "infra")),
  }),
  Schema.Struct({
    type: Schema.Literal("add_device"),
    device: DiscoveredDevice,
  }),
)
export type StubCommand = typeof StubCommand.Type
