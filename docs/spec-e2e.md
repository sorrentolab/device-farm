# Spec: e2e harness + scenarios

Read first: `docs/plan.md` (E2E section + rules), `AGENTS.md` (E2E rules are binding), `packages/shared/src/client.ts` (DfarmClient — the only way tests talk to the server), `docs/spec-agent.md` (stub agent semantics), `docker-compose.e2e.yml`.

Stack: **Bun test runner** (`bun:test`) + **Effect**. Tests are black-box: DfarmClient (REST), the `dfarm` CLI as a subprocess, and the `/api/e2e/*` seed API. Never import from `apps/*`, never touch Postgres.

## Harness (`e2e/setup/`)

- `run.ts` — the `mise run e2e` entry: `docker compose -f docker-compose.e2e.yml -p dfarm-e2e up -d --build --wait` (stream output), wait until `GET http://localhost:3101/api/devices` answers and at least one stub device is registered (bounded, ~60s), then exec `bun test <filter>` with cwd `e2e/` and `DFARM_URL=http://localhost:3101`, finally `docker compose ... down -v`. Exit with the test run's code. Optional argv[2] filter like `cli/run-flow-and-wait` limits which scenario dirs run.
- `harness.ts` — Effect layers/helpers used by every scenario:
  - `SeedClient`: wraps DfarmClient's `e2eReset` / `e2eStub` / fixtures; `resetFarm()` = reset + wait until the stub agent has re-registered its default devices (poll `listDevices`, bounded 15s).
  - `DfarmCli.run(args, {env}) `: spawns `bun run <repo>/packages/cli/src/main.ts ...args` with `DFARM_URL`, captures stdout/stderr/exit code.
  - `eventually(effect, {timeoutMs, intervalMs})`: polls an assertion-effect until it passes or times out — the one sanctioned way to wait for async farm state. No bare sleeps in scenarios.
- Scenarios call `resetFarm()` in `beforeEach`. The compose stack itself is shared across scenarios in one `mise run e2e` invocation (run.ts owns its lifecycle); reset gives each scenario a clean farm.

## Scenarios (one dir per user journey, file `scenario.test.ts`, given/when/then comments, descriptive test names)

`e2e/cli/`:
- `run-flow-and-wait/` — Given a farm with a booted stub iOS simulator. When a user runs `dfarm run flow.yaml --platform ios --wait` (flow file written to a temp dir; stub run configured to ~1s, exit 0). Then the CLI streams log lines to stdout, exits 0, and `dfarm status <jobId>` shows attempt 1 passed on the stub device.
- `queue-contention/` — Given exactly one matching device (disconnect `stub-ios-2` and `stub-android-1` first, or target `--name` so only one matches) and a first long run (configure ~8s) started with `--wait` in the background. When a second `dfarm run --wait` is submitted for the same requirements. Then the second job stays `queued` while the first is `running` (assert via `GET /api/jobs`), and both eventually pass, second starting only after the first finished.
- `reserve-and-screenshot/` — Given an available stub Android emulator. When the user runs `dfarm reserve --platform android --ttl 30s --wait`, then `dfarm shot <id> --token <t> --out shot.png`. Then the file is a non-empty image. When the TTL expires (eventually, ≤60s). Then `dfarm shot` exits 3 and the device is available again (`dfarm devices` shows online, no holder).

`e2e/web/`:
- `submit-and-track-job/` — REST only: submit a job via DfarmClient, observe status transitions queued→running→passed via polling, logs retrievable via the SSE tail, run row has artifactsDir set.
- `device-lost-failover/` — Given two booted stub iOS simulators. When a job runs on whichever device picked it up (configure a ~6s run) and that device is disconnected mid-run via the stub command. Then the run is marked `device_lost`, and the job is retried and **passes on the other device** (attempt 2), visible in the job detail's runs array. Also assert the lost device shows offline.
- `run-history-timeline/` — retry-cap exhaustion: given ONE matching device (narrow requirements), configure runs to fail (nonzero exit)… note: nonzero exit = `failed` (terminal, no retry). For the retry cap use disconnects: start a job with maxAttempts 2, disconnect the device mid-run (attempt 1 device_lost), reconnect it, wait for attempt 2 to start, disconnect again → job ends `failed` with two device_lost runs. Assert the full attempt timeline via `GET /api/jobs/:id`.

`e2e/agent/`:
- `register-and-heartbeat/` — the stub agent's devices appear in `GET /api/devices` as online with fresh lastHeartbeatAt; an `add_device` stub command makes a new device appear within ~10s.
- `disconnect-detection/` — `disconnect` stub command → device goes offline in `GET /api/devices` within ~10s (agent-report path, not the 60s watchdog); `reconnect` brings it back online.

## Rules reminders (also in AGENTS.md)

- A reviewer must be able to judge each scenario by reading it alone: name things by journey, not by mechanism.
- If the app or stub can't express a step, **stop and report the blocker** in your final output; do not add sleeps or workarounds.
- Keep every scenario runnable solo: `mise run e2e -- web/device-lost-failover`.

Everything must pass `bun x tsc -p e2e --noEmit`. Only touch `e2e/` (plus, if strictly needed, mise task glue — report it if so).
