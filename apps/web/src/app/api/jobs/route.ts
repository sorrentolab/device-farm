import { jobRepo } from "@/server/job-repo"
import { sendInngestEvent } from "@/server/events"
import { decodeJsonBody, runJson } from "@/server/http"
import { JobSubmitRequest } from "@dfarm/shared"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const sendJobCreated = (jobId: string, type: string) =>
  Effect.tryPromise({
    try: () => sendInngestEvent("job/created", { jobId, type }),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  if (params.get("terminal") === "1") {
    const limit = Math.min(Math.max(Number(params.get("limit")) || 50, 1), 200)
    const offset = Math.max(Number(params.get("offset")) || 0, 0)
    return runJson(
      // Fetch one extra row so the client knows whether another page exists.
      jobRepo.listTerminal(limit + 1, offset).pipe(
        Effect.map((jobs) => ({
          jobs: jobs.slice(0, limit),
          hasMore: jobs.length > limit,
        })),
      ),
    )
  }
  if (params.get("active") === "1") {
    return runJson(jobRepo.listActive().pipe(Effect.map((jobs) => ({ jobs }))))
  }
  const status = params.get("status")
  return runJson(jobRepo.list(status).pipe(Effect.map((jobs) => ({ jobs }))))
}

export async function POST(request: Request) {
  return runJson(
    decodeJsonBody(JobSubmitRequest, request).pipe(
      Effect.flatMap(jobRepo.createRunFlow),
      Effect.tap(jobRepo.publishUpdated),
      Effect.tap((job) => sendJobCreated(job.id, job.type)),
    ),
    { status: 201 },
  )
}
