import { jobRepo } from "@/server/job-repo"
import { runRepo } from "@/server/run-repo"
import { errorResponse, notFound } from "@/server/http"
import { realtimeHub } from "@/server/realtime"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ id: string }> }

const terminal = new Set(["passed", "failed", "canceled"])

export async function GET(request: Request, context: Context) {
  const { id } = await context.params
  try {
    const detail = await Effect.runPromise(jobRepo.detail(id))
    if (!detail) return notFound()

    const encoder = new TextEncoder()
    const runIds = new Set(detail.runs.map((run) => run.id))
    let unsubscribe: (() => void) | undefined
    let interval: ReturnType<typeof setInterval> | undefined
    let closed = false

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (chunk: string) => {
          if (!closed) controller.enqueue(encoder.encode(chunk))
        }
        const closeDone = () => {
          if (closed) return
          write("event: done\ndata: done\n\n")
          closed = true
          unsubscribe?.()
          if (interval) clearInterval(interval)
          controller.close()
        }

        const logs = await Effect.runPromise(runRepo.listLogsForRuns([...runIds]))
        for (const log of logs) {
          write(`data: ${log.line}\n\n`)
        }

        if (terminal.has(detail.job.status)) {
          closeDone()
          return
        }

        unsubscribe = realtimeHub.subscribe((message) => {
          if (message.type === "run.updated" && message.run.jobId === id) {
            runIds.add(message.run.id)
          }
          if (message.type === "run.log" && runIds.has(message.runId)) {
            write(`data: ${message.line}\n\n`)
          }
          if (message.type === "job.updated" && message.job.id === id && terminal.has(message.job.status)) {
            closeDone()
          }
        })

        interval = setInterval(() => {
          Effect.runPromise(jobRepo.get(id)).then((job) => {
            if (job && terminal.has(job.status)) closeDone()
          }, () => undefined)
        }, 2000)

        request.signal.addEventListener("abort", () => {
          if (closed) return
          closed = true
          unsubscribe?.()
          if (interval) clearInterval(interval)
          controller.close()
        })
      },
      cancel() {
        closed = true
        unsubscribe?.()
        if (interval) clearInterval(interval)
      },
    })

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store",
        connection: "keep-alive",
      },
    })
  } catch (error) {
    return errorResponse(error)
  }
}
