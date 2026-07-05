import { sendInngestEvent } from "@/server/events"
import { decodeJsonBody, noContent, runRoute } from "@/server/http"
import { runRepo } from "@/server/run-repo"
import { RunEventBatch } from "@dfarm/shared"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Context = { params: Promise<{ runId: string }> }

const sendFinished = (data: Record<string, unknown>) =>
  Effect.tryPromise({
    try: () => sendInngestEvent("run/finished", data),
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

export async function POST(request: Request, context: Context) {
  const { runId } = await context.params
  return runRoute(
    decodeJsonBody(RunEventBatch, request).pipe(
      Effect.flatMap((batch) =>
        Effect.gen(function* () {
          if (batch.runId !== runId) throw new Error("run id mismatch")
          for (const event of batch.events) {
            if (event.type === "log") {
              yield* runRepo.appendLog(runId, event.line, new Date(event.at))
            }
            if (event.type === "exit") {
              yield* sendFinished({
                runId,
                outcome: event.exitCode === 0 ? "passed" : "failed",
                exitCode: event.exitCode,
                artifactsDir: event.artifactsDir,
              })
            }
            if (event.type === "device_lost") {
              yield* sendFinished({
                runId,
                outcome: "device_lost",
                exitCode: null,
                artifactsDir: null,
                errorMessage: event.message,
              })
            }
          }
        }),
      ),
      Effect.as(noContent()),
    ),
  )
}
