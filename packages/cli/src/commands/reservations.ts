import type { ApiError, DfarmClient, Reservation } from "@dfarm/shared"
import * as Effect from "effect/Effect"
import type { CliContext } from "../context.js"
import { LeaseExpiredCliError, RuntimeError } from "../errors.js"
import { formatReservationSummary } from "../format.js"
import { sleep, writeFileBytes, writeStderr, writeStdout, writeStdoutBytes } from "../io.js"
import type {
  ExecCommand,
  ExtendCommand,
  ReleaseCommand,
  ReserveCommand,
  ShotCommand,
} from "../types.js"

const pollIntervalMs = 1000

export const runReserve = (
  context: CliContext,
  command: ReserveCommand,
): Effect.Effect<number, ApiError | RuntimeError> =>
  Effect.gen(function* () {
    const created = yield* context.client.createReservation({
      requirements: command.requirements,
      ttlSeconds: command.ttlSeconds,
      createdBy: context.createdBy,
    })
    const reservation = command.wait
      ? yield* waitForActiveReservation(context.client, created.id)
      : created

    yield* writeStdout(`reservation ${reservation.id}\n`)
    yield* writeStdout(`token ${reservation.token ?? "-"}\n`)
    yield* writeStderr(`${formatReservationSummary(reservation)}\n`)
    return 0
  })

export const runShot = (
  context: CliContext,
  command: ShotCommand,
): Effect.Effect<number, ApiError | RuntimeError | LeaseExpiredCliError> =>
  Effect.gen(function* () {
    const bytes = yield* mapLeaseExpired(
      context.client.screenshot(command.reservationId, command.token),
      command.reservationId,
    )
    if (command.outPath) {
      yield* writeFileBytes(command.outPath, bytes)
    } else {
      yield* writeStdoutBytes(bytes)
    }

    return 0
  })

export const runExec = (
  context: CliContext,
  command: ExecCommand,
): Effect.Effect<number, ApiError | LeaseExpiredCliError> =>
  Effect.gen(function* () {
    const result = yield* mapLeaseExpired(
      context.client.exec(command.reservationId, command.token, { argv: [...command.argv] }),
      command.reservationId,
    )
    yield* writeStdout(result.stdout)
    yield* writeStderr(result.stderr)
    return result.exitCode
  })

export const runExtend = (
  context: CliContext,
  command: ExtendCommand,
): Effect.Effect<number, ApiError> =>
  Effect.gen(function* () {
    yield* context.client.extend(command.reservationId, command.token, {
      ttlSeconds: command.ttlSeconds,
    })
    return 0
  })

export const runRelease = (
  context: CliContext,
  command: ReleaseCommand,
): Effect.Effect<number, ApiError> =>
  Effect.gen(function* () {
    yield* context.client.release(command.reservationId, command.token)
    return 0
  })

const waitForActiveReservation = (
  client: DfarmClient,
  reservationId: string,
): Effect.Effect<Reservation, ApiError | RuntimeError> =>
  client.getReservation(reservationId).pipe(
    Effect.flatMap((reservation) => {
      if (reservation.status === "active") return Effect.succeed(reservation)
      if (reservation.status === "queued") {
        return sleep(pollIntervalMs).pipe(
          Effect.flatMap(() => waitForActiveReservation(client, reservationId)),
        )
      }

      return Effect.fail(
        new RuntimeError({
          message: `reservation ${reservation.id} ${reservation.status}`,
        }),
      )
    }),
  )

const mapLeaseExpired = <A, E extends ApiError>(
  effect: Effect.Effect<A, E>,
  reservationId: string,
): Effect.Effect<A, E | LeaseExpiredCliError> =>
  effect.pipe(
    Effect.mapError((error) =>
      error.status === 410 ? new LeaseExpiredCliError({ reservationId }) : error,
    ),
  )
