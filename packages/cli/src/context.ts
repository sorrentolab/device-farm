import { DfarmClient } from "@dfarm/shared"
import { hostname } from "node:os"

export type CliContext = {
  readonly baseUrl: string
  readonly client: DfarmClient
  readonly createdBy: string
}

export const makeContext = (): CliContext => {
  const baseUrl = process.env.DFARM_URL ?? "http://localhost:3100"
  const user = process.env.USER ?? "unknown"
  const createdBy = process.env.DFARM_CLIENT ?? `${user}@${hostname()}`

  return {
    baseUrl,
    client: new DfarmClient(baseUrl),
    createdBy,
  }
}
