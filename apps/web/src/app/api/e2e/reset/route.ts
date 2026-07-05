import { getSql } from "@/server/db"
import { noContent, notFound, runRoute } from "@/server/http"
import { realtimeHub } from "@/server/realtime"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST() {
  if (process.env.E2E_TEST_MODE !== "1") return notFound()
  return runRoute(
    Effect.tryPromise({
      try: async () => {
        await getSql()`truncate table run_logs, runs, leases, jobs, devices restart identity cascade`
        realtimeHub.clear()
        return noContent()
      },
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    }),
  )
}
