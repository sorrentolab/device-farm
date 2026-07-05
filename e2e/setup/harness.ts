import {
  DfarmClient,
  type Device,
  type DeviceStatus,
  type DiscoveredDevice,
  type Job,
  type JobDetail,
  type JobStatus,
  type StubCommand,
} from "@dfarm/shared"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"

export type EventuallyOptions = {
  readonly timeoutMs?: number
  readonly intervalMs?: number
  readonly description?: string
}

export type CliResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export type DfarmCliRunOptions = {
  readonly env?: Record<string, string>
}

const repoRoot = fileURLToPath(new URL("../..", import.meta.url))
const cliEntry = join(repoRoot, "packages/cli/src/main.ts")

export const defaultStubUdids = ["stub-ios-1", "stub-ios-2", "stub-android-1"] as const

const defaultFlowYaml = [
  "appId: com.example.dfarm.e2e",
  "---",
  "- launchApp",
  "- assertVisible: E2E",
  "",
].join("\n")

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error))

const streamToText = (stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> =>
  stream ? new Response(stream).text() : Promise.resolve("")

export const dfarmUrl = (): string => process.env.DFARM_URL ?? "http://localhost:3101"

export const createClient = (): DfarmClient => new DfarmClient(dfarmUrl())

export const eventually = async <A>(
  effectOrFactory: Effect.Effect<A, unknown, never> | (() => Effect.Effect<A, unknown, never>),
  options: EventuallyOptions = {},
): Promise<A> => {
  const timeoutMs = options.timeoutMs ?? 15_000
  const intervalMs = options.intervalMs ?? 250
  const deadline = Date.now() + timeoutMs
  let lastError: unknown

  while (Date.now() <= deadline) {
    try {
      const effect = typeof effectOrFactory === "function" ? effectOrFactory() : effectOrFactory
      return await Effect.runPromise(effect)
    } catch (error) {
      lastError = error
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await Bun.sleep(Math.min(intervalMs, remaining))
  }

  const prefix = options.description ? `${options.description}: ` : ""
  if (lastError instanceof Error) throw new Error(`${prefix}${lastError.message}`)
  throw new Error(`${prefix}${String(lastError)}`)
}

export class RunningDfarmCli {
  private readonly stdout: Promise<string>
  private readonly stderr: Promise<string>

  constructor(private readonly subprocess: Bun.Subprocess<"ignore", "pipe", "pipe">) {
    this.stdout = streamToText(subprocess.stdout)
    this.stderr = streamToText(subprocess.stderr)
  }

  async result(): Promise<CliResult> {
    const [exitCode, stdout, stderr] = await Promise.all([
      this.subprocess.exited,
      this.stdout,
      this.stderr,
    ])
    return { exitCode, stdout, stderr }
  }

  kill(): void {
    try {
      this.subprocess.kill()
    } catch {
      // The process may already have exited.
    }
  }
}

export class DfarmCli {
  constructor(readonly baseUrl: string = dfarmUrl()) {}

  start(args: readonly string[], options: DfarmCliRunOptions = {}): RunningDfarmCli {
    const subprocess = Bun.spawn(["bun", "run", cliEntry, ...args], {
      cwd: repoRoot,
      env: {
        ...Bun.env,
        DFARM_URL: this.baseUrl,
        ...options.env,
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    return new RunningDfarmCli(subprocess)
  }

  run(args: readonly string[], options: DfarmCliRunOptions = {}): Promise<CliResult> {
    return this.start(args, options).result()
  }
}

export class SeedClient {
  constructor(readonly client: DfarmClient = createClient()) {}

  resetFarm(): Effect.Effect<void, unknown, never> {
    return Effect.gen(this, function* () {
      yield* this.restoreDefaultStubDevices().pipe(Effect.catchAll(() => Effect.void))
      yield* this.client.e2eReset().pipe(Effect.map(() => undefined))
      yield* this.waitForAnyStubDevice()
      yield* this.restoreDefaultStubDevices().pipe(Effect.catchAll(() => Effect.void))
      yield* this.waitForDefaultStubDevices()
    })
  }

  stub(command: StubCommand): Effect.Effect<void, unknown, never> {
    return this.client.e2eStub(command).pipe(Effect.map(() => undefined))
  }

  configureRun(
    udid: string,
    options: {
      readonly durationMs: number
      readonly exitCode?: number
      readonly failureKind?: "exit" | "infra"
    },
  ): Effect.Effect<void, unknown, never> {
    return this.stub({
      type: "configure_run",
      udid,
      durationMs: options.durationMs,
      exitCode: options.exitCode ?? 0,
      ...(options.failureKind ? { failureKind: options.failureKind } : {}),
    })
  }

  addDevice(device: DiscoveredDevice): Effect.Effect<void, unknown, never> {
    return this.stub({ type: "add_device", device })
  }

  private restoreDefaultStubDevices(): Effect.Effect<void, unknown, never> {
    return Effect.forEach(
      defaultStubUdids,
      (udid) => this.stub({ type: "reconnect", udid }),
      { discard: true },
    )
  }

  private waitForAnyStubDevice(): Effect.Effect<void, unknown, never> {
    return Effect.tryPromise({
      try: async () => {
        await eventually(
          () =>
            this.client.listDevices().pipe(
              Effect.flatMap(({ devices }) =>
                devices.some((device) => device.udid.startsWith("stub-"))
                  ? Effect.void
                  : Effect.fail(new Error("no stub device has re-registered")),
              ),
            ),
          { timeoutMs: 15_000, intervalMs: 250 },
        )
      },
      catch: toError,
    })
  }

  private waitForDefaultStubDevices(): Effect.Effect<void, unknown, never> {
    return Effect.tryPromise({
      try: async () => {
        await eventually(
          () =>
            this.client.listDevices().pipe(
              Effect.flatMap(({ devices }) => {
                const byUdid = new Map(devices.map((device) => [device.udid, device]))
                for (const udid of defaultStubUdids) {
                  const device = byUdid.get(udid)
                  if (!device) return Effect.fail(new Error(`${udid} is missing`))
                  if (device.status !== "online") {
                    return Effect.fail(new Error(`${udid} is ${device.status}`))
                  }
                }
                return Effect.void
              }),
            ),
          { timeoutMs: 15_000, intervalMs: 250 },
        )
      },
      catch: toError,
    })
  }
}

export const SeedClientTag = Context.GenericTag<SeedClient>("dfarm/e2e/SeedClient")
export const DfarmCliTag = Context.GenericTag<DfarmCli>("dfarm/e2e/DfarmCli")

export const SeedClientLive = Layer.succeed(SeedClientTag, new SeedClient())
export const DfarmCliLive = Layer.succeed(DfarmCliTag, new DfarmCli())

export const writeTempFlow = async (content = defaultFlowYaml): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "dfarm-e2e-flow-"))
  const path = join(dir, "flow.yaml")
  await writeFile(path, content)
  return path
}

export const collectJobLogLines = (
  client: DfarmClient,
  jobId: string,
): Effect.Effect<ReadonlyArray<string>, unknown, never> =>
  Stream.runFold(client.tailJobLogs(jobId), [] as string[], (lines, line) => [...lines, line])

export const waitForJob = (
  client: DfarmClient,
  predicate: (job: Job) => boolean,
  options: EventuallyOptions = {},
): Promise<Job> =>
  eventually(
    () =>
      client.listJobs().pipe(
        Effect.flatMap(({ jobs }) => {
          const job = jobs.find(predicate)
          return job ? Effect.succeed(job) : Effect.fail(new Error("matching job not found"))
        }),
      ),
    options,
  )

export const waitForJobStatus = (
  client: DfarmClient,
  jobId: string,
  status: JobStatus,
  options: EventuallyOptions = {},
): Promise<JobDetail> =>
  waitForJobDetail(
    client,
    jobId,
    (detail) => detail.job.status === status,
    {
      ...options,
      description: options.description ?? `job ${jobId} to become ${status}`,
    },
  )

export const waitForJobDetail = (
  client: DfarmClient,
  jobId: string,
  predicate: (detail: JobDetail) => boolean,
  options: EventuallyOptions = {},
): Promise<JobDetail> =>
  eventually(
    () =>
      client.getJob(jobId).pipe(
        Effect.flatMap((detail) =>
          predicate(detail)
            ? Effect.succeed(detail)
            : Effect.fail(new Error(`job ${jobId} is ${detail.job.status}`)),
        ),
      ),
    options,
  )

export const waitForDeviceStatus = (
  client: DfarmClient,
  udid: string,
  status: DeviceStatus,
  options: EventuallyOptions = {},
): Promise<Device> =>
  eventually(
    () =>
      client.listDevices().pipe(
        Effect.flatMap(({ devices }) => {
          const device = devices.find((candidate) => candidate.udid === udid)
          if (!device) return Effect.fail(new Error(`${udid} is missing`))
          return device.status === status
            ? Effect.succeed(device)
            : Effect.fail(new Error(`${udid} is ${device.status}`))
        }),
      ),
    {
      ...options,
      description: options.description ?? `${udid} to become ${status}`,
    },
  )

export const deviceForRun = async (client: DfarmClient, deviceId: string): Promise<Device> => {
  const { devices } = await Effect.runPromise(client.listDevices())
  const device = devices.find((candidate) => candidate.id === deviceId)
  if (!device) throw new Error(`device ${deviceId} is not visible`)
  return device
}

export const activeRun = (detail: JobDetail) =>
  detail.runs.find((run) => run.outcome === null)

export const sortedRuns = (detail: JobDetail) =>
  [...detail.runs].sort((left, right) => left.attempt - right.attempt)

export const extractJobIdFromCli = (result: CliResult): string => {
  const match = /job\s+(\S+)\s+(?:passed|failed|canceled)/.exec(`${result.stderr}\n${result.stdout}`)
  const jobId = match?.[1]
  if (!jobId) throw new Error(`could not find job id in CLI output:\n${result.stderr}\n${result.stdout}`)
  return jobId
}

export const extractReservationFromCli = (
  result: CliResult,
): { readonly id: string; readonly token: string } => {
  const id = /^reservation\s+(\S+)$/m.exec(result.stdout)?.[1]
  const token = /^token\s+(\S+)$/m.exec(result.stdout)?.[1]
  if (!id || !token || token === "-") {
    throw new Error(`could not find active reservation credentials in CLI output:\n${result.stdout}`)
  }
  return { id, token }
}
