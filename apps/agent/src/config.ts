import { hostname } from "node:os"
import { resolve } from "node:path"
import type { AgentConfig } from "./types.js"

const trimTrailingSlash = (value: string): string => value.replace(/\/+$/, "")

const readPort = (value: string | undefined): number => {
  const parsed = Number(value ?? "4700")
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 4700
}

export const loadConfig = (): AgentConfig => {
  const port = readPort(Bun.env.DFARM_AGENT_PORT)
  const serverUrl = trimTrailingSlash(Bun.env.DFARM_URL ?? "http://localhost:3100")
  const agentHost = Bun.env.DFARM_AGENT_HOST ?? hostname()
  const agentUrl = trimTrailingSlash(Bun.env.DFARM_AGENT_URL ?? `http://localhost:${port}`)
  const artifactsDir = resolve(Bun.env.DFARM_ARTIFACTS_DIR ?? "/tmp/dfarm-artifacts")
  const stub = Bun.argv.includes("--stub")

  return { serverUrl, agentHost, agentUrl, port, artifactsDir, stub }
}
