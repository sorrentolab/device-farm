import { mkdir } from "node:fs/promises"
import * as Effect from "effect/Effect"
import { loadConfig } from "./config.js"
import {
  RealDeviceControlService,
  StubDeviceControlService,
} from "./device-control.js"
import {
  DiscoveryService,
  RealDiscoveryService,
  StubDiscoveryService,
} from "./discovery.js"
import { FrameStreamer } from "./frame-streamer.js"
import { AgentLogger } from "./logger.js"
import { ProcessRunner } from "./process.js"
import { Reporter } from "./reporter.js"
import { RunSupervisor } from "./run-supervisor.js"
import { CommandServer } from "./server.js"

const main = Effect.promise(async () => {
  const config = loadConfig()
  const logger = new AgentLogger()
  const runner = new ProcessRunner()
  await mkdir(config.artifactsDir, { recursive: true })

  const discovery: DiscoveryService = config.stub
    ? new StubDiscoveryService(logger)
    : new RealDiscoveryService(logger, runner)
  await discovery.refresh()

  const deviceControl = config.stub
    ? new StubDeviceControlService(config, discovery as StubDiscoveryService)
    : new RealDeviceControlService(config, discovery, runner, logger)

  const frameStreamer = new FrameStreamer(config, deviceControl, logger)
  const runSupervisor = new RunSupervisor(config, discovery, deviceControl, runner, logger)
  const reporter = new Reporter(config, discovery, frameStreamer, logger)
  const server = new CommandServer(
    config,
    deviceControl,
    runSupervisor,
    logger,
    config.stub ? (discovery as StubDiscoveryService) : undefined,
  )

  const stop = (): void => {
    reporter.stop()
    frameStreamer.stop()
    discovery.stop()
    server.stop()
  }

  process.on("SIGINT", () => {
    logger.info("received SIGINT, stopping agent")
    stop()
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    logger.info("received SIGTERM, stopping agent")
    stop()
    process.exit(0)
  })

  server.start()
  frameStreamer.start()
  reporter.start()

  logger.info(
    `agent started (${config.stub ? "stub" : "real"}) as ${config.agentHost}; reporting to ${config.serverUrl}`,
  )
})

Effect.runPromise(main).catch((error: unknown) => {
  console.error(`[${new Date().toISOString()}] [agent] [error] failed to start`, error)
  process.exit(1)
})
