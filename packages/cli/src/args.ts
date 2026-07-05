import * as Effect from "effect/Effect"
import type { DeviceKind, Platform } from "@dfarm/shared"
import { UsageError } from "./errors.js"
import type { CliCommand, HelpTopic, RequirementsInput } from "./types.js"

const commandTopics: readonly HelpTopic[] = [
  "docs",
  "devices",
  "run",
  "reserve",
  "shot",
  "exec",
  "extend",
  "release",
  "status",
  "cancel",
]

const requirementFlags = new Set([
  "--platform",
  "--kind",
  "--os-min",
  "--os-max",
  "--name",
  "--device",
])

type ParsedFlag = {
  readonly name: string
  readonly value?: string
}

export const parseArgs = (argv: readonly string[]): Effect.Effect<CliCommand, UsageError> =>
  Effect.suspend(() => {
    try {
      return Effect.succeed(parseArgsUnsafe(argv))
    } catch (error) {
      if (error instanceof UsageError) return Effect.fail(error)
      return Effect.fail(new UsageError({ message: String(error) }))
    }
  })

const parseArgsUnsafe = (argv: readonly string[]): CliCommand => {
  if (argv.length === 0) return { _tag: "Help" }

  const command = argv[0] ?? failUsage("missing command")
  if (command === "--help" || command === "-h") return { _tag: "Help" }
  if (command === "help") return parseHelpCommand(argv.slice(1))
  if (!commandTopics.includes(command as HelpTopic)) failUsage(`unknown command '${command}'`)

  const topic = parseTopic(command, "command")
  const args = argv.slice(1)
  switch (topic) {
    case "docs":
      return parseDocs(args)
    case "devices":
      return parseDevices(args)
    case "run":
      return parseRun(args)
    case "reserve":
      return parseReserve(args)
    case "shot":
      return parseShot(args)
    case "exec":
      return parseExec(args)
    case "extend":
      return parseExtend(args)
    case "release":
      return parseRelease(args)
    case "status":
      return parseStatus(args)
    case "cancel":
      return parseCancel(args)
    default:
      return failUsage(`unknown command '${command}'`)
  }
}

const parseHelpCommand = (args: readonly string[]): CliCommand => {
  if (args.length === 0) return { _tag: "Help" }
  if (args.length > 1) failUsage("help accepts at most one command")

  const topic = parseTopic(args[0] ?? failUsage("help requires a command"), "help topic")

  return { _tag: "Help", topic }
}

const parseDocs = (args: readonly string[]): CliCommand => {
  if (hasHelp(args)) return { _tag: "Help", topic: "docs" }
  if (args.length > 0) failUsage(`docs takes no arguments`, "docs")
  return { _tag: "Docs" }
}

const parseDevices = (args: readonly string[]): CliCommand => {
  if (hasHelp(args)) return { _tag: "Help", topic: "devices" }

  let json = false
  for (let index = 0; index < args.length; index += 1) {
    const flag = parseFlag(args[index] ?? "", "devices")
    if (flag.name !== "--json") failUsage(`unknown option '${flag.name}'`, "devices")
    if (flag.value !== undefined) failUsage("--json does not take a value", "devices")
    json = true
  }

  return { _tag: "Devices", json }
}

const parseRun = (args: readonly string[]): CliCommand => {
  if (hasHelp(args)) return { _tag: "Help", topic: "run" }

  let flowPath: string | undefined
  let appPath: string | undefined
  let appBundleId: string | undefined
  let maxAttempts: number | undefined
  let wait = false
  const env: Record<string, string> = {}
  const requirements: RequirementsInput = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (!arg.startsWith("--")) {
      if (flowPath !== undefined) failUsage("run accepts exactly one flow file", "run")
      flowPath = arg
      continue
    }

    if (arg === "--wait") {
      wait = true
      continue
    }

    const requirementIndex = applyRequirementFlag(requirements, args, index, "run")
    if (requirementIndex !== undefined) {
      index = requirementIndex
      continue
    }

    const flag = parseFlag(arg, "run")
    switch (flag.name) {
      case "--app": {
        const consumed = readFlagValue(args, index, "run")
        appPath = consumed.value
        index = consumed.index
        break
      }
      case "--bundle-id": {
        const consumed = readFlagValue(args, index, "run")
        appBundleId = consumed.value
        index = consumed.index
        break
      }
      case "--env": {
        const consumed = readFlagValue(args, index, "run")
        const separator = consumed.value.indexOf("=")
        if (separator <= 0) failUsage("--env expects K=V", "run")
        env[consumed.value.slice(0, separator)] = consumed.value.slice(separator + 1)
        index = consumed.index
        break
      }
      case "--max-attempts": {
        const consumed = readFlagValue(args, index, "run")
        maxAttempts = parsePositiveInteger(consumed.value, "--max-attempts", "run")
        index = consumed.index
        break
      }
      default:
        failUsage(`unknown option '${flag.name}'`, "run")
    }
  }

  const requiredFlowPath = flowPath ?? failUsage("run requires <flow.yaml>", "run")

  return {
    _tag: "Run",
    flowPath: requiredFlowPath,
    requirements,
    env,
    wait,
    ...(appPath !== undefined ? { appPath } : {}),
    ...(appBundleId !== undefined ? { appBundleId } : {}),
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
  }
}

const parseReserve = (args: readonly string[]): CliCommand => {
  if (hasHelp(args)) return { _tag: "Help", topic: "reserve" }

  let ttlSeconds = 900
  let wait = false
  const requirements: RequirementsInput = {}

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (!arg.startsWith("--")) failUsage(`unexpected argument '${arg}'`, "reserve")

    if (arg === "--wait") {
      wait = true
      continue
    }

    const requirementIndex = applyRequirementFlag(requirements, args, index, "reserve")
    if (requirementIndex !== undefined) {
      index = requirementIndex
      continue
    }

    const flag = parseFlag(arg, "reserve")
    if (flag.name !== "--ttl") failUsage(`unknown option '${flag.name}'`, "reserve")

    const consumed = readFlagValue(args, index, "reserve")
    ttlSeconds = parseTtlSeconds(consumed.value, "reserve")
    index = consumed.index
  }

  return {
    _tag: "Reserve",
    requirements,
    ttlSeconds,
    wait,
  }
}

const parseShot = (args: readonly string[]): CliCommand => {
  if (hasHelp(args)) return { _tag: "Help", topic: "shot" }

  let reservationId: string | undefined
  let token: string | undefined
  let outPath: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (!arg.startsWith("--")) {
      if (reservationId !== undefined) failUsage("shot accepts exactly one reservation id", "shot")
      reservationId = arg
      continue
    }

    const flag = parseFlag(arg, "shot")
    switch (flag.name) {
      case "--token": {
        const consumed = readFlagValue(args, index, "shot")
        token = consumed.value
        index = consumed.index
        break
      }
      case "--out": {
        const consumed = readFlagValue(args, index, "shot")
        outPath = consumed.value
        index = consumed.index
        break
      }
      default:
        failUsage(`unknown option '${flag.name}'`, "shot")
    }
  }

  const requiredReservationId = reservationId ?? failUsage("shot requires <reservationId>", "shot")
  const requiredToken = token ?? failUsage("shot requires --token <t>", "shot")

  return outPath === undefined
    ? { _tag: "Shot", reservationId: requiredReservationId, token: requiredToken }
    : { _tag: "Shot", reservationId: requiredReservationId, token: requiredToken, outPath }
}

const parseExec = (args: readonly string[]): CliCommand => {
  const separator = args.indexOf("--")
  const optionArgs = separator === -1 ? args : args.slice(0, separator)
  if (hasHelp(optionArgs)) return { _tag: "Help", topic: "exec" }
  if (separator === -1) failUsage("exec requires -- before <argv...>", "exec")

  const remoteArgv = args.slice(separator + 1)
  if (remoteArgv.length === 0) failUsage("exec requires <argv...>", "exec")

  let reservationId: string | undefined
  let token: string | undefined

  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index] ?? ""
    if (!arg.startsWith("--")) {
      if (reservationId !== undefined) failUsage("exec accepts exactly one reservation id", "exec")
      reservationId = arg
      continue
    }

    const flag = parseFlag(arg, "exec")
    if (flag.name !== "--token") failUsage(`unknown option '${flag.name}'`, "exec")
    const consumed = readFlagValue(optionArgs, index, "exec")
    token = consumed.value
    index = consumed.index
  }

  const requiredReservationId = reservationId ?? failUsage("exec requires <reservationId>", "exec")
  const requiredToken = token ?? failUsage("exec requires --token <t>", "exec")

  return { _tag: "Exec", reservationId: requiredReservationId, token: requiredToken, argv: remoteArgv }
}

const parseExtend = (args: readonly string[]): CliCommand => {
  if (hasHelp(args)) return { _tag: "Help", topic: "extend" }

  let reservationId: string | undefined
  let token: string | undefined
  let ttlSeconds: number | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (!arg.startsWith("--")) {
      if (reservationId !== undefined) failUsage("extend accepts exactly one reservation id", "extend")
      reservationId = arg
      continue
    }

    const flag = parseFlag(arg, "extend")
    switch (flag.name) {
      case "--token": {
        const consumed = readFlagValue(args, index, "extend")
        token = consumed.value
        index = consumed.index
        break
      }
      case "--ttl": {
        const consumed = readFlagValue(args, index, "extend")
        ttlSeconds = parseTtlSeconds(consumed.value, "extend")
        index = consumed.index
        break
      }
      default:
        failUsage(`unknown option '${flag.name}'`, "extend")
    }
  }

  const requiredReservationId =
    reservationId ?? failUsage("extend requires <reservationId>", "extend")
  const requiredToken = token ?? failUsage("extend requires --token <t>", "extend")
  const requiredTtlSeconds =
    ttlSeconds ?? failUsage("extend requires --ttl <duration>", "extend")

  return {
    _tag: "Extend",
    reservationId: requiredReservationId,
    token: requiredToken,
    ttlSeconds: requiredTtlSeconds,
  }
}

const parseRelease = (args: readonly string[]): CliCommand => {
  if (hasHelp(args)) return { _tag: "Help", topic: "release" }

  let reservationId: string | undefined
  let token: string | undefined

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (!arg.startsWith("--")) {
      if (reservationId !== undefined) failUsage("release accepts exactly one reservation id", "release")
      reservationId = arg
      continue
    }

    const flag = parseFlag(arg, "release")
    if (flag.name !== "--token") failUsage(`unknown option '${flag.name}'`, "release")
    const consumed = readFlagValue(args, index, "release")
    token = consumed.value
    index = consumed.index
  }

  const requiredReservationId =
    reservationId ?? failUsage("release requires <reservationId>", "release")
  const requiredToken = token ?? failUsage("release requires --token <t>", "release")

  return { _tag: "Release", reservationId: requiredReservationId, token: requiredToken }
}

const parseStatus = (args: readonly string[]): CliCommand => {
  if (hasHelp(args)) return { _tag: "Help", topic: "status" }

  let jobId: string | undefined
  let json = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ""
    if (!arg.startsWith("--")) {
      if (jobId !== undefined) failUsage("status accepts exactly one job id", "status")
      jobId = arg
      continue
    }

    const flag = parseFlag(arg, "status")
    if (flag.name !== "--json") failUsage(`unknown option '${flag.name}'`, "status")
    if (flag.value !== undefined) failUsage("--json does not take a value", "status")
    json = true
  }

  const requiredJobId = jobId ?? failUsage("status requires <jobId>", "status")

  return { _tag: "Status", jobId: requiredJobId, json }
}

const parseCancel = (args: readonly string[]): CliCommand => {
  if (hasHelp(args)) return { _tag: "Help", topic: "cancel" }
  const jobId = args[0]
  const requiredJobId = jobId ?? failUsage("cancel requires <jobId>", "cancel")
  if (args.length !== 1 || requiredJobId.startsWith("--")) {
    failUsage("cancel requires <jobId>", "cancel")
  }

  return { _tag: "Cancel", jobId: requiredJobId }
}

const hasHelp = (args: readonly string[]): boolean =>
  args.some((arg) => arg === "--help" || arg === "-h")

const parseFlag = (arg: string, topic: HelpTopic): ParsedFlag => {
  if (!arg.startsWith("--")) failUsage(`unexpected argument '${arg}'`, topic)

  const separator = arg.indexOf("=")
  if (separator === -1) return { name: arg }

  const name = arg.slice(0, separator)
  const value = arg.slice(separator + 1)
  if (!name) failUsage(`invalid option '${arg}'`, topic)
  return { name, value }
}

const readFlagValue = (
  args: readonly string[],
  index: number,
  topic: HelpTopic,
): { readonly value: string; readonly index: number } => {
  const flag = parseFlag(args[index] ?? "", topic)
  if (flag.value !== undefined) return { value: flag.value, index }

  const value = args[index + 1]
  if (value === undefined || value === "--" || value.startsWith("--")) {
    return failUsage(`${flag.name} requires a value`, topic)
  }

  return { value, index: index + 1 }
}

const parseTopic = (value: string, label: "command" | "help topic"): HelpTopic => {
  switch (value) {
    case "docs":
    case "devices":
    case "run":
    case "reserve":
    case "shot":
    case "exec":
    case "extend":
    case "release":
    case "status":
    case "cancel":
      return value
    default:
      return failUsage(`unknown ${label} '${value}'`)
  }
}

const applyRequirementFlag = (
  requirements: RequirementsInput,
  args: readonly string[],
  index: number,
  topic: HelpTopic,
): number | undefined => {
  const flag = parseFlag(args[index] ?? "", topic)
  if (!requirementFlags.has(flag.name)) return undefined

  const consumed = readFlagValue(args, index, topic)
  switch (flag.name) {
    case "--platform":
      requirements.platform = parsePlatform(consumed.value, topic)
      break
    case "--kind":
      requirements.kind = parseDeviceKind(consumed.value, topic)
      break
    case "--os-min":
      requirements.osMin = consumed.value
      break
    case "--os-max":
      requirements.osMax = consumed.value
      break
    case "--name":
      requirements.namePattern = consumed.value
      break
    case "--device":
      requirements.deviceUdid = consumed.value
      break
  }

  return consumed.index
}

const parsePlatform = (value: string, topic: HelpTopic): Platform => {
  if (value === "ios" || value === "android") return value
  return failUsage("--platform must be ios or android", topic)
}

const parseDeviceKind = (value: string, topic: HelpTopic): DeviceKind => {
  if (value === "simulator" || value === "emulator" || value === "physical") return value
  return failUsage("--kind must be simulator, emulator, or physical", topic)
}

const parsePositiveInteger = (value: string, flag: string, topic: HelpTopic): number => {
  if (!/^[1-9]\d*$/.test(value)) failUsage(`${flag} must be a positive integer`, topic)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) failUsage(`${flag} is too large`, topic)
  return parsed
}

const parseTtlSeconds = (value: string, topic: HelpTopic): number => {
  const match = /^([1-9]\d*)([smh])$/.exec(value)
  if (!match) return failUsage("--ttl must look like 90s, 15m, or 2h", topic)

  const amountText = match[1] ?? failUsage("--ttl must look like 90s, 15m, or 2h", topic)
  const unit = match[2] ?? failUsage("--ttl must look like 90s, 15m, or 2h", topic)
  const amount = parsePositiveInteger(amountText, "--ttl", topic)
  if (unit === "s") return amount
  if (unit === "m") return amount * 60
  return amount * 60 * 60
}

const failUsage = (message: string, topic?: HelpTopic): never => {
  throw new UsageError({ message, topic })
}
