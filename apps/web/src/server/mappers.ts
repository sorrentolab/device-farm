import type {
  Device,
  DeviceRequirements,
  Job,
  Lease,
  LeaseKind,
  Run,
  RunFlowPayload,
  ReservePayload,
} from "@dfarm/shared"
import type { devices, jobs, leases, runs } from "@/db/schema"

export type DeviceRow = typeof devices.$inferSelect
export type JobRow = typeof jobs.$inferSelect
export type RunRow = typeof runs.$inferSelect
export type LeaseRow = typeof leases.$inferSelect

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null)
const isoRequired = (date: Date): string => date.toISOString()

export const mapDevice = (row: DeviceRow, lease?: LeaseRow | null): Device => ({
  id: row.id,
  udid: row.udid,
  platform: row.platform as Device["platform"],
  kind: row.kind as Device["kind"],
  name: row.name,
  osVersion: row.osVersion,
  status: row.status as Device["status"],
  bootState: row.bootState as Device["bootState"],
  agentHost: row.agentHost,
  watched: row.watched,
  lastHeartbeatAt: iso(row.lastHeartbeatAt),
  currentJobId: lease?.jobId ?? null,
  currentLeaseKind: (lease?.kind as LeaseKind | undefined) ?? null,
})

export const mapJob = (row: JobRow): Job => ({
  id: row.id,
  type: row.type as Job["type"],
  status: row.status as Job["status"],
  requirements: (row.requirements ?? {}) as DeviceRequirements,
  payload:
    row.type === "reserve"
      ? ({ ttlSeconds: (row.payload as ReservePayload).ttlSeconds } satisfies ReservePayload)
      : ({
          flowYaml: (row.payload as RunFlowPayload).flowYaml,
          appPath: (row.payload as RunFlowPayload).appPath,
          appBundleId: (row.payload as RunFlowPayload).appBundleId,
          env: (row.payload as RunFlowPayload).env ?? {},
        } satisfies RunFlowPayload),
  createdBy: row.createdBy,
  attempt: row.attempt,
  maxAttempts: row.maxAttempts,
  createdAt: isoRequired(row.createdAt),
  updatedAt: isoRequired(row.updatedAt),
})

export const mapRun = (row: RunRow, deviceName: string): Run => ({
  id: row.id,
  jobId: row.jobId,
  attempt: row.attempt,
  deviceId: row.deviceId,
  deviceName,
  outcome: (row.outcome as Run["outcome"]) ?? null,
  exitCode: row.exitCode,
  artifactsDir: row.artifactsDir,
  errorMessage: row.errorMessage,
  startedAt: isoRequired(row.startedAt),
  finishedAt: iso(row.finishedAt),
})

export const mapLease = (row: LeaseRow): Lease => ({
  id: row.id,
  deviceId: row.deviceId,
  jobId: row.jobId,
  kind: row.kind as Lease["kind"],
  token: row.token,
  expiresAt: isoRequired(row.expiresAt),
  createdAt: isoRequired(row.createdAt),
})
