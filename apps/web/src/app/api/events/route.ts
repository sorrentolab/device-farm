import { realtimeHub } from "@/server/realtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const encoder = new TextEncoder()
  let unsubscribe: (() => void) | undefined
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk))
      }
      write(": connected\n\n")
      unsubscribe = realtimeHub.subscribe((message) => {
        write(`data: ${JSON.stringify(message)}\n\n`)
      })
      request.signal.addEventListener("abort", () => {
        closed = true
        unsubscribe?.()
        controller.close()
      })
    },
    cancel() {
      closed = true
      unsubscribe?.()
    },
  })

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      connection: "keep-alive",
    },
  })
}
