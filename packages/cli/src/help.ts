import type { HelpTopic } from "./types.js"

type HelpEntry = {
  readonly usage: string
  readonly description: string
  readonly example: string
}

const entries: Record<HelpTopic, HelpEntry> = {
  docs: {
    usage: "dfarm docs",
    description: "Print the full usage guide for coding agents (what the farm is, how to run flows, reserve devices, and the rules).",
    example: "dfarm docs",
  },
  reset: {
    usage: "dfarm reset <udid> [--hard] [--force]",
    description:
      "Reset a stuck device: kill all apps and return to the home screen. --hard reboots the OS. Refused while a job holds the device unless --force (the job is not canceled).",
    example: "dfarm reset 276E331B-2A51-4322-8F6E-B40ED1A80279 --hard",
  },
  devices: {
    usage: "dfarm devices [--json]",
    description: "List known devices.",
    example: "dfarm devices --json",
  },
  run: {
    usage:
      "dfarm run <flow.yaml> [--platform ios|android] [--kind simulator|emulator|physical] [--os-min X] [--os-max X] [--name NAME (exact; * wildcard or /regex/)] [--device UDID] [--app PATH] [--bundle-id ID] [--env K=V]... [--max-attempts N] [--wait]",
    description: "Submit a maestro flow run.",
    example: "dfarm run flow.yaml --platform ios --app MyApp.app --env API_URL=http://localhost --wait",
  },
  reserve: {
    usage:
      "dfarm reserve [--platform ios|android] [--kind simulator|emulator|physical] [--os-min X] [--os-max X] [--name NAME (exact; * wildcard or /regex/)] [--device UDID] [--ttl 15m] [--wait]",
    description: "Reserve a matching device.",
    example: "dfarm reserve --platform android --ttl 15m --wait",
  },
  shot: {
    usage: "dfarm shot <reservationId> --token <t> [--out file.jpg]",
    description: "Capture a screenshot under a reservation.",
    example: "dfarm shot res_123 --token token_abc --out screen.jpg",
  },
  exec: {
    usage: "dfarm exec <reservationId> --token <t> -- <argv...>",
    description: "Run an allow-listed command on the reserved device.",
    example: "dfarm exec res_123 --token token_abc -- adb install app.apk",
  },
  extend: {
    usage: "dfarm extend <reservationId> --token <t> --ttl 10m",
    description: "Extend a reservation TTL.",
    example: "dfarm extend res_123 --token token_abc --ttl 10m",
  },
  release: {
    usage: "dfarm release <reservationId> --token <t>",
    description: "Release a reservation.",
    example: "dfarm release res_123 --token token_abc",
  },
  status: {
    usage: "dfarm status <jobId> [--json] [--wait]",
    description: "Show a job and its attempt timeline.",
    example: "dfarm status job_123",
  },
  cancel: {
    usage: "dfarm cancel <jobId>",
    description: "Cancel a job.",
    example: "dfarm cancel job_123",
  },
}

const commandRows: readonly [HelpTopic, string][] = [
  ["docs", "Print the agent usage guide"],
  ["devices", "List devices"],
  ["reset", "Reset a stuck device"],
  ["run", "Submit a maestro flow"],
  ["reserve", "Reserve a device"],
  ["shot", "Capture a reservation screenshot"],
  ["exec", "Run a reservation command"],
  ["extend", "Extend a reservation"],
  ["release", "Release a reservation"],
  ["status", "Show job status"],
  ["cancel", "Cancel a job"],
]

export const topicNames = Object.keys(entries) as HelpTopic[]

export const isHelpTopic = (value: string): value is HelpTopic =>
  topicNames.includes(value as HelpTopic)

export const rootHelp = (): string => {
  const width = Math.max(...commandRows.map(([command]) => command.length))
  const commands = commandRows
    .map(([command, description]) => `  ${command.padEnd(width)}  ${description}`)
    .join("\n")

  return `dfarm - shared device farm CLI

Usage:
  dfarm <command> [options]
  dfarm --help

Commands:
${commands}

Environment:
  DFARM_URL      Server URL (default http://localhost:3100)
  DFARM_CLIENT   createdBy label for submitted jobs and reservations

Run 'dfarm <command> --help' for command help.
`
}

export const commandHelp = (topic: HelpTopic): string => {
  const entry = entries[topic]

  return `${entry.description}

Usage:
  ${entry.usage}

Example:
  ${entry.example}
`
}
