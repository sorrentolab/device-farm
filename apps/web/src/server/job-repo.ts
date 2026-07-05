import { devices, jobs, leases } from "@/db/schema"
import { getDb } from "@/server/db"
import { effectify } from "@/server/effect"
import { mapDevice, mapJob, type JobRow, type LeaseRow } from "@/server/mappers"
import { realtimeHub } from "@/server/realtime"
import { runRepo } from "@/server/run-repo"
import type {
  Job,
  JobDetail,
  JobStatus,
  JobSubmitRequest,
  Reservation,
  ReservationCreateRequest,
  ReservePayload,
  RunFlowPayload,
} from "@dfarm/shared"
import { and, desc, eq, gt } from "drizzle-orm"
import * as Effect from "effect/Effect"

type ReservationEndedReason = "released" | "expired"

const reservationEndedReason = (row: JobRow): ReservationEndedReason | null => {
  const payload = row.payload as ReservePayload & { _reservationStatus?: ReservationEndedReason }
  return payload._reservationStatus ?? null
}

const reservationStatus = (row: JobRow, lease: LeaseRow | null): Reservation["status"] => {
  if (row.status === "canceled") return "canceled"
  if (lease && lease.expiresAt.getTime() > Date.now()) return "active"
  if (lease) return "expired"
  if (row.status === "passed") return reservationEndedReason(row) ?? "released"
  if (row.status === "failed") return "expired"
  return "queued"
}

export const jobRepo = {
  createRunFlow: (request: JobSubmitRequest) =>
    effectify(async () => {
      const [row] = await getDb()
        .insert(jobs)
        .values({
          type: "run_flow",
          status: "queued",
          requirements: request.requirements ?? {},
          payload: request.payload as RunFlowPayload,
          createdBy: request.createdBy,
          maxAttempts: request.maxAttempts,
        })
        .returning()
      if (!row) throw new Error("failed to create job")
      const job = mapJob(row)
      return job
    }),

  createReservation: (request: ReservationCreateRequest) =>
    effectify(async () => {
      const [row] = await getDb()
        .insert(jobs)
        .values({
          type: "reserve",
          status: "queued",
          requirements: request.requirements ?? {},
          payload: { ttlSeconds: request.ttlSeconds },
          createdBy: request.createdBy,
          maxAttempts: 1,
        })
        .returning()
      if (!row) throw new Error("failed to create reservation job")
      return row
    }),

  getRaw: (id: string) =>
    effectify(async () => {
      const [row] = await getDb().select().from(jobs).where(eq(jobs.id, id)).limit(1)
      return row ?? null
    }),

  get: (id: string) =>
    effectify(async () => {
      const [row] = await getDb().select().from(jobs).where(eq(jobs.id, id)).limit(1)
      return row ? mapJob(row) : null
    }),

  list: (status?: string | null) =>
    effectify(async () => {
      const rows = await getDb()
        .select()
        .from(jobs)
        .where(status ? eq(jobs.status, status) : undefined)
        .orderBy(desc(jobs.createdAt))
      return rows.map(mapJob)
    }),

  detail: (id: string): Effect.Effect<JobDetail | null, Error> =>
    jobRepo.get(id).pipe(
      Effect.flatMap((job) => {
        if (!job) return Effect.succeed(null)
        return runRepo.listForJob(id).pipe(Effect.map((runs) => ({ job, runs })))
      }),
    ),

  updateStatus: (id: string, status: JobStatus) =>
    effectify(async () => {
      const [row] = await getDb()
        .update(jobs)
        .set({ status, updatedAt: new Date() })
        .where(eq(jobs.id, id))
        .returning()
      if (!row) throw new Error("job not found")
      const job = mapJob(row)
      return job
    }),

  publishUpdated: (job: Job) =>
    Effect.sync(() => {
      realtimeHub.publish({ type: "job.updated", job })
    }),

  setStatus: (id: string, status: JobStatus) =>
    jobRepo.updateStatus(id, status).pipe(
      Effect.tap((job) =>
        Effect.sync(() => {
          realtimeHub.publish({ type: "job.updated", job })
        }),
      ),
    ),

  setAttemptAndExcluded: (id: string, attempt: number, excludedDeviceIds: ReadonlyArray<string>) =>
    effectify(async () => {
      const [row] = await getDb()
        .update(jobs)
        .set({
          attempt,
          excludedDeviceIds: [...new Set(excludedDeviceIds)],
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, id))
        .returning()
      if (!row) throw new Error("job not found")
      const job = mapJob(row)
      realtimeHub.publish({ type: "job.updated", job })
      return row
    }),

  completeReservation: (jobId: string, reason: ReservationEndedReason) =>
    effectify(async () => {
      const [row] = await getDb().select().from(jobs).where(eq(jobs.id, jobId)).limit(1)
      if (!row) return null
      const payload = row.payload as ReservePayload
      const [updated] = await getDb()
        .update(jobs)
        .set({
          status: "passed",
          payload: { ttlSeconds: payload.ttlSeconds, _reservationStatus: reason } as any,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId))
        .returning()
      return updated ? mapJob(updated) : null
    }),

  toReservation: (jobId: string) =>
    effectify(async () => {
      const [job] = await getDb().select().from(jobs).where(eq(jobs.id, jobId)).limit(1)
      if (!job || job.type !== "reserve") return null
      const [liveLease] = await getDb()
        .select()
        .from(leases)
        .where(eq(leases.jobId, job.id))
        .limit(1)
      const [device] = liveLease
        ? await getDb().select().from(devices).where(eq(devices.id, liveLease.deviceId)).limit(1)
        : [undefined]
      return {
        id: job.id,
        jobId: job.id,
        status: reservationStatus(job, liveLease ?? null),
        device: device ? mapDevice(device, liveLease ?? null) : null,
        token: liveLease && liveLease.expiresAt.getTime() > Date.now() ? liveLease.token : null,
        expiresAt: liveLease ? liveLease.expiresAt.toISOString() : null,
        createdBy: job.createdBy,
      } satisfies Reservation
    }),

  findLiveLeaseForReservation: (jobId: string, token: string) =>
    effectify(async () => {
      const [lease] = await getDb()
        .select()
        .from(leases)
        .where(and(eq(leases.jobId, jobId), eq(leases.token, token), gt(leases.expiresAt, new Date())))
        .limit(1)
      if (!lease) return null
      const [device] = await getDb().select().from(devices).where(eq(devices.id, lease.deviceId)).limit(1)
      if (!device) return null
      return { lease, device }
    }),
}

export class JobRepo extends Effect.Service<JobRepo>()("JobRepo", {
  succeed: jobRepo,
}) {}
