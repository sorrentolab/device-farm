import {
  AgentBootRequest,
  AgentCancelRequest,
  AgentExecRequest,
  AgentRunRequest,
  AgentScreenshotRequest,
  AgentUnreachableError,
  ExecResult,
  type DeviceKind,
  type Platform,
  type RunFlowPayload,
} from "@dfarm/shared"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"

export type AgentTarget = {
  agentHost: string
  agentUrl: string
  udid: string
  platform: Platform
  kind: DeviceKind
}

const postJson = (
  target: AgentTarget,
  path: string,
  body: unknown,
): Effect.Effect<Response, AgentUnreachableError> =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${target.agentUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        const text = await response.text().catch(() => response.statusText)
        throw new AgentUnreachableError({
          agentHost: target.agentHost,
          message: text || response.statusText,
        })
      }
      return response
    },
    catch: (error) =>
      error instanceof AgentUnreachableError
        ? error
        : new AgentUnreachableError({
            agentHost: target.agentHost,
            message: String(error),
          }),
  })

export const agentClient = {
  run: (target: AgentTarget, runId: string, payload: RunFlowPayload) =>
    postJson(
      target,
      "/run",
      AgentRunRequest.make({
        runId,
        udid: target.udid,
        platform: target.platform,
        kind: target.kind,
        flowYaml: payload.flowYaml,
        appPath: payload.appPath,
        appBundleId: payload.appBundleId,
        env: payload.env ?? {},
      }),
    ).pipe(Effect.asVoid),

  cancel: (target: AgentTarget, runId: string) =>
    postJson(target, "/cancel", AgentCancelRequest.make({ runId })).pipe(Effect.asVoid),

  screenshot: (target: AgentTarget) =>
    postJson(target, "/screenshot", AgentScreenshotRequest.make({ udid: target.udid })).pipe(
      Effect.flatMap((response) =>
        Effect.tryPromise({
          try: async () => ({
            bytes: new Uint8Array(await response.arrayBuffer()),
            contentType: response.headers.get("content-type") ?? "image/jpeg",
          }),
          catch: (error) =>
            new AgentUnreachableError({
              agentHost: target.agentHost,
              message: String(error),
            }),
        }),
      ),
    ),

  exec: (target: AgentTarget, argv: ReadonlyArray<string>) =>
    postJson(target, "/exec", AgentExecRequest.make({ udid: target.udid, argv: [...argv] })).pipe(
      Effect.flatMap((response) =>
        Effect.tryPromise({
          try: async () => {
            const body = await response.json()
            return await Effect.runPromise(Schema.decodeUnknown(ExecResult)(body))
          },
          catch: (error) =>
            new AgentUnreachableError({
              agentHost: target.agentHost,
              message: String(error),
            }),
        }),
      ),
    ),

  boot: (target: AgentTarget) =>
    postJson(target, "/boot", AgentBootRequest.make({ udid: target.udid })).pipe(Effect.asVoid),

  reset: (target: AgentTarget, mode: "soft" | "hard") =>
    postJson(target, "/reset", { udid: target.udid, mode }).pipe(Effect.asVoid),
}

export class AgentClient extends Effect.Service<AgentClient>()("AgentClient", {
  succeed: agentClient,
}) {}
