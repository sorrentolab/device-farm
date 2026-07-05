import type { ApiError, DfarmClient, JobDetail } from "@dfarm/shared"
import * as Effect from "effect/Effect"
import * as Stream from "effect/Stream"
import type { CliContext } from "../context.js"
import { RuntimeError } from "../errors.js"
import { formatJobFinalLine, formatJobStatus, formatJson, isTerminalJobStatus, latestRun } from "../format.js"
import { readTextFile, sleep, writeStderr, writeStdout } from "../io.js"
import type { CancelCommand, RunCommand, StatusCommand } from "../types.js"

const pollIntervalMs = 1000

export const runFlow = (
  context: CliContext,
  command: RunCommand,
): Effect.Effect<number, ApiError | RuntimeError> =>
  Effect.gen(function* () {
    const flowYaml = yield* readTextFile(command.flowPath)
    const job = yield* context.client.submitJob({
      requirements: command.requirements,
      payload: {
        flowYaml,
        appPath: command.appPath,
        appBundleId: command.appBundleId,
        env: command.env,
      },
      createdBy: context.createdBy,
      maxAttempts: command.maxAttempts,
    })

    if (!command.wait) {
      yield* writeStdout(`${job.id}\n`)
      return 0
    }

    yield* Stream.runForEach(context.client.tailJobLogs(job.id), (line) =>
      writeStdout(`${line}\n`),
    )

    const detail = yield* waitForTerminalJob(context.client, job.id)
    yield* writeStderr(`${formatJobFinalLine(detail)}\n`)

    if (detail.job.status === "passed") return 0
    return latestRun(detail.runs)?.exitCode ?? 1
  })

export const runStatus = (
  context: CliContext,
  command: StatusCommand,
): Effect.Effect<number, ApiError> =>
  Effect.gen(function* () {
    const detail = yield* context.client.getJob(command.jobId)
    yield* writeStdout(command.json ? formatJson(detail) : formatJobStatus(detail))
    return 0
  })

export const runCancel = (
  context: CliContext,
  command: CancelCommand,
): Effect.Effect<number, ApiError> =>
  Effect.gen(function* () {
    yield* context.client.cancelJob(command.jobId)
    return 0
  })

const waitForTerminalJob = (
  client: DfarmClient,
  jobId: string,
): Effect.Effect<JobDetail, ApiError> =>
  client.getJob(jobId).pipe(
    Effect.flatMap((detail) => {
      if (isTerminalJobStatus(detail.job.status)) return Effect.succeed(detail)
      return sleep(pollIntervalMs).pipe(Effect.flatMap(() => waitForTerminalJob(client, jobId)))
    }),
  )
