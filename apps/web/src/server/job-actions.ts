import { devices, leases, runs } from "@/db/schema"
import { agentClient } from "@/server/agent-client"
import { getDb } from "@/server/db"
import { effectify } from "@/server/effect"
import { sendInngestEvent } from "@/server/events"
import { jobRepo } from "@/server/job-repo"
import { leaseService } from "@/server/lease-service"
import { runRepo } from "@/server/run-repo"
import type { RunFlowPayload } from "@dfarm/shared"
import { and, eq, isNull } from "drizzle-orm"
import * as Effect from "effect/Effect"

export const jobActions = {
  cancel: (jobId: string) =>
    effectify(async () => {
      const db = getDb()
      const [activeRun] = await db
        .select()
        .from(runs)
        .where(and(eq(runs.jobId, jobId), isNull(runs.outcome)))
        .limit(1)
      const [activeLease] = await db.select().from(leases).where(eq(leases.jobId, jobId)).limit(1)
      if (activeRun) {
        const [device] = await db.select().from(devices).where(eq(devices.id, activeRun.deviceId)).limit(1)
        if (device) {
          await Effect.runPromise(
            agentClient
              .cancel(
                {
                  agentHost: device.agentHost,
                  agentUrl: device.agentUrl,
                  udid: device.udid,
                  platform: device.platform as "ios" | "android",
                  kind: device.kind as "simulator" | "emulator" | "physical",
                },
                activeRun.id,
              )
              .pipe(Effect.catchAll(() => Effect.void)),
          )
        }
        await Effect.runPromise(
          runRepo.finalize({
            runId: activeRun.id,
            outcome: "canceled",
            errorMessage: "job canceled",
          }),
        )
        // Wake the orchestrator's waitForEvent immediately instead of letting it
        // hit the 30m timeout and mistake the cancel for a lost device.
        await sendInngestEvent("run/finished", {
          runId: activeRun.id,
          outcome: "canceled",
          exitCode: null,
          artifactsDir: null,
          errorMessage: "job canceled",
        })
      }
      if (activeLease) {
        await Effect.runPromise(leaseService.release(activeLease.id).pipe(Effect.catchAll(() => Effect.void)))
      }
      await Effect.runPromise(jobRepo.setStatus(jobId, "canceled"))
    }),

  activeRunPayload: (jobId: string) =>
    effectify(async () => {
      const [run] = await getDb()
        .select()
        .from(runs)
        .where(and(eq(runs.jobId, jobId), isNull(runs.outcome)))
        .limit(1)
      if (!run) return null
      const [device] = await getDb().select().from(devices).where(eq(devices.id, run.deviceId)).limit(1)
      if (!device) return null
      return {
        runId: run.id,
        device,
        payload: null as RunFlowPayload | null,
      }
    }),
}
