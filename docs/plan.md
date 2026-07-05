# Device Farm — shared iOS/Android device orchestrator for maestro & agents

## Context

Multiple projects (and multiple coding agents) compete for the same pool of iOS simulators, Android emulators, and physical devices on this Mac — for maestro test runs and for visual UI checks. Today there's no coordination: two agents can grab the same simulator, and a device disconnecting mid-run just kills the work. The goal is a webapp + queue where all maestro flows and interactive device sessions are queued and dispatched to available devices, with an admin dashboard showing devices, what's running on them, a ~1fps live view of each screen, and run history. If a device drops mid-job, the job is automatically retried on another compatible device or simulator.

**Stack:** TypeScript, Next.js (latest, App Router, self-hosted `next start` — uses its beta WebSocket support in route handlers), **Inngest** for job orchestration (local Inngest Dev Server), **Postgres** via Drizzle ORM (dockerized), artifacts on local disk. **Effect** (effect-ts) for domain/service logic in both the webapp and the CLI/agent. **Bun** as the runtime for the CLI and agent packages (Next.js app stays on Node). **mise** manages toolchain versions, env vars, and tasks. Single Mac for v1, but the device layer talks to the server over HTTP/WS so a second Mac can be added later.

## Architecture

Three pieces, one repo:

```
device-farm/
├── AGENTS.md              # Model-selection + repo guidance; imported by CLAUDE.md
├── CLAUDE.md              # Just `@AGENTS.md`
├── mise.toml              # Tool versions (bun, node), env vars, tasks (dev, e2e, db, lint)
├── docker-compose.base.yml
├── docker-compose.dev.yml   # infra only: postgres + inngest dev server
├── docker-compose.e2e.yml   # infra + web + stub agent, for e2e tests
├── apps/web/              # Next.js (Node): admin dashboard + REST API + WS + Inngest functions
├── apps/agent/            # Device agent: long-running Bun process supervising local devices
├── packages/shared/       # Effect schemas/types, API client used by agent + CLI
├── packages/cli/          # `dfarm` CLI (Bun + Effect) for coding agents
└── e2e/                   # Self-contained e2e suites: e2e/<target>/<scenario>
```

### Tooling conventions
- **mise** is the single entry point: `mise run dev` (compose dev infra + next dev + agent), `mise run e2e`, `mise run db:migrate`, `mise run lint`; env vars (`DATABASE_URL`, `DFARM_URL`, Inngest keys) declared in `mise.toml` `[env]` rather than scattered `.env` files.
- **Effect** everywhere logic lives: services as `Effect.Service` layers (DeviceRepo, LeaseService, AgentClient, ScreenshotHub), `Schema` for API/DTO validation (replaces zod), typed errors (`DeviceLostError`, `NoDeviceAvailableError`) instead of thrown exceptions — these map directly onto Inngest retry decisions. Next.js route handlers and Inngest steps are thin adapters that `Effect.runPromise` a program.
- **Bun** runs `apps/agent` and `packages/cli` (fast start, single-file `bun build --compile` for the `dfarm` binary). The Next.js app stays on Node for compatibility with Next's WS support.

### Docker compose layering
- `docker-compose.base.yml` — shared service definitions: `postgres` (healthcheck + named volume) and `inngest` (official `inngest/inngest` dev-server image pointing at the web app's `/api/inngest`).
- `docker-compose.dev.yml` — extends base, **infra only** (postgres + inngest). The Next.js app and the device agent run on the host (the agent must — it needs `simctl`/`adb`/USB access).
- `docker-compose.e2e.yml` — extends base and adds the services under test: the `web` app (built image) and a **stub device agent** that registers fake devices and simulates runs/disconnects. Makes queueing, lease contention, and failover e2e-testable headlessly.
Inheritance via compose's `extends:` (per-service) from the base file, invoked through mise tasks.

### 1. Device agent (`apps/agent`)
One long-running Bun process per machine. Responsibilities:
- **Discovery loop** (~5s): enumerate devices and upsert to server:
  - iOS simulators: `xcrun simctl list devices -j` (booted + shutdown-but-bootable)
  - Physical iOS: `xcrun devicectl list devices -j`
  - Android emulators + physical: `adb devices -l` (+ `adb shell getprop` for model/os)
- **Heartbeat** per device every 5s. A device missing from discovery → immediately report `offline` (this is the disconnect signal, faster than server-side timeout).
- **Command execution**: exposes a small local HTTP server (localhost-only) the Next.js server calls:
  - `POST /run` — spawn `maestro test --device <id> <flow>` with env vars, stream stdout lines + final exit code back to server; collect maestro's output dir (screenshots, logs, recording) as artifacts
  - `POST /screenshot` — `xcrun simctl io <udid> screenshot` / `adb exec-out screencap -p` / `idevicescreenshot`, returns JPEG
  - `POST /exec` — allow-listed passthrough (install app, launch, uninstall, boot simulator) for interactive leases
  - `POST /cancel` — kill a running maestro process
- **Screenshot streaming**: for devices marked "watched" (dashboard open or job running), capture at 1–2fps and POST frames to the server (server fans out over WS). Idle devices aren't polled.
- **Simulator elasticity**: on request, boot a shutdown simulator (`simctl boot`) so failover can fall back to a fresh simulator.

### 2. Server (`apps/web`) — Next.js
- **DB (Drizzle + Postgres)** tables: `devices` (id, platform, kind sim/emu/physical, name, os_version, status online/busy/offline, agent_host, last_heartbeat), `jobs` (id, type run_flow|reserve, requirements JSON, payload JSON, status queued/assigned/running/passed/failed/canceled, attempt, max_attempts, created_by — a free-text client label for the dashboard), `runs` (job attempt on a specific device: logs pointer, artifacts, timing, outcome incl. `device_lost`), `leases` (device_id, job_id, expires_at — the single source of truth for "who owns this device").
- **No auth in v1** — dashboard and API are open to anyone with network access.
- **REST API** (route handlers, unauthenticated):
  - `POST /api/jobs` (submit flow run: flow file content, app binary/bundle id, env, requirements: platform, kind, os range, name pattern), `GET /api/jobs/:id` (+ `/logs` SSE tail), `DELETE /api/jobs/:id`
  - `POST /api/reservations` (interactive lease with TTL) → lease token; under it: `GET .../screenshot`, `POST .../exec`, `POST .../release`, `POST .../extend`
  - `GET /api/devices`
  - Internal endpoints for the agent: register/heartbeat/frames/run-events
- **WebSocket** endpoint (Next.js beta WS in a route handler; SSE fallback behind the same interface if beta WS proves flaky): pushes device status changes, queue updates, and screenshot frames to the dashboard.
- **Admin dashboard** (React, App Router pages):
  - **Devices**: grid of cards — live thumbnail, name/os/kind, status badge, current job link, "watch" toggle, "reserve" button
  - **Queue**: queued + running jobs, requirements, who submitted, cancel
  - **History**: past runs, filterable; run detail page with log viewer, artifacts, attempt timeline (e.g. "attempt 1 on iPhone 15 — device_lost → attempt 2 on iPhone 16 sim — passed")

### 3. Orchestration (Inngest functions in `apps/web`)
- **`job.run-flow`** — triggered by `job/created`. Steps:
  1. `acquire-device`: transactionally pick an online, unleased device matching requirements and insert a lease (Postgres transaction with `SELECT ... FOR UPDATE SKIP LOCKED` = the mutex). If none available: if a matching *shutdown simulator* exists, ask agent to boot it; else `step.sleep`/`waitForEvent('device/released')` and retry acquisition.
  2. `execute`: call agent `/run`, persist streamed log lines + events to the `runs` row.
  3. `collect-artifacts` + mark passed/failed, release lease, emit `device/released`.
  - **Failover**: if execute fails with `device_lost`, mark the run `device_lost`, release the lease, increment attempt, and throw a retriable error → Inngest retries the function, `acquire-device` runs again **excluding the lost device**. `max_attempts` (default 3) caps it; per-job idempotency = re-install app + re-run flow from scratch.
- **`job.reserve`** — acquire device same way, mark leased-interactive, `step.sleep(ttl)` then auto-release unless extended/released early.
- **`watchdog`** (cron, every 30s): mark devices offline when `last_heartbeat` stale; fail any `runs` on them with `device_lost` (triggers the retry path); expire dead leases.
- Per-device serialization is enforced by the `leases` table (not Inngest concurrency keys), since device *selection* is dynamic.

### 4. CLI (`packages/cli`)
`dfarm` talks to the REST API (`DFARM_URL` env, no credentials in v1):
- `dfarm run flow.yaml --platform ios --app MyApp.app --env KEY=V --wait` — submits, tails logs, exits with the run's exit code (drop-in for `maestro test`)
- `dfarm reserve --platform android --ttl 15m` → prints lease id; `dfarm shot <lease>`, `dfarm exec <lease> -- adb install app.apk`, `dfarm release <lease>`
- `dfarm devices`

## E2E tests

All e2e code lives in a top-level `e2e/` folder, organized by target platform and user journey:

```
e2e/
├── setup/                     # Shared harness: compose lifecycle, seeding client, polling helpers
├── cli/                       # Target: the `dfarm` CLI
│   ├── run-flow-and-wait/
│   ├── queue-contention/
│   └── reserve-and-screenshot/
├── web/                       # Target: REST API + dashboard behavior
│   ├── submit-and-track-job/
│   ├── device-lost-failover/
│   └── run-history-timeline/
└── agent/                     # Target: agent protocol (against the stub agent)
    ├── register-and-heartbeat/
    └── disconnect-detection/
```

Rules:
- **Tests are specs.** Each scenario is one user journey written to read as an executable specification — descriptive names, given/when/then structure, assertions on user-observable outcomes.
- **Black-box only.** Tests interact exclusively through public surfaces: the `dfarm` CLI, the REST/WS API, and the seed API. Never import app internals, query Postgres directly, or reach around the API.
- **Self-contained.** Each scenario brings up what it needs via the shared `e2e/setup` harness, seeds its own state, and cleans up. Scenarios don't depend on each other or on execution order.
- **Blockers are reported, not worked around.**
- **Stack**: Bun test runner + Effect in the tests (harness services as Effect layers: `ComposeStack`, `SeedClient`, `DfarmCli`).

**Seed / test-support API**: e2e-only endpoints, enabled by `E2E_TEST_MODE=1` (set only in the e2e compose file): reset database, create devices/jobs/history fixtures, and command the stub agent (make a fake device "disconnect", make a fake run take N seconds, force a failure).

## Milestones (each independently testable)

1. **Scaffold + device registry**: monorepo (bun workspaces), `mise.toml`, `AGENTS.md` + `CLAUDE.md`, compose base+dev, Next.js app, Drizzle migrations, Inngest wiring; agent discovery + heartbeat; Devices page listing real simulators/devices with online/offline updating live over WS.
2. **Run-flow end-to-end (no scheduling)**: submit a job via REST targeting an explicit device; Inngest function drives agent `/run`; logs stream to run detail page; artifacts saved; history page. `dfarm run --device <id> --wait` works.
3. **Scheduling + failover + e2e harness**: requirements matching, lease-based acquisition, wait-for-device, simulator auto-boot, `device_lost` retry on another device, watchdog cron. Stub agent, `docker-compose.e2e.yml`, `e2e/setup`, seed API; first scenarios cover contention, disconnect-failover, retry caps.
4. **Live view**: watched-device screenshot streaming at 1–2fps into dashboard thumbnails + device detail live view.
5. **Interactive leases**: reservation API + TTL auto-release + passthrough exec/screenshot; `dfarm reserve/shot/exec/release`; dashboard shows interactive holds distinctly.
6. **Ops polish**: launchd/pm2 config, boot task, README + agent-facing usage doc. No auth in v1.

## Key implementation notes

- **Disconnect detection is two-layer**: agent notices device vanished from `simctl/adb` output (fast, ~5s); server watchdog catches agent death via stale heartbeats (slow path, ~60s).
- **Lease acquisition must be atomic**: single Postgres transaction (`SELECT device FOR UPDATE SKIP LOCKED` + insert lease). Expose it as an Effect service so the e2e stub and real path share the code.
- **Flow files**: jobs carry flow YAML content (uploaded), not host paths. App binaries referenced by absolute path in v1 (same machine).
- **Physical iOS quirks**: maestro drives physical iOS via `xcrun devicectl`/idb; screenshots may need `idevicescreenshot`. Physical-iOS live view is best-effort in v1.
- **Next.js WS is beta**: isolate realtime behind one small pub/sub module so SSE can be swapped in if WS misbehaves.

## Verification

- **Headless e2e**: `mise run e2e` brings up `docker-compose.e2e.yml` and runs the suites: contention, disconnect mid-run → failover, retry cap exhaustion, lease TTL expiry.
- **Milestone 3**: start a long maestro flow on a booted simulator, `xcrun simctl shutdown <udid>` mid-run → run marked `device_lost`, job requeued, second simulator auto-boots, flow completes there; attempt timeline visible in history.
- **Contention**: two `dfarm run --wait` submissions with one matching device → second queues, starts only after first releases.
- **Lease TTL**: `dfarm reserve --ttl 1m`, wait → device returns to available; screenshot under an expired lease returns 410.
- **Live view**: ~1fps thumbnail updates and status transitions without refresh.
