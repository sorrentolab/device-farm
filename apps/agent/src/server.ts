import {
  AgentBootRequest,
  AgentCancelRequest,
  AgentExecRequest,
  AgentRunRequest,
  AgentScreenshotRequest,
  EXEC_ALLOW_LIST,
  StubCommand,
} from "@dfarm/shared"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { DeviceControlService } from "./device-control.js"
import { StubDiscoveryService } from "./discovery.js"
import { AgentLogger } from "./logger.js"
import { RunSupervisor } from "./run-supervisor.js"
import type { AgentConfig } from "./types.js"

const json = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  })

const decodeBody = async <A, I>(
  request: Request,
  schema: Schema.Schema<A, I>,
): Promise<A> => {
  const body = (await request.json()) as unknown
  return Effect.runPromise(Schema.decodeUnknown(schema)(body))
}

export class CommandServer {
  private server: Bun.Server<undefined> | undefined

  constructor(
    private readonly config: AgentConfig,
    private readonly deviceControl: DeviceControlService,
    private readonly runSupervisor: RunSupervisor,
    private readonly logger: AgentLogger,
    private readonly stubDiscovery?: StubDiscoveryService,
  ) {}

  start(): void {
    this.server = Bun.serve({
      hostname: "0.0.0.0",
      port: this.config.port,
      fetch: (request) => this.handle(request),
    })
    this.logger.info(`agent command server listening on 0.0.0.0:${this.config.port}`)
  }

  stop(): void {
    this.server?.stop()
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    try {
      if (request.method === "GET" && url.pathname === "/healthz") {
        return json({
          ok: true,
          agentHost: this.config.agentHost,
          stub: this.config.stub,
        })
      }

      if (request.method !== "POST") return json({ error: "not found" }, { status: 404 })

      switch (url.pathname) {
        case "/run": {
          const body = await decodeBody(request, AgentRunRequest)
          this.runSupervisor.start(body)
          return json({ accepted: true }, { status: 202 })
        }
        case "/cancel": {
          const body = await decodeBody(request, AgentCancelRequest)
          return json({ canceled: this.runSupervisor.cancel(body.runId) })
        }
        case "/screenshot": {
          const body = await decodeBody(request, AgentScreenshotRequest)
          const capture = await this.deviceControl.capture(body.udid)
          return new Response(capture.bytes, {
            headers: { "content-type": capture.contentType },
          })
        }
        case "/exec": {
          const body = await decodeBody(request, AgentExecRequest)
          const executable = body.argv[0]
          if (!executable || !EXEC_ALLOW_LIST.includes(executable as (typeof EXEC_ALLOW_LIST)[number])) {
            return json({ error: "command not allowed" }, { status: 403 })
          }
          const result = await this.deviceControl.exec(body)
          return json(result)
        }
        case "/boot": {
          const body = await decodeBody(request, AgentBootRequest)
          await this.deviceControl.boot(body.udid)
          return json({ booted: true })
        }
        case "/stub": {
          if (!this.config.stub || !this.stubDiscovery) return json({ error: "not found" }, { status: 404 })
          const body = await decodeBody(request, StubCommand)
          this.handleStub(body)
          return json({ ok: true })
        }
        default:
          return json({ error: "not found" }, { status: 404 })
      }
    } catch (error) {
      this.logger.warn(`handler failed for ${request.method} ${url.pathname}`, String(error))
      return json({ error: String(error) }, { status: 500 })
    }
  }

  private handleStub(command: typeof StubCommand.Type): void {
    if (!this.stubDiscovery) throw new Error("stub discovery is not configured")
    switch (command.type) {
      case "disconnect":
        this.stubDiscovery.disconnect(command.udid)
        return
      case "reconnect":
        this.stubDiscovery.reconnect(command.udid)
        return
      case "configure_run":
        this.runSupervisor.configureStubRun(command)
        return
      case "add_device":
        this.stubDiscovery.addDevice(command.device)
        return
    }
  }
}
