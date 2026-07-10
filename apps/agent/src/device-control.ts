import type {
  AgentExecRequest,
  AgentRunRequest,
  DiscoveredDevice,
  ExecResult,
} from "@dfarm/shared"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { StubDiscoveryService, type DiscoveryService } from "./discovery.js"
import { AgentLogger } from "./logger.js"
import { ProcessRunner } from "./process.js"
import { makeStubMp4, makeStubPng } from "./png.js"
import type { AgentConfig, CaptureResult, CommandResult, RecordingHandle } from "./types.js"

export abstract class DeviceControlService {
  abstract capture(udid: string): Promise<CaptureResult>
  abstract exec(request: AgentExecRequest): Promise<ExecResult>
  abstract boot(udid: string): Promise<void>
  abstract reset(udid: string, mode: "soft" | "hard"): Promise<void>
  abstract prepareRun(request: AgentRunRequest): Promise<CommandResult | undefined>
  /** Start a screen recording that lands in artifactsDir; undefined = unsupported on this device. */
  abstract startRecording(udid: string, artifactsDir: string): Promise<RecordingHandle | undefined>
}

export class RealDeviceControlService extends DeviceControlService {
  constructor(
    private readonly config: AgentConfig,
    private readonly discovery: DiscoveryService,
    private readonly runner: ProcessRunner,
    private readonly logger: AgentLogger,
  ) {
    super()
  }

  async capture(udid: string): Promise<CaptureResult> {
    const device = this.requireDevice(udid)
    if (device.platform === "android") return this.captureAndroid(udid)
    if (device.kind === "simulator") return this.captureIosSimulator(udid)
    return this.capturePhysicalIos(udid)
  }

  async exec(request: AgentExecRequest): Promise<ExecResult> {
    const result = await this.runner.collectText(request.argv)
    return result
  }

  async boot(udid: string): Promise<void> {
    const device = this.requireDevice(udid)
    if (device.platform === "ios" && device.kind === "simulator") {
      const boot = await this.runner.collectText(["xcrun", "simctl", "boot", udid])
      if (boot.exitCode !== 0 && !/already booted/i.test(boot.stderr + boot.stdout)) {
        throw new Error(boot.stderr.trim() || `simctl boot failed with ${boot.exitCode}`)
      }
      const status = await this.runner.collectText(["xcrun", "simctl", "bootstatus", udid, "-b"])
      if (status.exitCode !== 0) {
        throw new Error(status.stderr.trim() || `simctl bootstatus failed with ${status.exitCode}`)
      }
      await this.discovery.refresh()
      return
    }

    if (device.platform === "android") {
      const wait = await this.runner.collectText(["adb", "-s", udid, "wait-for-device"])
      if (wait.exitCode !== 0) {
        throw new Error(wait.stderr.trim() || `adb wait-for-device failed with ${wait.exitCode}`)
      }
      await this.discovery.refresh()
      return
    }
  }

  async reset(udid: string, mode: "soft" | "hard"): Promise<void> {
    const device = this.requireDevice(udid)

    if (mode === "hard") {
      if (device.platform === "ios" && device.kind === "simulator") {
        await this.runner.collectText(["xcrun", "simctl", "shutdown", udid])
        await this.boot(udid)
        return
      }
      if (device.platform === "ios") {
        const reboot = await this.runner.collectText(["xcrun", "devicectl", "device", "reboot", "--device", udid])
        if (reboot.exitCode !== 0) {
          throw new Error(reboot.stderr.trim() || `devicectl reboot failed with ${reboot.exitCode}`)
        }
        return
      }
      // android emulator or physical: fire the reboot; discovery re-sees it when it's back
      const reboot = await this.runner.collectText(["adb", "-s", udid, "reboot"])
      if (reboot.exitCode !== 0) {
        throw new Error(reboot.stderr.trim() || `adb reboot failed with ${reboot.exitCode}`)
      }
      return
    }

    // soft: kill every user app, land on the home screen; device stays booted
    if (device.platform === "ios" && device.kind === "simulator") {
      const kick = await this.runner.collectText([
        "xcrun", "simctl", "spawn", udid,
        "launchctl", "kickstart", "-k", "system/com.apple.SpringBoard",
      ])
      if (kick.exitCode !== 0) {
        throw new Error(kick.stderr.trim() || `SpringBoard restart failed with ${kick.exitCode}`)
      }
      return
    }
    if (device.platform === "ios") {
      throw new Error("soft reset is not supported on physical iOS devices — use hard reset (reboot)")
    }
    const home = await this.runner.collectText(["adb", "-s", udid, "shell", "input", "keyevent", "KEYCODE_HOME"])
    if (home.exitCode !== 0) {
      throw new Error(home.stderr.trim() || `adb HOME keyevent failed with ${home.exitCode}`)
    }
    const pkgs = await this.runner.collectText(["adb", "-s", udid, "shell", "pm", "list", "packages", "-3"])
    for (const line of pkgs.stdout.split(/\r?\n/)) {
      const pkg = line.replace(/^package:/, "").trim()
      if (pkg) await this.runner.collectText(["adb", "-s", udid, "shell", "am", "force-stop", pkg])
    }
  }

  async prepareRun(request: AgentRunRequest): Promise<CommandResult | undefined> {
    const device = this.requireDevice(request.udid)
    if (request.appPath) {
      const install = await this.installApp(device, request.appPath)
      if (install.exitCode !== 0) return install
    }

    if (request.appBundleId) {
      const launch = await this.launchApp(device, request.appBundleId)
      if (launch.exitCode !== 0) return launch
    }

    return undefined
  }

  async startRecording(udid: string, artifactsDir: string): Promise<RecordingHandle | undefined> {
    const device = this.requireDevice(udid)
    if (device.platform === "ios") {
      // No scriptable recorder for physical iOS devices.
      if (device.kind !== "simulator") return undefined
      return this.startIosSimulatorRecording(udid, artifactsDir)
    }
    return this.startAndroidRecording(udid, artifactsDir)
  }

  private startIosSimulatorRecording(udid: string, artifactsDir: string): RecordingHandle {
    const proc = this.runner.spawn([
      "xcrun",
      "simctl",
      "io",
      udid,
      "recordVideo",
      "--codec=h264",
      "--force",
      join(artifactsDir, "recording.mp4"),
    ])
    return {
      stop: async () => {
        // SIGINT is what finalizes the mp4 (writes the moov atom); SIGKILL would corrupt it.
        proc.kill("SIGINT")
        const timeout = setTimeout(() => proc.kill("SIGKILL"), 10_000)
        await proc.exited
        clearTimeout(timeout)
      },
    }
  }

  /**
   * `adb shell screenrecord` hard-caps segments at 3 minutes, so record
   * back-to-back segments on the device and pull them on stop. A single
   * segment lands as recording.mp4; longer runs get recording-01.mp4, ….
   */
  private startAndroidRecording(udid: string, artifactsDir: string): RecordingHandle {
    const remotePrefix = `/sdcard/dfarm-rec-${Date.now()}`
    const maxSegments = 40 // ~2h cap
    let stopped = false
    let current: Bun.ReadableSubprocess | undefined
    let segments = 0

    const loop = (async () => {
      for (let segment = 1; segment <= maxSegments && !stopped; segment += 1) {
        const proc = this.runner.spawn([
          "adb",
          "-s",
          udid,
          "shell",
          "screenrecord",
          "--time-limit",
          "180",
          `${remotePrefix}-${segment}.mp4`,
        ])
        current = proc
        const exitCode = await proc.exited
        if (exitCode === 0 || stopped) {
          segments = segment
          continue
        }
        this.logger.warnOnce(
          `android:screenrecord:${udid}`,
          `screenrecord failed on ${udid}; recording stops at segment ${segment - 1}`,
          `exit ${exitCode}`,
        )
        break
      }
    })()

    return {
      stop: async () => {
        stopped = true
        // screenrecord finalizes its file on SIGINT; killing the local adb client does not reach it.
        await this.runner
          .collectText(["adb", "-s", udid, "shell", "pkill", "-2", "screenrecord"])
          .catch(() => undefined)
        const timeout = setTimeout(() => current?.kill("SIGKILL"), 5_000)
        await loop
        clearTimeout(timeout)
        // screenrecord can exit slightly before the file is fully flushed on device
        await new Promise((resolve) => setTimeout(resolve, 500))
        for (let segment = 1; segment <= segments; segment += 1) {
          const remote = `${remotePrefix}-${segment}.mp4`
          const local = join(
            artifactsDir,
            segments === 1 ? "recording.mp4" : `recording-${String(segment).padStart(2, "0")}.mp4`,
          )
          const pull = await this.runner.collectText(["adb", "-s", udid, "pull", remote, local])
          if (pull.exitCode !== 0) {
            this.logger.warn(`failed to pull ${remote} from ${udid}`, pull.stderr.trim())
          }
          await this.runner.collectText(["adb", "-s", udid, "shell", "rm", "-f", remote])
        }
      },
    }
  }

  private requireDevice(udid: string): DiscoveredDevice {
    const device = this.discovery.get(udid)
    if (!device) throw new Error(`device ${udid} is not currently visible`)
    return device
  }

  private async captureIosSimulator(udid: string): Promise<CaptureResult> {
    const dir = await mkdtemp(join(tmpdir(), "dfarm-shot-"))
    const file = join(dir, "frame.jpg")
    try {
      const result = await this.runner.collectText([
        "xcrun",
        "simctl",
        "io",
        udid,
        "screenshot",
        "--type=jpeg",
        file,
      ])
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `simctl screenshot failed with ${result.exitCode}`)
      }
      return { bytes: await readFile(file), contentType: "image/jpeg" }
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  }

  private async captureAndroid(udid: string): Promise<CaptureResult> {
    const result = await this.runner.collect(["adb", "-s", udid, "exec-out", "screencap", "-p"])
    if (result.exitCode !== 0) {
      throw new Error(new TextDecoder().decode(result.stderr).trim() || `adb screencap failed with ${result.exitCode}`)
    }
    return { bytes: result.stdout, contentType: "image/png" }
  }

  private async capturePhysicalIos(udid: string): Promise<CaptureResult> {
    const dir = await mkdtemp(join(tmpdir(), "dfarm-ios-shot-"))
    const file = join(dir, "frame.png")
    try {
      const result = await this.runner.collectText(["idevicescreenshot", "-u", udid, file]).catch((error: unknown) => {
        this.logger.warnOnce(
          "physical-ios:screenshot-tool",
          "idevicescreenshot is unavailable; physical iOS live view will skip frames",
          String(error),
        )
        throw new Error("physical iOS screenshot unavailable")
      })
      if (result.exitCode !== 0) {
        this.logger.warnOnce(
          "physical-ios:screenshot",
          "physical iOS screenshot failed; live view will skip this frame",
          result.stderr.trim() || `exit ${result.exitCode}`,
        )
        throw new Error("physical iOS screenshot unavailable")
      }
      return { bytes: await readFile(file), contentType: "image/png" }
    } finally {
      await rm(dir, { force: true, recursive: true })
    }
  }

  private installApp(device: DiscoveredDevice, appPath: string): Promise<CommandResult> {
    if (device.platform === "android") {
      return this.runner.collectText(["adb", "-s", device.udid, "install", "-r", appPath])
    }
    if (device.kind === "simulator") {
      return this.runner.collectText(["xcrun", "simctl", "install", device.udid, appPath])
    }
    return this.runner.collectText([
      "xcrun",
      "devicectl",
      "device",
      "install",
      "app",
      "--device",
      device.udid,
      appPath,
    ])
  }

  private launchApp(device: DiscoveredDevice, appBundleId: string): Promise<CommandResult> {
    if (device.platform === "android") {
      return this.runner.collectText([
        "adb",
        "-s",
        device.udid,
        "shell",
        "monkey",
        "-p",
        appBundleId,
        "1",
      ])
    }
    if (device.kind === "simulator") {
      return this.runner.collectText(["xcrun", "simctl", "launch", device.udid, appBundleId])
    }
    return this.runner.collectText([
      "xcrun",
      "devicectl",
      "device",
      "process",
      "launch",
      "--device",
      device.udid,
      appBundleId,
    ])
  }
}

export class StubDeviceControlService extends DeviceControlService {
  private frameCounter = 0

  constructor(
    private readonly config: AgentConfig,
    private readonly discovery: StubDiscoveryService,
  ) {
    super()
  }

  async capture(udid: string): Promise<CaptureResult> {
    if (!this.discovery.has(udid)) throw new Error(`device ${udid} is disconnected`)
    this.frameCounter += 1
    return { bytes: makeStubPng(this.frameCounter), contentType: "image/png" }
  }

  async exec(request: AgentExecRequest): Promise<ExecResult> {
    return {
      exitCode: 0,
      stdout: `stub exec on ${request.udid}: ${request.argv.join(" ")}\n`,
      stderr: "",
    }
  }

  async boot(udid: string): Promise<void> {
    this.discovery.boot(udid)
  }

  async reset(udid: string, mode: "soft" | "hard"): Promise<void> {
    if (!this.discovery.has(udid)) throw new Error(`device ${udid} is disconnected`)
    if (mode === "hard") {
      // Simulate a reboot: vanish from discovery briefly, then come back booted.
      this.discovery.disconnect(udid)
      setTimeout(() => this.discovery.reconnect(udid), 4_000)
    }
  }

  async prepareRun(request: AgentRunRequest): Promise<CommandResult | undefined> {
    if (!this.discovery.has(request.udid)) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `device ${request.udid} is disconnected`,
      }
    }
    await mkdir(join(this.config.artifactsDir, request.runId), { recursive: true })
    return undefined
  }

  async startRecording(udid: string, artifactsDir: string): Promise<RecordingHandle | undefined> {
    if (!this.discovery.has(udid)) throw new Error(`device ${udid} is disconnected`)
    return {
      stop: async () => {
        await writeFile(join(artifactsDir, "recording.mp4"), makeStubMp4())
      },
    }
  }
}
