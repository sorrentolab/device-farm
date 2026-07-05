import { noContent, runRoute } from "@/server/http"
import { jobRepo } from "@/server/job-repo"
import { leaseService } from "@/server/lease-service"
import { LeaseExpiredError } from "@dfarm/shared"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context) {
  const { id } = await context.params
  const token = new URL(request.url).searchParams.get("token")
  return runRoute(
    (token ? leaseService.validateReservationLease(id, token) : Effect.fail(new LeaseExpiredError({ leaseId: id }))).pipe(
      Effect.flatMap(({ lease }) => leaseService.release(lease.id)),
      Effect.flatMap(() => jobRepo.completeReservation(id, "released")),
      Effect.as(noContent()),
    ),
  )
}
