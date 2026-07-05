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
  const status = new URL(request.url).searchParams.get("status")
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
