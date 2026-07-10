import type {
  AgentRunRequest,
  DiscoveredDevice,
  RunEvent,
} from "@dfarm/shared"

export type AgentConfig = {
  readonly serverUrl: string
  readonly agentHost: string
  readonly agentUrl: string
  readonly port: number
  readonly artifactsDir: string
  readonly stub: boolean
}

export type CaptureResult = {
  readonly bytes: Uint8Array
  readonly contentType: "image/jpeg" | "image/png"
}

export type RecordingHandle = {
  /** Finalize the recorder and land the video file(s) in the artifacts dir. Idempotent callers only. */
  readonly stop: () => Promise<void>
}

export type CommandOutput = {
  readonly exitCode: number
  readonly stdout: Uint8Array
  readonly stderr: Uint8Array
}

export type CommandResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type DiscoveryListener = (
  devices: ReadonlyArray<DiscoveredDevice>,
  previous: ReadonlyArray<DiscoveredDevice>,
) => void | Promise<void>

export type ActiveRunProcess = {
  readonly request: AgentRunRequest
  readonly kill: () => void
  readonly markDeviceLost: (message: string) => Promise<void>
}

export type RunEventSink = (events: ReadonlyArray<RunEvent>) => Promise<void>
