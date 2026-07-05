import { AgentReportResponse, type AgentReport } from "@dfarm/shared"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { DiscoveryService } from "./discovery.js"
import { FrameStreamer } from "./frame-streamer.js"
import { AgentLogger } from "./logger.js"
import type { AgentConfig } from "./types.js"

const REPORT_INTERVAL_MS = 5_000

export class Reporter {
  private interval: Timer | undefined

  constructor(
    private readonly config: AgentConfig,
    private readonly discovery: DiscoveryService,
    private readonly frames: FrameStreamer,
    private readonly logger: AgentLogger,
  ) {}

  start(): void {
    void this.report()
    this.interval = setInterval(() => {
      void this.report()
    }, REPORT_INTERVAL_MS)
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval)
  }

  private async report(): Promise<void> {
    const program = Effect.promise(async () => {
      await this.discovery.refresh()
      const body: AgentReport = {
        agentHost: this.config.agentHost,
        agentUrl: this.config.agentUrl,
        devices: this.discovery.list(),
      }
      const response = await fetch(`${this.config.serverUrl}/api/internal/agents/report`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-dfarm-agent-host": this.config.agentHost,
        },
        body: JSON.stringify(body),
      })
      if (!response.ok) {
        throw new Error(`${response.status} ${await response.text()}`)
      }
      const json = (await response.json()) as unknown
      return Effect.runPromise(Schema.decodeUnknown(AgentReportResponse)(json))
    })

    try {
      const response = await Effect.runPromise(program)
      this.frames.setWatched(response.watchedUdids)
    } catch (error) {
      this.logger.warn("failed to report agent heartbeat", String(error))
    }
  }
}
