import { devices, jobs, leases } from "@/db/schema"
import { getDb } from "@/server/db"
import { handleDeviceLost } from "@/server/device-lost"
import { effectify } from "@/server/effect"
import { mapDevice } from "@/server/mappers"
import { realtimeHub } from "@/server/realtime"
import type { AgentReport, AgentReportResponse, Device } from "@dfarm/shared"
import { and, asc, eq, gt, ne, notInArray } from "drizzle-orm"
import * as Effect from "effect/Effect"

const activeLeasePredicate = () => gt(leases.expiresAt, new Date())

const refreshDeviceStatus = async (deviceId: string) => {
  const db = getDb()
  const [activeLease] = await db
    .select()
    .from(leases)
    .where(and(eq(leases.deviceId, deviceId), activeLeasePredicate()))
    .limit(1)
  const [device] = await db.select().from(devices).where(eq(devices.id, deviceId)).limit(1)
  if (!device) return null
  const status = device.status === "offline" ? "offline" : activeLease ? "busy" : "online"
  const [updated] = await db
    .update(devices)
    .set({ status, updatedAt: new Date() })
    .where(eq(devices.id, deviceId))
    .returning()
  return updated ? mapDevice(updated, activeLease ?? null) : null
}

export const deviceRepo = {
  list: () =>
    effectify(async () => {
      const rows = await getDb()
        .select({ device: devices, lease: leases })
        .from(devices)
        .leftJoin(leases, and(eq(leases.deviceId, devices.id), activeLeasePredicate()))
        .orderBy(asc(devices.platform), asc(devices.name), asc(devices.udid))
      return rows.map((row) => mapDevice(row.device, row.lease))
    }),

  get: (id: string) =>
    effectify(async () => {
      const [row] = await getDb()
        .select({ device: devices, lease: leases })
        .from(devices)
        .leftJoin(leases, and(eq(leases.deviceId, devices.id), activeLeasePredicate()))
        .where(eq(devices.id, id))
        .limit(1)
      return row ? mapDevice(row.device, row.lease) : null
    }),

  getRow: (id: string) =>
    effectify(async () => {
      const [row] = await getDb().select().from(devices).where(eq(devices.id, id)).limit(1)
      return row ?? null
    }),

  getByAgentUdid: (agentHost: string, udid: string) =>
    effectify(async () => {
      const [row] = await getDb()
        .select()
        .from(devices)
        .where(and(eq(devices.agentHost, agentHost), eq(devices.udid, udid)))
        .limit(1)
      return row ?? null
    }),

  getRawById: (id: string) =>
    effectify(async () => {
      const [row] = await getDb().select().from(devices).where(eq(devices.id, id)).limit(1)
      return row ?? null
    }),

  getByUdid: (udid: string) =>
    effectify(async () => {
      const [row] = await getDb().select().from(devices).where(eq(devices.udid, udid)).limit(1)
      return row ?? null
    }),

  markBootedByUdid: (udid: string) =>
    effectify(async () => {
      const [row] = await getDb()
        .update(devices)
        .set({ bootState: "booted", status: "online", updatedAt: new Date() })
        .where(and(eq(devices.udid, udid), ne(devices.status, "offline")))
        .returning()
      if (!row) return null
      const device = mapDevice(row)
      realtimeHub.publish({ type: "device.updated", device })
      return row
    }),

  setWatched: (id: string, watched: boolean) =>
    effectify(async () => {
      const [row] = await getDb()
        .update(devices)
        .set({ watched, updatedAt: new Date() })
        .where(eq(devices.id, id))
        .returning()
      if (!row) return null
      const device = await refreshDeviceStatus(row.id)
      if (device) realtimeHub.publish({ type: "device.updated", device })
      return device
    }),

  report: (report: AgentReport): Effect.Effect<AgentReportResponse, Error> =>
    effectify(async () => {
      const now = new Date()
      const db = getDb()
      const seenUdids = report.devices.map((device) => device.udid)
      const missingDevices = await db.transaction(async (tx) => {
        for (const discovered of report.devices) {
          const [row] = await tx
            .insert(devices)
            .values({
              udid: discovered.udid,
              agentHost: report.agentHost,
              agentUrl: report.agentUrl,
              platform: discovered.platform,
              kind: discovered.kind,
              name: discovered.name,
              osVersion: discovered.osVersion,
              bootState: discovered.bootState,
              status: "online",
              lastHeartbeatAt: now,
              updatedAt: now,
            })
            .onConflictDoUpdate({
              target: [devices.agentHost, devices.udid],
              set: {
                agentUrl: report.agentUrl,
                platform: discovered.platform,
                kind: discovered.kind,
                name: discovered.name,
                osVersion: discovered.osVersion,
                bootState: discovered.bootState,
                status: "online",
                lastHeartbeatAt: now,
                updatedAt: now,
              },
            })
            .returning()
          if (row) {
            const [activeLease] = await tx
              .select()
              .from(leases)
              .where(and(eq(leases.deviceId, row.id), gt(leases.expiresAt, now)))
              .limit(1)
            const [updated] = await tx
              .update(devices)
              .set({ status: activeLease ? "busy" : "online", updatedAt: now })
              .where(eq(devices.id, row.id))
              .returning()
            if (updated) realtimeHub.publish({ type: "device.updated", device: mapDevice(updated, activeLease ?? null) })
          }
        }

        const missingWhere =
          seenUdids.length > 0
            ? and(
                eq(devices.agentHost, report.agentHost),
                ne(devices.status, "offline"),
                notInArray(devices.udid, seenUdids),
              )
            : and(eq(devices.agentHost, report.agentHost), ne(devices.status, "offline"))

        const missing = await tx.select().from(devices).where(missingWhere)
        for (const device of missing) {
          await tx
            .update(devices)
            .set({ status: "offline", updatedAt: now })
            .where(eq(devices.id, device.id))
        }
        return missing
      })

      for (const device of missingDevices) {
        await Effect.runPromise(handleDeviceLost(device.id, `device ${device.udid} disappeared from report`))
      }

      const watched = await db
        .select({ udid: devices.udid })
        .from(devices)
        .where(and(eq(devices.agentHost, report.agentHost), eq(devices.watched, true)))

      const activeRunLeases = await db
        .select({ udid: devices.udid })
        .from(leases)
        .innerJoin(devices, eq(leases.deviceId, devices.id))
        .innerJoin(jobs, eq(leases.jobId, jobs.id))
        .where(
          and(
            eq(devices.agentHost, report.agentHost),
            eq(jobs.type, "run_flow"),
            gt(leases.expiresAt, new Date()),
          ),
        )

      return {
        watchedUdids: [...new Set([...watched, ...activeRunLeases].map((row) => row.udid))],
      }
    }),

  listAgentUrls: () =>
    effectify(async () => {
      const rows = await getDb().selectDistinct({ agentUrl: devices.agentUrl }).from(devices)
      return rows.map((row) => row.agentUrl)
    }),

  markOnlineStatus: (deviceId: string) =>
    effectify(async () => {
      const device = await refreshDeviceStatus(deviceId)
      if (device) realtimeHub.publish({ type: "device.updated", device })
      return device
    }),
}

export type DeviceDto = Device

export class DeviceRepo extends Effect.Service<DeviceRepo>()("DeviceRepo", {
  succeed: deviceRepo,
}) {}
