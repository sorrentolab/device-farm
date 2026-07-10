import { beforeEach, describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { mkdtemp, readdir, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  DfarmCli,
  SeedClient,
  extractJobIdFromCli,
  writeTempFlow,
} from "../../setup/harness.js"

const seed = new SeedClient()
const cli = new DfarmCli()

describe("dfarm run --record", () => {
  beforeEach(async () => {
    await Effect.runPromise(seed.resetFarm())
  })

  test("records the flow run and downloads the video with dfarm artifacts", async () => {
    // Given a farm with a booted stub iOS simulator and a fast passing run.
    await Effect.runPromise(seed.configureRun("stub-ios-1", { durationMs: 1_000, exitCode: 0 }))
    const flowPath = await writeTempFlow()

    // When a user runs dfarm run with --record.
    const run = await cli.run([
      "run",
      flowPath,
      "--record",
      "--device",
      "stub-ios-1",
      "--wait",
    ])

    // Then the run succeeds.
    expect(run.exitCode).toBe(0)

    // When the user downloads the run's artifacts.
    const jobId = extractJobIdFromCli(run)
    const outDir = await mkdtemp(join(tmpdir(), "dfarm-e2e-artifacts-"))
    const artifacts = await cli.run(["artifacts", jobId, "--out", outDir])

    // Then its recording, maestro log, and screenshot are downloaded.
    expect(artifacts.exitCode).toBe(0)
    expect((await stat(join(outDir, "recording.mp4"))).size).toBeGreaterThan(0)
    expect((await stat(join(outDir, "maestro.log"))).isFile()).toBe(true)
    expect((await stat(join(outDir, "screenshot.png"))).isFile()).toBe(true)
  })

  test("does not record when --record is not passed", async () => {
    // Given a farm with a booted stub iOS simulator and a fast passing run.
    await Effect.runPromise(seed.configureRun("stub-ios-1", { durationMs: 1_000, exitCode: 0 }))
    const flowPath = await writeTempFlow()

    // When a user runs dfarm run without --record.
    const run = await cli.run(["run", flowPath, "--device", "stub-ios-1", "--wait"])

    // Then the run succeeds.
    expect(run.exitCode).toBe(0)

    // When the user downloads the run's artifacts.
    const jobId = extractJobIdFromCli(run)
    const outDir = await mkdtemp(join(tmpdir(), "dfarm-e2e-artifacts-"))
    const artifacts = await cli.run(["artifacts", jobId, "--out", outDir])

    // Then artifact download succeeds without a video recording.
    expect(artifacts.exitCode).toBe(0)
    expect(await readdir(outDir)).not.toContain("recording.mp4")
  })
})
