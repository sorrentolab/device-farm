import { decodeJsonBody, runJson } from "@/server/http"
import { jobRepo } from "@/server/job-repo"
import { leaseService } from "@/server/lease-service"
import { ExtendRequest, LeaseExpiredError } from "@dfarm/shared"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context) {
  const { id } = await context.params
  const token = new URL(request.url).searchParams.get("token")
  return runJson(
    decodeJsonBody(ExtendRequest, request).pipe(
      Effect.flatMap((body) =>
        token
          ? leaseService.extendReservation(id, token, body.ttlSeconds)
          : Effect.fail(new LeaseExpiredError({ leaseId: id })),
      ),
      Effect.flatMap(() => jobRepo.toReservation(id)),
    ),
  )
}
