import { beforeEach, describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import {
  SeedClient,
  activeRun,
  deviceForRun,
  sortedRuns,
  waitForJobDetail,
} from "../../setup/harness.js"

const seed = new SeedClient()
const client = seed.client

describe("run history retry timeline", () => {
  beforeEach(async () => {
    await Effect.runPromise(seed.resetFarm())
  })

  test("records two device_lost attempts before maxAttempts marks the job failed", async () => {
    // Given two matching iOS simulators and maxAttempts set to two.
    // The implementation excludes a lost device from later acquisition, so retry-cap exhaustion
    // is expressed by losing the first leased simulator and then the failover simulator.
    await Effect.runPromise(seed.configureRun("stub-ios-1", { durationMs: 6_000, exitCode: 0 }))
    await Effect.runPromise(seed.configureRun("stub-ios-2", { durationMs: 6_000, exitCode: 0 }))

    // When attempt 1 starts and its simulator disconnects.
    const job = await Effect.runPromise(
      client.submitJob({
        requirements: { platform: "ios", kind: "simulator", namePattern: "iPhone 16 Sim" },
        payload: {
          flowYaml: "appId: com.example.dfarm.e2e\n---\n- launchApp\n",
          env: {},
        },
        createdBy: "e2e-web-run-history-timeline",
        maxAttempts: 2,
      }),
    )
    const firstRunning = await waitForJobDetail(
      client,
      job.id,
      (detail) => detail.job.status === "running" && activeRun(detail)?.attempt === 1,
      { timeoutMs: 15_000, description: "attempt 1 to start" },
    )
    const firstRun = activeRun(firstRunning)
    expect(firstRun).toBeDefined()
    const firstDevice = await deviceForRun(client, firstRun!.deviceId)
    await Effect.runPromise(seed.stub({ type: "disconnect", udid: firstDevice.udid }))

    // When attempt 2 starts on the remaining simulator and that simulator also disconnects.
    const secondRunning = await waitForJobDetail(
      client,
      job.id,
      (detail) =>
        detail.job.status === "running" &&
        detail.runs.some((run) => run.attempt === 1 && run.outcome === "device_lost") &&
        activeRun(detail)?.attempt === 2,
      { timeoutMs: 30_000, description: "attempt 2 to start after first device loss" },
    )
    const secondRun = activeRun(secondRunning)
    expect(secondRun).toBeDefined()
    const secondDevice = await deviceForRun(client, secondRun!.deviceId)
    await Effect.runPromise(seed.stub({ type: "disconnect", udid: secondDevice.udid }))

    // Then the job fails with a complete two-attempt device_lost timeline.
    const failed = await waitForJobDetail(
      client,
      job.id,
      (detail) =>
        detail.job.status === "failed" &&
        detail.runs.length === 2 &&
        detail.runs.every((run) => run.outcome === "device_lost"),
      { timeoutMs: 30_000, description: "job to fail at retry cap" },
    )
    const [attempt1, attempt2] = sortedRuns(failed)
    expect(attempt1?.attempt).toBe(1)
    expect(attempt1?.outcome).toBe("device_lost")
    expect(attempt2?.attempt).toBe(2)
    expect(attempt2?.outcome).toBe("device_lost")
    expect(attempt1?.deviceId).not.toBe(attempt2?.deviceId)
  })
})
