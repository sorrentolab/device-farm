import { devices, jobs, leases } from "@/db/schema"
import { getDb } from "@/server/db"
import { effectify } from "@/server/effect"
import { mapDevice, mapJob, mapLease, type DeviceRow } from "@/server/mappers"
import { realtimeHub } from "@/server/realtime"
import { sendInngestEvent } from "@/server/events"
import { addSeconds, compareDottedVersions, nameMatches, randomToken } from "@/server/util"
import { LeaseExpiredError, NoDeviceAvailableError, type DeviceRequirements, type LeaseKind } from "@dfarm/shared"
import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  ne,
  notExists,
  notInArray,
} from "drizzle-orm"
import * as Effect from "effect/Effect"

export type AcquireInput = {
  requirements: DeviceRequirements
  kind: LeaseKind
  ttlSeconds: number
  jobId?: string | null
  excludeDeviceIds?: ReadonlyArray<string>
}

export type AcquireResult = {
  lease: ReturnType<typeof mapLease>
  device: ReturnType<typeof mapDevice>
  deviceRow: DeviceRow
}

const matchesRequirements = (device: DeviceRow, requirements: DeviceRequirements): boolean => {
  if (requirements.platform && device.platform !== requirements.platform) return false
  if (requirements.kind && device.kind !== requirements.kind) return false
  if (requirements.deviceUdid && device.udid !== requirements.deviceUdid) return false
  if (requirements.osMin && compareDottedVersions(device.osVersion, requirements.osMin) < 0) return false
  if (requirements.osMax && compareDottedVersions(device.osVersion, requirements.osMax) > 0) return false
  if (!nameMatches(device.name, requirements.namePattern)) return false
  return true
}

const broadRequirementPredicates = (
  requirements: DeviceRequirements,
  excludeDeviceIds: ReadonlyArray<string>,
) => {
  const predicates = [
    eq(devices.status, "online"),
    notExists(
      getDb()
        .select()
        .from(leases)
        .where(and(eq(leases.deviceId, devices.id), gt(leases.expiresAt, new Date()))),
    ),
  ]
  if (requirements.platform) predicates.push(eq(devices.platform, requirements.platform))
  if (requirements.kind) predicates.push(eq(devices.kind, requirements.kind))
  if (requirements.deviceUdid) predicates.push(eq(devices.udid, requirements.deviceUdid))
  if (excludeDeviceIds.length > 0) predicates.push(notInArray(devices.id, [...excludeDeviceIds]))
  return predicates
}

const cleanupExpiredLeases = async () => {
  const now = new Date()
  const db = getDb()
  const expired = await db.select().from(leases).where(lte(leases.expiresAt, now))
  for (const lease of expired) {
    await db.delete(leases).where(eq(leases.id, lease.id))
    const [device] = await db.select().from(devices).where(eq(devices.id, lease.deviceId)).limit(1)
    if (device && device.status !== "offline") {
      const [updatedDevice] = await db
        .update(devices)
        .set({ status: "online", updatedAt: now })
        .where(eq(devices.id, device.id))
        .returning()
      if (updatedDevice) realtimeHub.publish({ type: "device.updated", device: mapDevice(updatedDevice) })
    }
    if (lease.jobId && lease.kind === "interactive") {
      const [job] = await db.select().from(jobs).where(eq(jobs.id, lease.jobId)).limit(1)
      if (job) {
        const payload = job.payload as { ttlSeconds: number }
        const [updatedJob] = await db
          .update(jobs)
          .set({
            status: "passed",
            payload: { ttlSeconds: payload.ttlSeconds, _reservationStatus: "expired" } as any,
            updatedAt: now,
          })
          .where(eq(jobs.id, job.id))
          .returning()
        if (updatedJob) realtimeHub.publish({ type: "job.updated", job: mapJob(updatedJob) })
      }
    }
  }
}

export const leaseService = {
  get: (leaseId: string) =>
    effectify(async () => {
      const [lease] = await getDb().select().from(leases).where(eq(leases.id, leaseId)).limit(1)
      return lease ? mapLease(lease) : null
    }),

  acquire: (input: AcquireInput): Effect.Effect<AcquireResult, NoDeviceAvailableError | Error> =>
    Effect.tryPromise({
      try: async () => {
        const now = new Date()
        const db = getDb()
        const excludeDeviceIds = input.excludeDeviceIds ?? []
        await cleanupExpiredLeases()

        return db.transaction(async (tx) => {
          const predicates = broadRequirementPredicates(input.requirements, excludeDeviceIds)
          const candidateRows = await tx
            .select()
            .from(devices)
            .where(and(...predicates, eq(devices.bootState, "booted")))
            .orderBy(asc(devices.updatedAt))
            .limit(50)
            .for("update", { skipLocked: true })

          const candidate = candidateRows.find((device) => matchesRequirements(device, input.requirements))

          if (!candidate) {
            const bootableRows = await tx
              .select()
              .from(devices)
              .where(
                and(
                  ...predicates,
                  eq(devices.bootState, "shutdown"),
                  input.requirements.kind
                    ? eq(devices.kind, input.requirements.kind)
                    : inArray(devices.kind, ["simulator", "emulator"]),
                ),
              )
              .orderBy(asc(devices.updatedAt))
              .limit(20)
            const bootable = bootableRows.find((device) =>
              matchesRequirements(device, input.requirements),
            )
            // Distinguish "nothing matches right now" from "nothing will EVER
            // match": if no registered (non-retired) device fits the
            // requirements regardless of status, waiting is pointless and the
            // job should fail fast instead of sitting queued forever.
            let noMatchingDevice = false
            if (!bootable) {
              const registered = await tx
                .select()
                .from(devices)
                .where(and(isNull(devices.retiredAt), ...(excludeDeviceIds.length > 0 ? [notInArray(devices.id, [...excludeDeviceIds])] : [])))
              noMatchingDevice = !registered.some((device) =>
                matchesRequirements(device, input.requirements),
              )
            }
            throw new NoDeviceAvailableError({
              requirements: input.requirements,
              bootableCandidateUdid: bootable?.udid,
              noMatchingDevice,
            })
          }

          const [lease] = await tx
            .insert(leases)
            .values({
              deviceId: candidate.id,
              jobId: input.jobId ?? null,
              kind: input.kind,
              token: randomToken(),
              expiresAt: addSeconds(now, input.ttlSeconds),
            })
            .returning()
          if (!lease) throw new Error("failed to create lease")

          const [updatedDevice] = await tx
            .update(devices)
            .set({ status: "busy", updatedAt: now })
            .where(eq(devices.id, candidate.id))
            .returning()
          if (!updatedDevice) throw new Error("failed to update leased device")

          const device = mapDevice(updatedDevice, lease)
          realtimeHub.publish({ type: "device.updated", device })
          return {
            lease: mapLease(lease),
            device,
            deviceRow: updatedDevice,
          }
        })
      },
      catch: (error) =>
        error instanceof NoDeviceAvailableError
          ? error
          : error instanceof Error
            ? error
            : new Error(String(error)),
    }),

  release: (leaseId: string) =>
    effectify(async () => {
      const db = getDb()
      const [lease] = await db.select().from(leases).where(eq(leases.id, leaseId)).limit(1)
      if (!lease) return null
      const [device] = await db.select().from(devices).where(eq(devices.id, lease.deviceId)).limit(1)
      await db.delete(leases).where(eq(leases.id, leaseId))
      if (device) {
        const [updated] = await db
          .update(devices)
          .set({ status: device.status === "offline" ? "offline" : "online", updatedAt: new Date() })
          .where(eq(devices.id, device.id))
          .returning()
        if (updated) realtimeHub.publish({ type: "device.updated", device: mapDevice(updated) })
      }
      await sendInngestEvent("device/released", { leaseId, deviceId: lease.deviceId, jobId: lease.jobId })
      return mapLease(lease)
    }),

  validateReservationLease: (jobId: string, token: string) =>
    Effect.tryPromise({
      try: async () => {
        const [lease] = await getDb()
          .select()
          .from(leases)
          .where(and(eq(leases.jobId, jobId), eq(leases.token, token), gt(leases.expiresAt, new Date())))
          .limit(1)
        if (!lease) throw new LeaseExpiredError({ leaseId: jobId })
        const [device] = await getDb().select().from(devices).where(eq(devices.id, lease.deviceId)).limit(1)
        if (!device) throw new LeaseExpiredError({ leaseId: jobId })
        return { lease, device }
      },
      catch: (error) =>
        error instanceof LeaseExpiredError
          ? error
          : error instanceof Error
            ? error
            : new Error(String(error)),
    }),

  extendReservation: (jobId: string, token: string, ttlSeconds: number) =>
    leaseService.validateReservationLease(jobId, token).pipe(
      Effect.flatMap(({ lease }) =>
        effectify(async () => {
          const [updated] = await getDb()
            .update(leases)
            .set({ expiresAt: addSeconds(new Date(), ttlSeconds) })
            .where(eq(leases.id, lease.id))
            .returning()
          if (!updated) throw new LeaseExpiredError({ leaseId: jobId })
          return mapLease(updated)
        }),
      ),
    ),

  cleanupExpired: () => effectify(cleanupExpiredLeases),
}

export class LeaseService extends Effect.Service<LeaseService>()("LeaseService", {
  succeed: leaseService,
}) {}
