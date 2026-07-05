import { deviceRepo } from "@/server/device-repo"
import { decodeJsonBody, noContent, notFound, runRoute } from "@/server/http"
import { StubCommand } from "@dfarm/shared"
import * as Effect from "effect/Effect"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  if (process.env.E2E_TEST_MODE !== "1") return notFound()
  return runRoute(
    decodeJsonBody(StubCommand, request).pipe(
      Effect.flatMap((command) =>
        deviceRepo.listAgentUrls().pipe(
          Effect.flatMap((urls) =>
            Effect.tryPromise({
              try: async () => {
                await Promise.all(
                  urls.map(async (url) => {
                    const response = await fetch(`${url}/stub`, {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify(command),
                    })
                    if (!response.ok) throw new Error(`stub command failed for ${url}`)
                  }),
                )
              },
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
            }),
          ),
        ),
      ),
      Effect.as(noContent()),
    ),
  )
}
