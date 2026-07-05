import type { AgentRunRequest, RunEvent, StubCommand } from "@dfarm/shared"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DeviceControlService } from "./device-control.js"
import { DiscoveryService } from "./discovery.js"
import { AgentLogger } from "./logger.js"
import { linesFromStream, ProcessRunner } from "./process.js"
import { makeStubPng } from "./png.js"
import type { AgentConfig } from "./types.js"

type StubRunConfig = {
  readonly durationMs: number
  readonly exitCode: number
  readonly failureKind?: "exit" | "infra"
}

type ActiveRunState = {
  readonly request: AgentRunRequest
  readonly artifactsDir: string
  readonly eventQueue: RunEvent[]
  flushTimer: Timer | undefined
  process: Bun.ReadableSubprocess | undefined
  completed: boolean
  sawDeviceLoss: boolean
  infraReason: string | undefined
  kill: () => void
}

const now = (): string => new Date().toISOString()

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Tooling failures worth retrying (the flow never really ran): dropped
 * XCUITest/driver connections, gRPC transport errors, driver startup crashes.
 * Deliberately conservative — a plain assertion failure must stay `failed`.
 */
const looksLikeInfraFailure = (line: string): boolean => {
  const lower = line.toLowerCase()
  if (lower.includes("xcuitest") && (lower.includes("driver") || lower.includes("connection"))) return true
  if (lower.includes("maestrodriverstartupexception")) return true
  if (lower.includes("io exception") || lower.includes("ioexception")) return true
  if (lower.includes("unavailable: io error")) return true
  if (lower.includes("econnrefused") || lower.includes("econnreset")) return true
  if (lower.includes("connection refused") || lower.includes("connection reset") || lower.includes("connection dropped")) return true
  if (lower.includes("socket hang up")) return true
  return false
}

const looksLikeDeviceLoss = (line: string): boolean => {
  const lower = line.toLowerCase()
  return (
    lower.includes("device") &&
    (lower.includes("lost") ||
      lower.includes("disconnect") ||
      lower.includes("offline") ||
      lower.includes("not found") ||
      lower.includes("unable to connect"))
  )
}

export class RunSupervisor {
  private readonly active = new Map<string, ActiveRunState>()
  private readonly stubRunConfig = new Map<string, StubRunConfig>()

  constructor(
    private readonly config: AgentConfig,
    private readonly discovery: DiscoveryService,
    private readonly deviceControl: DeviceControlService,
    private readonly runner: ProcessRunner,
    private readonly logger: AgentLogger,
  ) {
    this.discovery.subscribe((devices) => {
      const byUdid = new Map(devices.map((device) => [device.udid, device]))
      for (const state of this.active.values()) {
        const device = byUdid.get(state.request.udid)
        if (!device) {
          void this.completeDeviceLost(state, `device ${state.request.udid} disappeared from discovery`)
        } else if (device.bootState !== "booted") {
          void this.completeDeviceLost(state, `device ${state.request.udid} is ${device.bootState}`)
        }
      }
    })
  }

  start(request: AgentRunRequest): void {
    if (this.active.has(request.runId)) throw new Error(`run ${request.runId} is already active`)
    const artifactsDir = join(this.config.artifactsDir, request.runId)
    const state: ActiveRunState = {
      request,
      artifactsDir,
      eventQueue: [],
      flushTimer: setInterval(() => {
        void this.flush(state)
      }, 500),
      process: undefined,
      completed: false,
      sawDeviceLoss: false,
      infraReason: undefined,
      kill: () => {
        state.process?.kill("SIGTERM")
      },
    }
    this.active.set(request.runId, state)
    void (this.config.stub ? this.runStub(state) : this.runReal(state))
  }

  cancel(runId: string): boolean {
    const state = this.active.get(runId)
    if (!state) return false
    state.completed = true
    state.kill()
    this.cleanup(state)
    return true
  }

  configureStubRun(command: Extract<StubCommand, { type: "configure_run" }>): void {
    this.stubRunConfig.set(command.udid, {
      durationMs: command.durationMs,
      exitCode: command.exitCode,
      failureKind: command.failureKind,
    })
  }

  private async runReal(state: ActiveRunState): Promise<void> {
    const flowDir = await mkdtemp(join(tmpdir(), "dfarm-flow-"))
    const flowFile = join(flowDir, "flow.yaml")

    try {
      await mkdir(state.artifactsDir, { recursive: true })
      await writeFile(flowFile, state.request.flowYaml)

      const prepare = await this.deviceControl.prepareRun(state.request)
      if (state.completed) return
      if (prepare && prepare.exitCode !== 0) {
        this.enqueueCommandOutput(state, prepare)
        await this.completeExit(state, prepare.exitCode)
        return
      }

      const envFlags = Object.entries(state.request.env).flatMap(([key, value]) => [
        "--env",
        `${key}=${value}`,
      ])
      const proc = this.runner.spawn(
        [
          "maestro",
          "test",
          "--device",
          state.request.udid,
          "--debug-output",
          state.artifactsDir,
          ...envFlags,
          flowFile,
        ],
        { env: state.request.env },
      )
      state.process = proc

      const onLine = (line: string): void => {
        if (state.completed) return
        if (looksLikeDeviceLoss(line)) state.sawDeviceLoss = true
        if (!state.infraReason && looksLikeInfraFailure(line)) state.infraReason = line.trim().slice(0, 300)
        this.enqueue(state, { type: "log", line, at: now() })
      }

      const stdout = linesFromStream(proc.stdout, onLine)
      const stderr = linesFromStream(proc.stderr, onLine)
      const [exitCode] = await Promise.all([proc.exited, stdout, stderr])
      if (state.completed) return

      if (exitCode !== 0 && (state.sawDeviceLoss || !this.discovery.has(state.request.udid))) {
        await this.completeDeviceLost(state, `maestro lost device ${state.request.udid}`)
        return
      }

      // Driver/tooling breakage (e.g. XCUITest connection drop) — the device is
      // fine and the flow never really ran, so report it as retryable.
      if (exitCode !== 0 && state.infraReason) {
        await this.completeInfraFailure(state, state.infraReason)
        return
      }

      await this.completeExit(state, exitCode)
    } catch (error) {
      if (!state.completed) {
        this.enqueue(state, { type: "log", line: `agent error: ${String(error)}`, at: now() })
        await this.completeExit(state, 1)
      }
    } finally {
      await rm(flowDir, { force: true, recursive: true })
      if (state.completed) this.cleanup(state)
    }
  }

  private async runStub(state: ActiveRunState): Promise<void> {
    const runConfig = this.stubRunConfig.get(state.request.udid) ?? {
      durationMs: 2_000,
      exitCode: 0,
    }
    this.stubRunConfig.delete(state.request.udid)

    try {
      const prepare = await this.deviceControl.prepareRun(state.request)
      if (state.completed) return
      if (prepare && prepare.exitCode !== 0) {
        this.enqueueCommandOutput(state, prepare)
        await this.completeExit(state, prepare.exitCode)
        return
      }

      const infra = runConfig.failureKind === "infra"
      const lines = [
        `maestro: starting run ${state.request.runId} on ${state.request.udid}`,
        "maestro: preparing app state",
        "maestro: executing flow.yaml",
        infra
          ? "maestro: XCUITest driver connection dropped"
          : runConfig.exitCode === 0
            ? "maestro: flow passed"
            : "maestro: flow failed",
      ]
      const delay = Math.max(100, Math.floor(runConfig.durationMs / lines.length))
      for (const line of lines) {
        if (state.completed) return
        this.enqueue(state, { type: "log", line, at: now() })
        await sleep(delay)
      }

      if (state.completed) return
      await mkdir(state.artifactsDir, { recursive: true })
      await writeFile(join(state.artifactsDir, "maestro.log"), lines.join("\n") + "\n")
      await writeFile(join(state.artifactsDir, "screenshot.png"), makeStubPng(Date.now() % 10_000))
      if (infra) {
        await this.completeInfraFailure(state, "stub: XCUITest driver connection dropped")
        return
      }
      await this.completeExit(state, runConfig.exitCode)
    } catch (error) {
      if (!state.completed) {
        this.enqueue(state, { type: "log", line: `stub run error: ${String(error)}`, at: now() })
        await this.completeExit(state, 1)
      }
    } finally {
      if (state.completed) this.cleanup(state)
    }
  }

  private enqueueCommandOutput(state: ActiveRunState, result: { stdout: string; stderr: string }): void {
    for (const line of `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`.split(/\r?\n/)) {
      if (line.trim()) this.enqueue(state, { type: "log", line, at: now() })
    }
  }

  private enqueue(state: ActiveRunState, event: RunEvent): void {
    if (state.completed && event.type === "log") return
    state.eventQueue.push(event)
  }

  private async completeExit(state: ActiveRunState, exitCode: number): Promise<void> {
    if (state.completed) return
    state.completed = true
    this.enqueue(state, { type: "exit", exitCode, artifactsDir: state.artifactsDir, at: now() })
    await this.flush(state)
    this.cleanup(state)
  }

  private async completeInfraFailure(state: ActiveRunState, message: string): Promise<void> {
    if (state.completed) return
    state.completed = true
    state.process?.kill("SIGTERM")
    this.enqueue(state, { type: "infra_failure", message, at: now() })
    await this.flush(state)
    this.cleanup(state)
  }

  private async completeDeviceLost(state: ActiveRunState, message: string): Promise<void> {
    if (state.completed) return
    state.completed = true
    state.process?.kill("SIGTERM")
    this.enqueue(state, { type: "device_lost", message, at: now() })
    await this.flush(state)
    this.cleanup(state)
  }

  private async flush(state: ActiveRunState): Promise<void> {
    if (state.eventQueue.length === 0) return
    const events = state.eventQueue.splice(0, state.eventQueue.length)
    try {
      const response = await fetch(
        `${this.config.serverUrl}/api/internal/runs/${encodeURIComponent(state.request.runId)}/events`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-dfarm-agent-host": this.config.agentHost,
          },
          body: JSON.stringify({ runId: state.request.runId, events }),
        },
      )
      if (!response.ok) {
        this.logger.warn(
          `failed to report run events for ${state.request.runId}`,
          `${response.status} ${await response.text()}`,
        )
      }
    } catch (error) {
      this.logger.warn(`failed to report run events for ${state.request.runId}`, String(error))
    }
  }

  private cleanup(state: ActiveRunState): void {
    if (state.flushTimer) clearInterval(state.flushTimer)
    state.flushTimer = undefined
    this.active.delete(state.request.runId)
  }
}
