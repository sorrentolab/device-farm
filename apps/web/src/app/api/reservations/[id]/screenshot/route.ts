import { agentClient } from "@/server/agent-client"
import { LeaseExpiredError } from "@dfarm/shared"
import { leaseService } from "@/server/lease-service"
import { runRoute } from "@/server/http"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  const token = new URL(request.url).searchParams.get("token")
  return runRoute(
    (token ? leaseService.validateReservationLease(id, token) : Effect.fail(new LeaseExpiredError({ leaseId: id }))).pipe(
      Effect.flatMap(({ device }) =>
        agentClient.screenshot({
          agentHost: device.agentHost,
          agentUrl: device.agentUrl,
          udid: device.udid,
          platform: device.platform as "ios" | "android",
          kind: device.kind as "simulator" | "emulator" | "physical",
        }),
      ),
      Effect.map(
        (image) =>
          new Response(image.bytes, {
            headers: {
              "content-type": image.contentType,
              "cache-control": "no-store",
            },
          }),
      ),
    ),
  )
}
