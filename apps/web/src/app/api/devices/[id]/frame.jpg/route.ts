import { realtimeHub } from "@/server/realtime"
import { notFound } from "@/server/http"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params
  const frame = realtimeHub.getFrame(id)
  if (!frame) return notFound()
  return new Response(Buffer.from(frame.bytes), {
    headers: {
      "content-type": frame.contentType,
      "cache-control": "no-store",
    },
  })
}
