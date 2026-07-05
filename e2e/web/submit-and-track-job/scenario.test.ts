import { beforeEach, describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import {
  SeedClient,
  collectJobLogLines,
  sortedRuns,
  waitForJobStatus,
} from "../../setup/harness.js"

const seed = new SeedClient()
const client = seed.client

describe("REST job submission and tracking", () => {
  beforeEach(async () => {
    await Effect.runPromise(seed.resetFarm())
  })

  test("submits a flow, observes queued to running to passed, and exposes logs and artifacts", async () => {
    // Given a stub simulator configured to run long enough for the running state to be visible.
    await Effect.runPromise(seed.configureRun("stub-ios-1", { durationMs: 3_000, exitCode: 0 }))

    // When a REST client submits a flow job.
    const submitted = await Effect.runPromise(
      client.submitJob({
        requirements: { platform: "ios", deviceUdid: "stub-ios-1" },
        payload: {
          flowYaml: "appId: com.example.dfarm.e2e\n---\n- launchApp\n",
          env: {},
        },
        createdBy: "e2e-web-submit-and-track-job",
        maxAttempts: 1,
      }),
    )

    // Then the job is first queued, then running, then passed.
    expect(submitted.status).toBe("queued")
    await waitForJobStatus(client, submitted.id, "running", { timeoutMs: 15_000 })
    const passed = await waitForJobStatus(client, submitted.id, "passed", { timeoutMs: 20_000 })

    // Then the SSE log tail returns the user-visible run logs, and the run has artifacts.
    const logs = await Effect.runPromise(collectJobLogLines(client, submitted.id))
    expect(logs.some((line) => line.includes("maestro: starting run"))).toBe(true)
    expect(logs.some((line) => line.includes("maestro: flow passed"))).toBe(true)

    const run = sortedRuns(passed)[0]
    expect(run?.outcome).toBe("passed")
    expect(run?.artifactsDir).toEqual(expect.any(String))
    expect(run?.artifactsDir?.length).toBeGreaterThan(0)
  })
})
