import { devices, jobs, leases, runs } from "@/db/schema"
import { getDb } from "@/server/db"
import { effectify } from "@/server/effect"
import { mapDevice, mapJob, mapRun } from "@/server/mappers"
import { realtimeHub } from "@/server/realtime"
import { sendInngestEvent } from "@/server/events"
import { and, eq, gt, isNull } from "drizzle-orm"

export const handleDeviceLost = (deviceId: string, message: string) =>
  effectify(async () => {
    const db = getDb()
    const [device] = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1)
    if (!device) return

    const activeRuns = await db
      .select()
      .from(runs)
      .where(and(eq(runs.deviceId, deviceId), isNull(runs.outcome)))

    for (const run of activeRuns) {
      await sendInngestEvent("run/finished", {
        runId: run.id,
        outcome: "device_lost",
        exitCode: null,
        artifactsDir: null,
        errorMessage: message,
      })
    }

    const activeLeases = await db
      .select()
      .from(leases)
      .where(and(eq(leases.deviceId, deviceId), gt(leases.expiresAt, new Date())))

    for (const lease of activeLeases) {
      if (!lease.jobId) continue
      const [job] = await db.select().from(jobs).where(eq(jobs.id, lease.jobId)).limit(1)
      if (job?.type === "reserve") {
        const [updated] = await db
          .update(jobs)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(jobs.id, job.id))
          .returning()
        if (updated) realtimeHub.publish({ type: "job.updated", job: mapJob(updated) })
      }
    }

    await db.delete(leases).where(eq(leases.deviceId, deviceId))

    const [updatedDevice] = await db
      .update(devices)
      .set({ status: "offline", updatedAt: new Date() })
      .where(eq(devices.id, deviceId))
      .returning()

    if (updatedDevice) realtimeHub.publish({ type: "device.updated", device: mapDevice(updatedDevice) })

    for (const run of activeRuns) {
      const [updatedRun] = await db.select().from(runs).where(eq(runs.id, run.id)).limit(1)
      if (updatedRun) realtimeHub.publish({ type: "run.updated", run: mapRun(updatedRun, device.name) })
    }
  })
