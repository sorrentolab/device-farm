import { ApiError } from "@dfarm/shared"
import { beforeEach, describe, expect, test } from "bun:test"
import * as Effect from "effect/Effect"
import { SeedClient, sortedRuns, waitForJobStatus } from "../../setup/harness.js"

const seed = new SeedClient()
const client = seed.client

const runPassedFlow = async (createdBy: string) => {
  await Effect.runPromise(seed.configureRun("stub-ios-1", { durationMs: 1_000, exitCode: 0 }))
  const submitted = await Effect.runPromise(
    client.submitJob({
      requirements: { platform: "ios", deviceUdid: "stub-ios-1" },
      payload: {
        flowYaml: "appId: com.example.dfarm.e2e\n---\n- launchApp\n",
        env: {},
      },
      createdBy,
      maxAttempts: 1,
    }),
  )
  const passed = await waitForJobStatus(client, submitted.id, "passed", { timeoutMs: 20_000 })
  const run = sortedRuns(passed)[0]
  if (!run) throw new Error("job passed without a run")
  return run
}

describe("artifact retention", () => {
  beforeEach(async () => {
    await Effect.runPromise(seed.resetFarm())
  })

  test("prunes artifacts of runs older than the retention window and the API 404s cleanly", async () => {
    // Given a finished run whose artifacts are downloadable.
    const run = await runPassedFlow("e2e-web-artifact-retention")
    const before = await Effect.runPromise(client.listRunArtifacts(run.id))
    expect(before.files.length).toBeGreaterThan(0)

    // When the retention pass runs with a zero-day window (everything finished is out of retention).
    const result = await Effect.runPromise(seed.pruneArtifacts(0))

    // Then the run's artifacts were pruned: the listing 404s and the run no longer advertises an artifacts dir.
    expect(result.pruned).toBeGreaterThanOrEqual(1)
    const listing = await Effect.runPromise(
      client.listRunArtifacts(run.id).pipe(
        Effect.map(() => "ok" as const),
        Effect.catchAll((error) =>
          Effect.succeed(error instanceof ApiError ? error.status : "unexpected"),
        ),
      ),
    )
    expect(listing).toBe(404)

    const detail = await Effect.runPromise(client.getJob(run.jobId))
    expect(sortedRuns(detail)[0]?.artifactsDir).toBeNull()
  })

  test("keeps artifacts of runs inside the retention window", async () => {
    // Given a run that finished moments ago.
    const run = await runPassedFlow("e2e-web-artifact-retention-keep")

    // When the retention pass runs with the default (multi-day) window.
    const result = await Effect.runPromise(seed.pruneArtifacts())

    // Then the fresh run's artifacts survive untouched.
    expect(result.pruned).toBe(0)
    const listing = await Effect.runPromise(client.listRunArtifacts(run.id))
    expect(listing.files.length).toBeGreaterThan(0)
    const detail = await Effect.runPromise(client.getJob(run.jobId))
    expect(sortedRuns(detail)[0]?.artifactsDir).toEqual(expect.any(String))
  })
})
