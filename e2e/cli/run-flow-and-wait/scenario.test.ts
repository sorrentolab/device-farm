import type { JobDetail } from "@dfarm/shared"
import { beforeEach, describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import {
  DfarmCli,
  SeedClient,
  extractJobIdFromCli,
  writeTempFlow,
} from "../../setup/harness.js"

const seed = new SeedClient()
const cli = new DfarmCli()

describe("dfarm run --wait", () => {
  beforeEach(async () => {
    await Effect.runPromise(seed.resetFarm())
  })

  test("streams a passing iOS flow and reports attempt 1 on the stub simulator", async () => {
    // Given a farm with a booted stub iOS simulator and a fast passing run.
    await Effect.runPromise(seed.configureRun("stub-ios-1", { durationMs: 1_000, exitCode: 0 }))
    const flowPath = await writeTempFlow()

    // When a user runs dfarm run with --wait for that iOS simulator.
    const run = await cli.run(
      ["run", flowPath, "--platform", "ios", "--device", "stub-ios-1", "--wait"],
      { env: { DFARM_CLIENT: "e2e-cli-run-flow-and-wait" } },
    )

    // Then the CLI streams log lines, exits successfully, and status shows attempt 1 passed.
    expect(run.exitCode).toBe(0)
    expect(run.stdout).toContain("maestro: starting run")
    expect(run.stdout).toContain("maestro: flow passed")

    const jobId = extractJobIdFromCli(run)
    const status = await cli.run(["status", jobId, "--json"])
    expect(status.exitCode).toBe(0)

    const detail = JSON.parse(status.stdout) as JobDetail
    expect(detail.job.status).toBe("passed")
    expect(detail.runs).toHaveLength(1)
    expect(detail.runs[0]?.attempt).toBe(1)
    expect(detail.runs[0]?.outcome).toBe("passed")
    expect(detail.runs[0]?.deviceName).toBe("iPhone 16 Sim")
  })
})
