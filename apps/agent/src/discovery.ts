import type { BootState, DeviceKind, DiscoveredDevice, Platform } from "@dfarm/shared"
import * as Effect from "effect/Effect"
import { AgentLogger } from "./logger.js"
import { ProcessRunner } from "./process.js"
import type { DiscoveryListener } from "./types.js"

const DISCOVERY_INTERVAL_MS = 5_000

const normalizeOsVersion = (value: unknown): string => {
  if (typeof value === "number") return String(value)
  if (typeof value !== "string" || value.trim().length === 0) return "unknown"
  return value.trim()
}

const parseRuntimeVersion = (runtime: string): string => {
  const spaced = runtime.match(/iOS\s+(\d+(?:\.\d+)*)/i)
  if (spaced) return spaced[1]!
  const dashed = runtime.match(/iOS[-.](\d+(?:[-.]\d+)*)/i)
  if (dashed) return dashed[1]!.replaceAll("-", ".")
  return "unknown"
}

const parseAdbFields = (fields: ReadonlyArray<string>): Record<string, string> => {
  const parsed: Record<string, string> = {}
  for (const field of fields) {
    const index = field.indexOf(":")
    if (index > 0) parsed[field.slice(0, index)] = field.slice(index + 1)
  }
  return parsed
}

const humanizeAdbModel = (value: string | undefined): string =>
  value?.replaceAll("_", " ").trim() || "Android device"

const decodeJson = (text: string): unknown => JSON.parse(text) as unknown

export abstract class DiscoveryService {
  protected current = new Map<string, DiscoveredDevice>()
  private readonly listeners = new Set<DiscoveryListener>()
  private interval: Timer | undefined

  constructor(protected readonly logger: AgentLogger) {}

  start(): void {
    void this.refresh()
    this.interval = setInterval(() => {
      void this.refresh()
    }, DISCOVERY_INTERVAL_MS)
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval)
  }

  list(): ReadonlyArray<DiscoveredDevice> {
    return [...this.current.values()]
  }

  get(udid: string): DiscoveredDevice | undefined {
    return this.current.get(udid)
  }

  has(udid: string): boolean {
    return this.current.has(udid)
  }

  subscribe(listener: DiscoveryListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  abstract refresh(): Promise<ReadonlyArray<DiscoveredDevice>>

  protected publish(devices: ReadonlyArray<DiscoveredDevice>): ReadonlyArray<DiscoveredDevice> {
    const previous = [...this.current.values()]
    this.current = new Map(devices.map((device) => [device.udid, device]))
    for (const listener of this.listeners) {
      Promise.resolve(listener(devices, previous)).catch((error: unknown) => {
        this.logger.warn("discovery listener failed", String(error))
      })
    }
    return devices
  }
}

type SimctlDevice = {
  readonly udid?: unknown
  readonly name?: unknown
  readonly state?: unknown
  readonly isAvailable?: unknown
}

type DevicectlDevice = {
  readonly identifier?: unknown
  readonly udid?: unknown
  readonly name?: unknown
  readonly deviceProperties?: {
    readonly name?: unknown
    readonly osVersionNumber?: unknown
    readonly osVersion?: unknown
  }
  readonly hardwareProperties?: {
    readonly udid?: unknown
  }
}

export class RealDiscoveryService extends DiscoveryService {
  constructor(
    logger: AgentLogger,
    private readonly runner: ProcessRunner,
  ) {
    super(logger)
  }

  async refresh(): Promise<ReadonlyArray<DiscoveredDevice>> {
    const effect = Effect.promise(async () => {
      const [simulators, physicalIos, android] = await Promise.all([
        this.discoverSimulators(),
        this.discoverPhysicalIos(),
        this.discoverAndroid(),
      ])
      return this.publish([...simulators, ...physicalIos, ...android])
    })
    return Effect.runPromise(effect)
  }

  private async commandText(
    key: string,
    label: string,
    argv: ReadonlyArray<string>,
  ): Promise<string | undefined> {
    try {
      const result = await this.runner.collectText(argv)
      if (result.exitCode !== 0) {
        this.logger.warnOnce(
          `discovery:${key}:nonzero`,
          `${label} discovery command failed; continuing without it`,
          result.stderr.trim() || `exit ${result.exitCode}`,
        )
        return undefined
      }
      return result.stdout
    } catch (error) {
      this.logger.warnOnce(
        `discovery:${key}:missing`,
        `${label} discovery tool is unavailable; continuing without it`,
        String(error),
      )
      return undefined
    }
  }

  private async discoverSimulators(): Promise<ReadonlyArray<DiscoveredDevice>> {
    const text = await this.commandText("simctl", "iOS simulator", [
      "xcrun",
      "simctl",
      "list",
      "devices",
      "-j",
    ])
    if (!text) return []

    try {
      const json = decodeJson(text) as { readonly devices?: Record<string, ReadonlyArray<SimctlDevice>> }
      const devices: DiscoveredDevice[] = []
      for (const [runtime, entries] of Object.entries(json.devices ?? {})) {
        const osVersion = parseRuntimeVersion(runtime)
        for (const entry of entries) {
          if (typeof entry.udid !== "string" || typeof entry.name !== "string") continue
          const state = typeof entry.state === "string" ? entry.state : "Unknown"
          if (state !== "Booted" && state !== "Shutdown") continue
          if (entry.isAvailable === false) continue
          devices.push({
            udid: entry.udid,
            platform: "ios",
            kind: "simulator",
            name: entry.name,
            osVersion,
            bootState: state === "Booted" ? "booted" : "shutdown",
          })
        }
      }
      return devices
    } catch (error) {
      this.logger.warnOnce("discovery:simctl:parse", "failed to parse simctl device JSON", String(error))
      return []
    }
  }

  private async discoverPhysicalIos(): Promise<ReadonlyArray<DiscoveredDevice>> {
    const text = await this.commandText("devicectl", "physical iOS", [
      "xcrun",
      "devicectl",
      "list",
      "devices",
      "-j",
    ])
    if (!text) return []

    try {
      const json = decodeJson(text) as {
        readonly result?: { readonly devices?: ReadonlyArray<DevicectlDevice> }
        readonly devices?: ReadonlyArray<DevicectlDevice>
      }
      const entries = json.result?.devices ?? json.devices ?? []
      return entries.flatMap((entry): DiscoveredDevice[] => {
        const udid =
          typeof entry.identifier === "string"
            ? entry.identifier
            : typeof entry.udid === "string"
              ? entry.udid
              : typeof entry.hardwareProperties?.udid === "string"
                ? entry.hardwareProperties.udid
                : undefined
        if (!udid) return []
        const name =
          typeof entry.deviceProperties?.name === "string"
            ? entry.deviceProperties.name
            : typeof entry.name === "string"
              ? entry.name
              : "iOS device"
        const osVersion = normalizeOsVersion(
          entry.deviceProperties?.osVersionNumber ?? entry.deviceProperties?.osVersion,
        )
        return [
          {
            udid,
            platform: "ios",
            kind: "physical",
            name,
            osVersion,
            bootState: "booted",
          },
        ]
      })
    } catch (error) {
      this.logger.warnOnce(
        "discovery:devicectl:parse",
        "failed to parse devicectl device JSON",
        String(error),
      )
      return []
    }
  }

  private async discoverAndroid(): Promise<ReadonlyArray<DiscoveredDevice>> {
    const text = await this.commandText("adb", "Android", ["adb", "devices", "-l"])
    if (!text) return []

    const devices: DiscoveredDevice[] = []
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith("List of devices")) continue
      const parts = line.split(/\s+/)
      const udid = parts[0]
      const state = parts[1]
      if (!udid || state !== "device") continue
      const fields = parseAdbFields(parts.slice(2))
      const [model, osVersion] = await Promise.all([
        this.adbGetProp(udid, "ro.product.model"),
        this.adbGetProp(udid, "ro.build.version.release"),
      ])
      devices.push({
        udid,
        platform: "android",
        kind: udid.startsWith("emulator-") ? "emulator" : "physical",
        name: humanizeAdbModel(model || fields.model),
        osVersion: normalizeOsVersion(osVersion),
        bootState: "booted",
      })
    }
    return devices
  }

  private async adbGetProp(udid: string, prop: string): Promise<string | undefined> {
    try {
      const result = await this.runner.collectText(["adb", "-s", udid, "shell", "getprop", prop])
      if (result.exitCode !== 0) return undefined
      const value = result.stdout.trim()
      return value.length > 0 ? value : undefined
    } catch {
      return undefined
    }
  }
}

const stubFixtures = (): ReadonlyArray<DiscoveredDevice> => [
  {
    udid: "stub-ios-1",
    platform: "ios",
    kind: "simulator",
    name: "iPhone 16 Sim",
    osVersion: "18.0",
    bootState: "booted",
  },
  {
    udid: "stub-ios-2",
    platform: "ios",
    kind: "simulator",
    name: "iPhone 16 Sim",
    osVersion: "18.0",
    bootState: "booted",
  },
  {
    udid: "stub-android-1",
    platform: "android",
    kind: "emulator",
    name: "Pixel 8 emulator",
    osVersion: "15",
    bootState: "booted",
  },
]

export class StubDiscoveryService extends DiscoveryService {
  private readonly allDevices = new Map<string, DiscoveredDevice>()
  private readonly connected = new Set<string>()

  constructor(logger: AgentLogger) {
    super(logger)
    for (const device of stubFixtures()) {
      this.allDevices.set(device.udid, device)
      this.connected.add(device.udid)
    }
    this.publish(this.visibleDevices())
  }

  async refresh(): Promise<ReadonlyArray<DiscoveredDevice>> {
    return this.publish(this.visibleDevices())
  }

  disconnect(udid: string): void {
    this.connected.delete(udid)
    this.publish(this.visibleDevices())
  }

  reconnect(udid: string): void {
    if (this.allDevices.has(udid)) this.connected.add(udid)
    this.publish(this.visibleDevices())
  }

  addDevice(device: DiscoveredDevice): void {
    this.allDevices.set(device.udid, device)
    this.connected.add(device.udid)
    this.publish(this.visibleDevices())
  }

  boot(udid: string): void {
    const device = this.allDevices.get(udid)
    if (!device) return
    this.allDevices.set(udid, { ...device, bootState: "booted" })
    this.connected.add(udid)
    this.publish(this.visibleDevices())
  }

  private visibleDevices(): ReadonlyArray<DiscoveredDevice> {
    return [...this.connected].flatMap((udid) => {
      const device = this.allDevices.get(udid)
      return device ? [device] : []
    })
  }
}

export const isBootableKind = (kind: DeviceKind): boolean => kind === "simulator" || kind === "emulator"

export const canUsePlatformTool = (platform: Platform, kind: DeviceKind, device: DiscoveredDevice): boolean =>
  platform === device.platform && kind === device.kind

export const bootStateFromText = (value: string): BootState =>
  value.toLowerCase() === "booted" ? "booted" : "shutdown"
