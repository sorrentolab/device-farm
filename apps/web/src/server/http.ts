import { AgentUnreachableError, LeaseExpiredError, NoDeviceAvailableError } from "@dfarm/shared"
import * as Effect from "effect/Effect"
import type * as ParseResult from "effect/ParseResult"
import * as Schema from "effect/Schema"
import { NextResponse } from "next/server"

export const jsonError = (status: number, error: string) =>
  NextResponse.json({ error }, { status })

const isParseError = (error: unknown): error is ParseResult.ParseError =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === "ParseError"

export const errorResponse = (error: unknown): Response => {
  if (isParseError(error)) {
    return jsonError(400, error.message)
  }
  if (error instanceof LeaseExpiredError) {
    return jsonError(410, "lease expired")
  }
  if (error instanceof NoDeviceAvailableError) {
    return jsonError(409, "no device available")
  }
  if (error instanceof AgentUnreachableError) {
    return jsonError(502, error.message)
  }
  if (error instanceof Error) {
    return jsonError(500, error.message)
  }
  return jsonError(500, String(error))
}

export const runRoute = async (program: Effect.Effect<Response, unknown>) => {
  try {
    return await Effect.runPromise(program)
  } catch (error) {
    return errorResponse(error)
  }
}

export const runJson = async <A>(program: Effect.Effect<A, unknown>, init?: ResponseInit) =>
  runRoute(program.pipe(Effect.map((body) => NextResponse.json(body, init))))

export const decodeJsonBody = <A, I>(schema: Schema.Schema<A, I>, request: Request) =>
  Effect.tryPromise({
    try: () => request.json(),
    catch: () => new Error("invalid JSON body"),
  }).pipe(Effect.flatMap((body) => Schema.decodeUnknown(schema)(body)))

export const noContent = () => new Response(null, { status: 204 })

export const notFound = () => jsonError(404, "not found")

export const ensureE2eMode = () =>
  process.env.E2E_TEST_MODE === "1" ? Effect.void : Effect.fail(new Error("not found"))
