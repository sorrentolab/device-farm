import { agentClient } from "@/server/agent-client"
import { decodeJsonBody, runJson } from "@/server/http"
import { leaseService } from "@/server/lease-service"
import { ExecRequest, LeaseExpiredError } from "@dfarm/shared"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function POST(request: Request, context: Context) {
  const { id } = await context.params
  const token = new URL(request.url).searchParams.get("token")
  return runJson(
    decodeJsonBody(ExecRequest, request).pipe(
      Effect.flatMap((body) =>
        token
          ? leaseService
              .validateReservationLease(id, token)
              .pipe(
                Effect.flatMap(({ device }) =>
                  agentClient.exec(
                    {
                      agentHost: device.agentHost,
                      agentUrl: device.agentUrl,
                      udid: device.udid,
                      platform: device.platform as "ios" | "android",
                      kind: device.kind as "simulator" | "emulator" | "physical",
                    },
                    body.argv,
                  ),
                ),
              )
          : Effect.fail(new LeaseExpiredError({ leaseId: id })),
      ),
    ),
  )
}
