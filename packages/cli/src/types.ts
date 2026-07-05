import type { DeviceKind, Platform } from "@dfarm/shared"

export type RequirementsInput = {
  platform?: Platform
  kind?: DeviceKind
  osMin?: string
  osMax?: string
  namePattern?: string
  deviceUdid?: string
}

export type HelpTopic =
  | "docs"
  | "devices"
  | "run"
  | "reserve"
  | "shot"
  | "exec"
  | "extend"
  | "release"
  | "status"
  | "cancel"

export type HelpCommand = {
  readonly _tag: "Help"
  readonly topic?: HelpTopic
}

export type DevicesCommand = {
  readonly _tag: "Devices"
  readonly json: boolean
}

export type RunCommand = {
  readonly _tag: "Run"
  readonly flowPath: string
  readonly requirements: RequirementsInput
  readonly appPath?: string
  readonly appBundleId?: string
  readonly env: Record<string, string>
  readonly maxAttempts?: number
  readonly wait: boolean
}

export type ReserveCommand = {
  readonly _tag: "Reserve"
  readonly requirements: RequirementsInput
  readonly ttlSeconds: number
  readonly wait: boolean
}

export type ShotCommand = {
  readonly _tag: "Shot"
  readonly reservationId: string
  readonly token: string
  readonly outPath?: string
}

export type ExecCommand = {
  readonly _tag: "Exec"
  readonly reservationId: string
  readonly token: string
  readonly argv: readonly string[]
}

export type ExtendCommand = {
  readonly _tag: "Extend"
  readonly reservationId: string
  readonly token: string
  readonly ttlSeconds: number
}

export type ReleaseCommand = {
  readonly _tag: "Release"
  readonly reservationId: string
  readonly token: string
}

export type StatusCommand = {
  readonly _tag: "Status"
  readonly jobId: string
  readonly json: boolean
}

export type CancelCommand = {
  readonly _tag: "Cancel"
  readonly jobId: string
}

export type DocsCommand = {
  readonly _tag: "Docs"
}

export type CliCommand =
  | HelpCommand
  | DevicesCommand
  | RunCommand
  | ReserveCommand
  | ShotCommand
  | ExecCommand
  | ExtendCommand
  | ReleaseCommand
  | StatusCommand
  | CancelCommand
  | DocsCommand
