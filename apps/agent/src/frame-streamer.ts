import { DeviceControlService } from "./device-control.js"
import { AgentLogger } from "./logger.js"
import type { AgentConfig } from "./types.js"

const FRAME_INTERVAL_MS = 1_000

export class FrameStreamer {
  private readonly watched = new Set<string>()
  private interval: Timer | undefined
  private counter = 0

  constructor(
    private readonly config: AgentConfig,
    private readonly deviceControl: DeviceControlService,
    private readonly logger: AgentLogger,
  ) {}

  start(): void {
    this.interval = setInterval(() => {
      void this.tick()
    }, FRAME_INTERVAL_MS)
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval)
  }

  setWatched(udids: ReadonlyArray<string>): void {
    this.watched.clear()
    for (const udid of udids) this.watched.add(udid)
  }

  private async tick(): Promise<void> {
    const udids = [...this.watched]
    if (udids.length === 0) return
    this.counter += 1
    await Promise.all(udids.map((udid) => this.sendFrame(udid, this.counter)))
  }

  private async sendFrame(udid: string, counter: number): Promise<void> {
    try {
      const capture = await this.deviceControl.capture(udid)
      const response = await fetch(
        `${this.config.serverUrl}/api/internal/devices/${encodeURIComponent(udid)}/frames`,
        {
          method: "POST",
          headers: {
            "content-type": capture.contentType,
            "x-dfarm-agent-host": this.config.agentHost,
            "x-dfarm-frame-counter": String(counter),
          },
          body: capture.bytes,
        },
      )
      if (!response.ok) {
        this.logger.warn(
          `failed to post frame for ${udid}`,
          `${response.status} ${await response.text()}`,
        )
      }
    } catch (error) {
      this.logger.warnOnce(`frame:${udid}`, `failed to capture/post frame for ${udid}`, String(error))
    }
  }
}
