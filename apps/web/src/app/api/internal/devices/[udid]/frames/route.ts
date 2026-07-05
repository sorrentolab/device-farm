import { deviceRepo } from "@/server/device-repo"
import { noContent, notFound, runRoute } from "@/server/http"
import { realtimeHub } from "@/server/realtime"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ udid: string }> }

export async function POST(request: Request, context: Context) {
  const { udid } = await context.params
  const agentHost = request.headers.get("x-dfarm-agent-host")
  return runRoute(
    (agentHost ? deviceRepo.getByAgentUdid(agentHost, udid) : Effect.succeed(null)).pipe(
      Effect.flatMap((device) => {
        if (!device) return Effect.succeed(notFound())
        return Effect.tryPromise({
          try: async () => {
            const bytes = new Uint8Array(await request.arrayBuffer())
            realtimeHub.storeFrame(device.id, bytes, request.headers.get("content-type") ?? "image/jpeg")
            return noContent()
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
      }),
    ),
  )
}
