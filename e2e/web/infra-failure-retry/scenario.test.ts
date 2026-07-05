import { beforeEach, describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { SeedClient, activeRun, waitForJobDetail } from "../../setup/harness.js"

const seed = new SeedClient()
const client = seed.client

describe("infra failure retry", () => {
  beforeEach(async () => {
    await Effect.runPromise(seed.resetFarm())
  })

  test("retries a run whose driver connection dropped, without excluding the device", async () => {
    // Given a booted stub iOS simulator whose first run will die with an
    // infra-level failure (dropped XCUITest driver connection), while the
    // second run is configured to succeed.
    await Effect.runPromise(
      seed.configureRun("stub-ios-1", { durationMs: 1_500, failureKind: "infra" }),
    )

    // When a flow is submitted pinned to that one simulator, so a retry can
    // only succeed if the device was NOT excluded after the infra failure.
    const job = await Effect.runPromise(
      client.submitJob({
        requirements: { deviceUdid: "stub-ios-1" },
        payload: { flowYaml: "appId: com.example.dfarm.e2e\n---\n- launchApp\n", env: {} },
        createdBy: "e2e-web-infra-failure-retry",
        maxAttempts: 3,
      }),
    )

    // Then attempt 1 ends as infra_failure and the farm automatically retries
    // on the same device, which passes.
    const passed = await waitForJobDetail(
      client,
      job.id,
      (detail) =>
        detail.job.status === "passed" &&
        detail.runs.some((run) => run.attempt === 1 && run.outcome === "infra_failure") &&
        detail.runs.some((run) => run.attempt === 2 && run.outcome === "passed"),
      { timeoutMs: 30_000, description: "job to pass after an infra-failure retry" },
    )

    const attempt1 = passed.runs.find((run) => run.attempt === 1)
    const attempt2 = passed.runs.find((run) => run.attempt === 2)
    expect(attempt1?.deviceId).toBe(attempt2!.deviceId)
    expect(activeRun(passed)).toBeUndefined()
  })
})
