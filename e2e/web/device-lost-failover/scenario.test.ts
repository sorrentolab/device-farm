import { beforeEach, describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import {
  SeedClient,
  activeRun,
  deviceForRun,
  sortedRuns,
  waitForDeviceStatus,
  waitForJobDetail,
} from "../../setup/harness.js"

const seed = new SeedClient()
const client = seed.client

describe("device lost failover", () => {
  beforeEach(async () => {
    await Effect.runPromise(seed.resetFarm())
  })

  test("retries a lost iOS run on the other booted simulator and records both attempts", async () => {
    // Given two booted stub iOS simulators with long enough fake runs to disconnect mid-run.
    await Effect.runPromise(seed.configureRun("stub-ios-1", { durationMs: 6_000, exitCode: 0 }))
    await Effect.runPromise(seed.configureRun("stub-ios-2", { durationMs: 6_000, exitCode: 0 }))

    // When a job starts on whichever simulator the farm leases first.
    const job = await Effect.runPromise(
      client.submitJob({
        requirements: { platform: "ios", kind: "simulator", namePattern: "iPhone 16 Sim" },
        payload: {
          flowYaml: "appId: com.example.dfarm.e2e\n---\n- launchApp\n",
          env: {},
        },
        createdBy: "e2e-web-device-lost-failover",
        maxAttempts: 2,
      }),
    )
    const firstRunning = await waitForJobDetail(
      client,
      job.id,
      (detail) => detail.job.status === "running" && activeRun(detail)?.attempt === 1,
      { timeoutMs: 15_000, description: "first attempt to run" },
    )
    const firstRun = activeRun(firstRunning)
    expect(firstRun).toBeDefined()
    const lostDevice = await deviceForRun(client, firstRun!.deviceId)

    // When that simulator disconnects during the run.
    await Effect.runPromise(seed.stub({ type: "disconnect", udid: lostDevice.udid }))

    // Then attempt 1 is device_lost, attempt 2 passes on the other simulator, and the lost device is offline.
    const passed = await waitForJobDetail(
      client,
      job.id,
      (detail) =>
        detail.job.status === "passed" &&
        detail.runs.length === 2 &&
        detail.runs.some((run) => run.attempt === 1 && run.outcome === "device_lost") &&
        detail.runs.some((run) => run.attempt === 2 && run.outcome === "passed"),
      { timeoutMs: 30_000, description: "job to pass after failover" },
    )
    const [attempt1, attempt2] = sortedRuns(passed)
    expect(attempt1?.deviceId).not.toBe(attempt2?.deviceId)
    await waitForDeviceStatus(client, lostDevice.udid, "offline", { timeoutMs: 10_000 })
  })
})
