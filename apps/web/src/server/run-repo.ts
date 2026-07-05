import { devices, runLogs, runs } from "@/db/schema"
import { getDb } from "@/server/db"
import { effectify } from "@/server/effect"
import { mapRun, type RunRow } from "@/server/mappers"
import { realtimeHub } from "@/server/realtime"
import type { Run, RunLogChunk, RunOutcome } from "@dfarm/shared"
import { and, asc, eq, inArray, isNull, max } from "drizzle-orm"
import * as Effect from "effect/Effect"

const runWithDeviceName = async (row: RunRow): Promise<Run> => {
  const [device] = await getDb().select().from(devices).where(eq(devices.id, row.deviceId)).limit(1)
  return mapRun(row, device?.name ?? row.deviceId)
}

export const runRepo = {
  create: (input: { jobId: string; attempt: number; deviceId: string }) =>
    effectify(async () => {
      const [row] = await getDb()
        .insert(runs)
        .values({
          jobId: input.jobId,
          attempt: input.attempt,
          deviceId: input.deviceId,
        })
        .returning()
      if (!row) throw new Error("failed to create run")
      const run = await runWithDeviceName(row)
      realtimeHub.publish({ type: "run.updated", run })
      return run
    }),

  get: (runId: string) =>
    effectify(async () => {
      const [row] = await getDb().select().from(runs).where(eq(runs.id, runId)).limit(1)
      if (!row) return null
      return runWithDeviceName(row)
    }),

  findActiveForJob: (jobId: string) =>
    effectify(async () => {
      const [row] = await getDb()
        .select()
        .from(runs)
        .where(and(eq(runs.jobId, jobId), isNull(runs.outcome)))
        .limit(1)
      return row ? runWithDeviceName(row) : null
    }),

  listForJob: (jobId: string) =>
    effectify(async () => {
      const rows = await getDb()
        .select()
        .from(runs)
        .where(eq(runs.jobId, jobId))
        .orderBy(asc(runs.attempt), asc(runs.startedAt))
      return Promise.all(rows.map(runWithDeviceName))
    }),

  listForJobs: (jobIds: ReadonlyArray<string>) =>
    effectify(async () => {
      if (jobIds.length === 0) return []
      const rows = await getDb().select().from(runs).where(inArray(runs.jobId, [...jobIds]))
      return Promise.all(rows.map(runWithDeviceName))
    }),

  appendLog: (runId: string, line: string, at: Date) =>
    effectify(async () => {
      const [last] = await getDb()
        .select({ seq: max(runLogs.seq) })
        .from(runLogs)
        .where(eq(runLogs.runId, runId))
      const seq = (last?.seq ?? 0) + 1
      await getDb().insert(runLogs).values({ runId, seq, line, at })
      realtimeHub.publish({ type: "run.log", runId, line })
      return { runId, seq, line, at: at.toISOString() } satisfies RunLogChunk
    }),

  listLogsForRuns: (runIds: ReadonlyArray<string>) =>
    effectify(async () => {
      if (runIds.length === 0) return []
      return getDb()
        .select()
        .from(runLogs)
        .where(inArray(runLogs.runId, [...runIds]))
        .orderBy(asc(runLogs.at), asc(runLogs.seq))
    }),

  finalize: (input: {
    runId: string
    outcome: RunOutcome
    exitCode?: number | null
    artifactsDir?: string | null
    errorMessage?: string | null
  }) =>
    effectify(async () => {
      const [row] = await getDb()
        .update(runs)
        .set({
          outcome: input.outcome,
          exitCode: input.exitCode ?? null,
          artifactsDir: input.artifactsDir ?? null,
          errorMessage: input.errorMessage ?? null,
          finishedAt: new Date(),
        })
        .where(eq(runs.id, input.runId))
        .returning()
      if (!row) throw new Error("run not found")
      const run = await runWithDeviceName(row)
      realtimeHub.publish({ type: "run.updated", run })
      return run
    }),
}

export class RunRepo extends Effect.Service<RunRepo>()("RunRepo", {
  succeed: runRepo,
}) {}
