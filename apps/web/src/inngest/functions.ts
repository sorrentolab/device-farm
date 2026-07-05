import { agentClient } from "@/server/agent-client"
import { deviceRepo } from "@/server/device-repo"
import { jobRepo } from "@/server/job-repo"
import { leaseService } from "@/server/lease-service"
import type { JobRow } from "@/server/mappers"
import { runRepo } from "@/server/run-repo"
import { watchdogTick } from "@/server/watchdog"
import { inngest } from "@/inngest/client"
import { NoDeviceAvailableError, type RunFlowPayload } from "@dfarm/shared"
import * as Effect from "effect/Effect"

const run = <A, E>(program: Effect.Effect<A, E>) => Effect.runPromise(program)

type AcquireStepResult =
  | {
      ok: true
      leaseId: string
      deviceId: string
      target: {
        agentHost: string
        agentUrl: string
        udid: string
        platform: "ios" | "android"
        kind: "simulator" | "emulator" | "physical"
      }
    }
  | { ok: false; bootableCandidateUdid?: string }

const acquireForJob = async (job: JobRow, ttlSeconds: number): Promise<AcquireStepResult> => {
  try {
    const acquired = await run(
      leaseService.acquire({
        requirements: job.requirements ?? {},
        kind: job.type === "reserve" ? "interactive" : "job",
        ttlSeconds,
        jobId: job.id,
        excludeDeviceIds: job.excludedDeviceIds ?? [],
      }),
    )
    return {
      ok: true,
      leaseId: acquired.lease.id,
      deviceId: acquired.device.id,
      target: {
        agentHost: acquired.deviceRow.agentHost,
        agentUrl: acquired.deviceRow.agentUrl,
        udid: acquired.deviceRow.udid,
        platform: acquired.deviceRow.platform as "ios" | "android",
        kind: acquired.deviceRow.kind as "simulator" | "emulator" | "physical",
      },
    }
  } catch (error) {
    if (error instanceof NoDeviceAvailableError) {
      return { ok: false, bootableCandidateUdid: error.bootableCandidateUdid }
    }
    throw error
  }
}

const bootByUdid = async (udid: string) => {
  const row = await run(deviceRepo.getByUdid(udid))
  if (!row) throw new Error(`bootable device not found: ${udid}`)
  await run(
    agentClient.boot({
      agentHost: row.agentHost,
      agentUrl: row.agentUrl,
      udid: row.udid,
      platform: row.platform as "ios" | "android",
      kind: row.kind as "simulator" | "emulator" | "physical",
    }),
  )
  await run(deviceRepo.markBootedByUdid(udid))
}

export const runFlowJob = inngest.createFunction(
  { id: "job.run-flow", triggers: [{ event: "job/created" }] },
  async ({ event, step }: any) => {
    const jobId = event.data.jobId as string
    let round = 0

    while (true) {
      const job = await step.run(`load-${round}`, () => run(jobRepo.getRaw(jobId)))
      if (!job || job.type !== "run_flow") return { ignored: true }
      if (["passed", "failed", "canceled"].includes(job.status)) return { status: job.status }

      const attempt = job.attempt + 1
      if (attempt > job.maxAttempts) {
        await step.run(`max-attempts-${round}`, () => run(jobRepo.setStatus(jobId, "failed")))
        return { status: "failed" }
      }

      const acquired = await step.run(`acquire-${attempt}-${round}`, () => acquireForJob(job, 3600))
      if (!acquired.ok) {
        if (acquired.bootableCandidateUdid) {
          await step.run(`boot-${attempt}-${round}`, () => bootByUdid(acquired.bootableCandidateUdid!))
        } else {
          await step.waitForEvent(`wait-device-${attempt}-${round}`, {
            event: "device/released",
            timeout: "10m",
          })
        }
        round += 1
        continue
      }

      await step.run(`assign-${attempt}`, () => run(jobRepo.setStatus(jobId, "assigned")))
      const createdRun = await step.run(`create-run-${attempt}`, () =>
        run(runRepo.create({ jobId, attempt, deviceId: acquired.deviceId })),
      )
      await step.run(`running-${attempt}`, () => run(jobRepo.setStatus(jobId, "running")))
      await step.run(`execute-${attempt}`, () =>
        run(agentClient.run(acquired.target, createdRun.id, job.payload as RunFlowPayload)),
      )

      const finished = await step.waitForEvent(`wait-run-${attempt}`, {
        event: "run/finished",
        if: `async.data.runId == "${createdRun.id}"`,
        timeout: "30m",
      })

      const data = finished?.data ?? {
        runId: createdRun.id,
        outcome: "device_lost",
        exitCode: null,
        artifactsDir: null,
        errorMessage: "run timed out",
      }
      const outcome =
        data.outcome ?? (typeof data.exitCode === "number" && data.exitCode === 0 ? "passed" : "failed")

      await step.run(`finalize-${attempt}`, () =>
        run(
          runRepo.finalize({
            runId: createdRun.id,
            outcome,
            exitCode: data.exitCode ?? null,
            artifactsDir: data.artifactsDir ?? null,
            errorMessage: data.errorMessage ?? null,
          }),
        ),
      )
      await step.run(`release-${attempt}`, () => run(leaseService.release(acquired.leaseId)))

      if (outcome === "canceled") {
        // Cancel already finalized the run, released the lease, and set the job
        // status; nothing left to do here.
        return { status: "canceled" }
      }

      if (outcome === "device_lost") {
        const excluded = [...new Set([...(job.excludedDeviceIds ?? []), acquired.deviceId])]
        await step.run(`exclude-${attempt}`, () =>
          run(jobRepo.setAttemptAndExcluded(jobId, attempt, excluded)),
        )
        if (attempt >= job.maxAttempts) {
          await step.run(`fail-${attempt}`, () => run(jobRepo.setStatus(jobId, "failed")))
          return { status: "failed" }
        }
        // requeueUnlessTerminal: a cancel racing this path must win.
        await step.run(`requeue-${attempt}`, () => run(jobRepo.requeueUnlessTerminal(jobId)))
        round += 1
        continue
      }

      await step.run(`complete-${attempt}`, () =>
        run(jobRepo.setStatus(jobId, outcome === "passed" ? "passed" : "failed")),
      )
      return { status: outcome }
    }
  },
)

export const reserveJob = inngest.createFunction(
  { id: "job.reserve", triggers: [{ event: "job/created" }] },
  async ({ event, step }: any) => {
    const jobId = event.data.jobId as string
    let round = 0

    while (true) {
      const job = await step.run(`load-reserve-${round}`, () => run(jobRepo.getRaw(jobId)))
      if (!job || job.type !== "reserve") return { ignored: true }
      if (["passed", "failed", "canceled"].includes(job.status)) return { status: job.status }
      const payload = job.payload as { ttlSeconds: number }
      const acquired = await step.run(`acquire-reserve-${round}`, () =>
        acquireForJob(job, payload.ttlSeconds),
      )
      if (!acquired.ok) {
        if (acquired.bootableCandidateUdid) {
          await step.run(`boot-reserve-${round}`, () => bootByUdid(acquired.bootableCandidateUdid!))
        } else {
          await step.waitForEvent(`wait-reserve-device-${round}`, {
            event: "device/released",
            timeout: "10m",
          })
        }
        round += 1
        continue
      }

      await step.run("reserve-running", () => run(jobRepo.setStatus(jobId, "running")))
      let leaseId = acquired.leaseId
      let sleepRound = 0
      while (true) {
        const lease = await step.run(`read-reserve-lease-${sleepRound}`, () => run(leaseService.get(leaseId)))
        if (!lease) {
          await step.run(`reserve-finished-${sleepRound}`, () =>
            run(jobRepo.completeReservation(jobId, "released")),
          )
          return { status: "released" }
        }
        await step.sleepUntil(`sleep-reserve-${sleepRound}`, lease.expiresAt)
        const reread = await step.run(`reread-reserve-lease-${sleepRound}`, () =>
          run(leaseService.get(leaseId)),
        )
        if (reread && new Date(reread.expiresAt).getTime() > Date.now()) {
          sleepRound += 1
          continue
        }
        if (reread) await step.run(`release-expired-reserve-${sleepRound}`, () => run(leaseService.release(reread.id)))
        await step.run(`expire-reserve-${sleepRound}`, () => run(jobRepo.completeReservation(jobId, "expired")))
        return { status: "expired" }
      }
    }
  },
)

export const watchdog = inngest.createFunction(
  { id: "watchdog", triggers: [{ cron: "* * * * *" }] },
  async ({ step }: any) => {
    await step.run("watchdog-tick", () => run(watchdogTick()))
  },
)

export const functions = [runFlowJob, reserveJob, watchdog]
