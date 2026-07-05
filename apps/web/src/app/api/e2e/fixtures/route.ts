import { devices, jobs, runs } from "@/db/schema"
import { getDb } from "@/server/db"
import { noContent, notFound, runRoute } from "@/server/http"
import { Job, Run } from "@dfarm/shared"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const FixtureRequest = Schema.Struct({
  jobs: Schema.Array(Job),
  runs: Schema.Array(Run),
})

export async function POST(request: Request) {
  if (process.env.E2E_TEST_MODE !== "1") return notFound()
  return runRoute(
    Effect.tryPromise({
      try: () => request.json(),
      catch: () => new Error("invalid JSON body"),
    }).pipe(
      Effect.flatMap((body) => Schema.decodeUnknown(FixtureRequest)(body)),
      Effect.flatMap((fixture) =>
        Effect.tryPromise({
          try: async () => {
            const db = getDb()
            for (const job of fixture.jobs) {
              await db
                .insert(jobs)
                .values({
                  id: job.id,
                  type: job.type,
                  status: job.status,
                  requirements: job.requirements,
                  payload: job.payload,
                  createdBy: job.createdBy,
                  attempt: job.attempt,
                  maxAttempts: job.maxAttempts,
                  excludedDeviceIds: [],
                  createdAt: new Date(job.createdAt),
                  updatedAt: new Date(job.updatedAt),
                })
                .onConflictDoNothing()
            }
            for (const run of fixture.runs) {
              await db
                .insert(devices)
                .values({
                  id: run.deviceId,
                  udid: run.deviceId,
                  agentHost: "e2e-fixture",
                  agentUrl: "http://e2e-fixture.invalid",
                  platform: "ios",
                  kind: "simulator",
                  name: run.deviceName,
                  osVersion: "0",
                  status: "offline",
                  bootState: "shutdown",
                })
                .onConflictDoNothing()
              await db
                .insert(runs)
                .values({
                  id: run.id,
                  jobId: run.jobId,
                  attempt: run.attempt,
                  deviceId: run.deviceId,
                  outcome: run.outcome,
                  exitCode: run.exitCode,
                  artifactsDir: run.artifactsDir,
                  errorMessage: run.errorMessage,
                  startedAt: new Date(run.startedAt),
                  finishedAt: run.finishedAt ? new Date(run.finishedAt) : null,
                })
                .onConflictDoNothing()
            }
            return noContent()
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
      ),
    ),
  )
}
