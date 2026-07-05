import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import * as Stream from "effect/Stream"
import {
  DeviceList,
  ExecRequest,
  ExecResult,
  ExtendRequest,
  JobDetail,
  JobList,
  JobSubmitRequest,
  Reservation,
  ReservationCreateRequest,
} from "./api"
import { Job } from "./domain"
import { ApiError } from "./errors"
import { StubCommand } from "./agent-protocol"

const request = (
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Effect.Effect<Response, ApiError> =>
  Effect.tryPromise({
    try: () => fetch(`${baseUrl}${path}`, init),
    catch: (e) => new ApiError({ status: 0, message: String(e) }),
  }).pipe(
    Effect.filterOrElse(
      (res) => res.ok,
      (res) =>
        Effect.tryPromise({
          try: () => res.text(),
          catch: () => new ApiError({ status: res.status, message: res.statusText }),
        }).pipe(
          Effect.flatMap((body) =>
            Effect.fail(new ApiError({ status: res.status, message: body || res.statusText })),
          ),
        ),
    ),
  )

const json = <A, I>(schema: Schema.Schema<A, I>) =>
  (res: Response): Effect.Effect<A, ApiError> =>
    Effect.tryPromise({
      try: () => res.json(),
      catch: (e) => new ApiError({ status: res.status, message: `invalid JSON: ${e}` }),
    }).pipe(
      Effect.flatMap((body) =>
        Schema.decodeUnknown(schema)(body).pipe(
          Effect.mapError(
            (e) => new ApiError({ status: res.status, message: `decode failed: ${e.message}` }),
          ),
        ),
      ),
    )

const post = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
})

/**
 * Typed client for the dfarm REST API. Used by the CLI and the e2e suites;
 * the dashboard talks to the same routes with plain fetch.
 */
export class DfarmClient {
  constructor(readonly baseUrl: string) {}

  // -- devices --
  listDevices = () =>
    request(this.baseUrl, "/api/devices").pipe(Effect.flatMap(json(DeviceList)))

  setWatched = (deviceId: string, watched: boolean) =>
    request(this.baseUrl, `/api/devices/${deviceId}/watch`, post({ watched }))

  /** 409 if a job holds the device and force is not set. */
  resetDevice = (deviceId: string, opts?: { mode?: "soft" | "hard"; force?: boolean }) =>
    request(this.baseUrl, `/api/devices/${deviceId}/reset`, post(opts ?? {}))

  // -- jobs --
  submitJob = (req: typeof JobSubmitRequest.Encoded) =>
    request(this.baseUrl, "/api/jobs", post(req)).pipe(Effect.flatMap(json(Job)))

  getJob = (id: string) =>
    request(this.baseUrl, `/api/jobs/${id}`).pipe(Effect.flatMap(json(JobDetail)))

  listJobs = (status?: string) =>
    request(this.baseUrl, `/api/jobs${status ? `?status=${status}` : ""}`).pipe(
      Effect.flatMap(json(JobList)),
    )

  cancelJob = (id: string) =>
    request(this.baseUrl, `/api/jobs/${id}`, { method: "DELETE" })

  /** SSE tail of a job's live logs; emits data lines until the job finishes. */
  tailJobLogs = (id: string): Stream.Stream<string, ApiError> =>
    Stream.unwrap(
      request(this.baseUrl, `/api/jobs/${id}/logs`).pipe(
        Effect.map((res) => {
          if (!res.body) return Stream.empty
          return Stream.fromReadableStream(
            () => res.body!,
            (e) => new ApiError({ status: 0, message: String(e) }),
          ).pipe(
            Stream.decodeText(),
            Stream.splitLines,
            // Emit only data lines of unnamed events; the `event: done` sentinel's
            // data payload is protocol, not log output.
            Stream.mapAccum("" as string, (eventName, line) => {
              if (line.startsWith("event: ")) return [line.slice(7), [] as string[]]
              if (line === "") return ["", []]
              if (line.startsWith("data: ") && eventName === "")
                return [eventName, [line.slice(6)]]
              return [eventName, []]
            }),
            Stream.flattenIterables,
          )
        }),
      ),
    )

  // -- reservations --
  createReservation = (req: typeof ReservationCreateRequest.Encoded) =>
    request(this.baseUrl, "/api/reservations", post(req)).pipe(
      Effect.flatMap(json(Reservation)),
    )

  getReservation = (id: string) =>
    request(this.baseUrl, `/api/reservations/${id}`).pipe(Effect.flatMap(json(Reservation)))

  /** Returns raw JPEG bytes. 410 = lease expired. */
  screenshot = (id: string, token: string) =>
    request(this.baseUrl, `/api/reservations/${id}/screenshot?token=${token}`).pipe(
      Effect.flatMap((res) =>
        Effect.tryPromise({
          try: () => res.arrayBuffer(),
          catch: (e) => new ApiError({ status: 0, message: String(e) }),
        }),
      ),
      Effect.map((buf) => new Uint8Array(buf)),
    )

  exec = (id: string, token: string, req: typeof ExecRequest.Encoded) =>
    request(this.baseUrl, `/api/reservations/${id}/exec?token=${token}`, post(req)).pipe(
      Effect.flatMap(json(ExecResult)),
    )

  extend = (id: string, token: string, req: typeof ExtendRequest.Encoded) =>
    request(this.baseUrl, `/api/reservations/${id}/extend?token=${token}`, post(req)).pipe(
      Effect.flatMap(json(Reservation)),
    )

  release = (id: string, token: string) =>
    request(this.baseUrl, `/api/reservations/${id}/release?token=${token}`, post({}))

  // -- e2e-only (available when server runs with E2E_TEST_MODE=1) --
  e2eReset = () => request(this.baseUrl, "/api/e2e/reset", post({}))

  e2eStub = (cmd: typeof StubCommand.Encoded) =>
    request(this.baseUrl, "/api/e2e/stub", post(cmd))
}

export const clientFromEnv = (): DfarmClient => {
  const url =
    (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
      ?.DFARM_URL ?? "http://localhost:3100"
  return new DfarmClient(url)
}
