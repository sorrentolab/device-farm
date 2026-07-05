import { beforeEach, describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import {
  DfarmCli,
  SeedClient,
  activeRun,
  eventually,
  sortedRuns,
  waitForJob,
  waitForJobStatus,
  writeTempFlow,
} from "../../setup/harness.js"

const seed = new SeedClient()
const cli = new DfarmCli()
const client = seed.client

describe("dfarm run contention", () => {
  beforeEach(async () => {
    await Effect.runPromise(seed.resetFarm())
  })

  test("keeps a second run queued until the pinned simulator is released", async () => {
    // Given two users whose requirements pin both runs to the same booted simulator.
    await Effect.runPromise(seed.configureRun("stub-ios-1", { durationMs: 8_000, exitCode: 0 }))
    const firstFlow = await writeTempFlow()
    const secondFlow = await writeTempFlow()
    const firstClient = "e2e-queue-contention-first"
    const secondClient = "e2e-queue-contention-second"
    const first = cli.start(
      ["run", firstFlow, "--platform", "ios", "--device", "stub-ios-1", "--wait"],
      { env: { DFARM_CLIENT: firstClient } },
    )
    let second: ReturnType<DfarmCli["start"]> | undefined

    try {
      const firstJob = await waitForJob(
        client,
        (job) => job.createdBy === firstClient && job.status === "running",
        { timeoutMs: 15_000, description: "first pinned run to start" },
      )
      const firstRunning = await waitForJobStatus(client, firstJob.id, "running")
      expect(activeRun(firstRunning)?.attempt).toBe(1)

      // When another user submits the same pinned run while the first still owns the lease.
      second = cli.start(
        ["run", secondFlow, "--platform", "ios", "--device", "stub-ios-1", "--wait"],
        { env: { DFARM_CLIENT: secondClient } },
      )

      // Then the second job remains queued while the first job is running.
      const queued = await eventually(
        () =>
          client.listJobs().pipe(
            Effect.flatMap(({ jobs }) => {
              const currentFirst = jobs.find((job) => job.createdBy === firstClient)
              const currentSecond = jobs.find((job) => job.createdBy === secondClient)
              if (currentFirst?.status === "running" && currentSecond?.status === "queued") {
                return Effect.succeed({ first: currentFirst, second: currentSecond })
              }
              return Effect.fail(
                new Error(
                  `expected first running and second queued, got ${currentFirst?.status}/${currentSecond?.status}`,
                ),
              )
            }),
          ),
        { timeoutMs: 5_000, intervalMs: 200 },
      )

      const [firstResult, secondResult] = await Promise.all([first.result(), second.result()])
      expect(firstResult.exitCode).toBe(0)
      expect(secondResult.exitCode).toBe(0)

      // Then both jobs eventually pass, and the second run starts after the first finished.
      const firstPassed = await waitForJobStatus(client, queued.first.id, "passed")
      const secondPassed = await waitForJobStatus(client, queued.second.id, "passed")
      const firstRun = sortedRuns(firstPassed)[0]
      const secondRun = sortedRuns(secondPassed)[0]
      expect(firstRun?.outcome).toBe("passed")
      expect(secondRun?.outcome).toBe("passed")
      expect(firstRun?.finishedAt).not.toBeNull()
      expect(secondRun?.startedAt).toBeDefined()
      expect(new Date(secondRun!.startedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(firstRun!.finishedAt!).getTime(),
      )
    } finally {
      first.kill()
      second?.kill()
    }
  })
})
