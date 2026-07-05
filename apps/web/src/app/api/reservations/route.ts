import { sendInngestEvent } from "@/server/events"
import { decodeJsonBody, runJson } from "@/server/http"
import { jobRepo } from "@/server/job-repo"
import { mapJob } from "@/server/mappers"
import { realtimeHub } from "@/server/realtime"
import { ReservationCreateRequest } from "@dfarm/shared"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const sendJobCreated = (jobId: string) =>
  Effect.tryPromise({
    try: () => sendInngestEvent("job/created", { jobId, type: "reserve" }),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

export async function POST(request: Request) {
  return runJson(
    decodeJsonBody(ReservationCreateRequest, request).pipe(
      Effect.flatMap(jobRepo.createReservation),
      Effect.tap((row) =>
        Effect.sync(() => {
          realtimeHub.publish({ type: "job.updated", job: mapJob(row) })
        }),
      ),
      Effect.tap((row) => sendJobCreated(row.id)),
      Effect.flatMap((row) => jobRepo.toReservation(row.id)),
    ),
    { status: 201 },
  )
}
