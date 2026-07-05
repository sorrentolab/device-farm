import { beforeEach, describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { DfarmCli, SeedClient } from "../../setup/harness.js"

const seed = new SeedClient()
const client = seed.client
const cli = new DfarmCli()

describe("dfarm status --wait (resume a watch)", () => {
  beforeEach(async () => {
    await Effect.runPromise(seed.resetFarm())
  })

  test("attaches to a job submitted elsewhere, streams its log, and exits with the run's code", async () => {
    // Given a job someone submitted without waiting (or whose wait stream died).
    await Effect.runPromise(seed.configureRun("stub-ios-1", { durationMs: 2_000 }))
    const job = await Effect.runPromise(
      client.submitJob({
        requirements: { deviceUdid: "stub-ios-1" },
        payload: { flowYaml: "appId: com.example.dfarm.e2e\n---\n- launchApp\n", env: {} },
        createdBy: "e2e-cli-status-wait-resume",
      }),
    )

    // When the user resumes watching it with `dfarm status <id> --wait`.
    const result = await cli.run(["status", job.id, "--wait"])

    // Then the full log streams (replayed from the start) and the exit code is the run's.
    expect(result.stdout).toContain("maestro: flow passed")
    expect(result.stderr).toContain("attaching to log stream")
    expect(result.exitCode).toBe(0)
  })
})
