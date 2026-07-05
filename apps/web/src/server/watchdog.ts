import { devices } from "@/db/schema"
import { getDb } from "@/server/db"
import { deviceRepo } from "@/server/device-repo"
import { handleDeviceLost } from "@/server/device-lost"
import { effectify } from "@/server/effect"
import { leaseService } from "@/server/lease-service"
import { and, lt, ne } from "drizzle-orm"
import * as Effect from "effect/Effect"

export const watchdogTick = () =>
  effectify(async () => {
    const cutoff = new Date(Date.now() - 60_000)
    const stale = await getDb()
      .select()
      .from(devices)
      .where(and(ne(devices.status, "offline"), lt(devices.lastHeartbeatAt, cutoff)))

    for (const device of stale) {
      await Effect.runPromise(handleDeviceLost(device.id, "device heartbeat is stale"))
    }

    await Effect.runPromise(leaseService.cleanupExpired())
    await Effect.runPromise(deviceRepo.retireStale())
  })
