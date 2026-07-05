# Spec: apps/web backend + compose files

Read first: `docs/plan.md` (design), `packages/shared/src/*` (the wire contract — implement exactly against these schemas; import from `@dfarm/shared`).

Scope: everything server-side in `apps/web` **except dashboard pages** (those are built separately — create only a bare-bones `src/app/layout.tsx` and `src/app/page.tsx` placeholder so `next build` passes; do not style them). Also `docker-compose.base.yml`, `docker-compose.dev.yml`, `docker-compose.e2e.yml`, and `apps/web/Dockerfile`.

Installed versions (already in node_modules, do not change deps without need): next 16.2.10, react 19, effect 3.21, drizzle-orm 0.45, drizzle-kit 0.31, inngest 4.11, postgres 3.4 (postgres-js driver).

## Compose

- `docker-compose.base.yml`: service definitions shared by dev/e2e:
  - `postgres`: postgres:17-alpine, POSTGRES_USER/PASSWORD/DB = dfarm, healthcheck `pg_isready`, named volume.
  - `inngest`: image `inngest/inngest`, runs `inngest dev --no-discovery -u <app-url>` (app url differs per layer).
- `docker-compose.dev.yml`: extends base; **infra only**. postgres exposed on host **5442**; inngest exposed on **8288**, `-u http://host.docker.internal:3100/api/inngest`.
- `docker-compose.e2e.yml`: extends base; adds:
  - `web`: built from `apps/web/Dockerfile` (build context = repo root, it needs the whole workspace). Env: `DATABASE_URL=postgres://dfarm:dfarm@postgres:5432/dfarm`, `E2E_TEST_MODE=1`, `INNGEST_DEV=1`, `INNGEST_BASE_URL=http://inngest:8288`, `DFARM_ARTIFACTS_DIR=/artifacts`. Exposed on host **3101** (container 3100). Entrypoint runs Drizzle migrations, then `next start`. depends_on postgres healthy.
  - `stub-agent`: image `oven/bun:1`, mounts repo (or builds a small image), runs `bun run apps/agent/src/main.ts --stub` with `DFARM_URL=http://web:3100`, `DFARM_AGENT_URL=http://stub-agent:4700`, `DFARM_AGENT_HOST=stub-agent`. depends_on web.
  - inngest `-u http://web:3100/api/inngest`.
  - No host postgres port needed; give the e2e stack `name: dfarm-e2e` so it never collides with dev.

`apps/web/Dockerfile`: node:24 base, install bun (`npm i -g bun`), copy workspace manifests + sources, `bun install --frozen-lockfile`, `bun run --cwd apps/web build`, CMD entrypoint script (`bunx drizzle-kit migrate && next start -p 3100`). Keep it simple; it's a local test image, not production.

## DB (Drizzle, `apps/web/src/db/`)

`schema.ts` + `drizzle.config.ts` (out: `apps/web/drizzle/`), generate the initial migration with `bunx drizzle-kit generate`.

- `devices`: id uuid pk, udid text, agent_host text, agent_url text, platform text, kind text, name text, os_version text, status text ('online'|'busy'|'offline'), boot_state text, watched bool default false, last_heartbeat_at timestamptz, created_at/updated_at; unique (agent_host, udid).
- `jobs`: id uuid pk, type text, status text, requirements jsonb, payload jsonb, created_by text, attempt int default 0, max_attempts int default 3, excluded_device_ids jsonb default '[]' (devices that already failed this job — failover must not re-pick them), created_at/updated_at.
- `runs`: id uuid pk, job_id fk, attempt int, device_id fk, outcome text null, exit_code int null, artifacts_dir text null, error_message text null, started_at, finished_at null.
- `run_logs`: id bigserial pk, run_id fk, seq int, line text, at timestamptz. (Fine for v1 volume.)
- `leases`: id uuid pk, device_id fk **unique**, job_id fk null, kind text, token text, expires_at timestamptz, created_at.

`devices.status` is derived: 'busy' iff an unexpired lease exists; keep it materialized on the row and update it inside the same transactions that create/delete leases.

## Effect services (`apps/web/src/server/`)

Per AGENTS.md: logic lives in Effect services; route handlers and Inngest steps are thin `Effect.runPromise` adapters. Services: `Db` (drizzle over postgres-js), `DeviceRepo`, `JobRepo`, `RunRepo`, `LeaseService`, `AgentClient`, `Realtime`.

- `LeaseService.acquire({requirements, kind, ttlSeconds, jobId, excludeDeviceIds})`: **one Postgres transaction**: `SELECT ... FOR UPDATE SKIP LOCKED` over online, booted, unleased devices matching requirements (platform/kind/osMin/osMax inclusive dotted-version compare/namePattern substring-or-`/regex/`-case-insensitive/deviceUdid), excluding `excludeDeviceIds`; insert lease + set device busy. On no candidate: fail `NoDeviceAvailableError`; if a matching **shutdown** simulator/emulator exists (unleased, online agent), include its udid as `bootableCandidateUdid`.
- `LeaseService.release(leaseId)`: delete lease, set device back to online (if still online), publish realtime, send Inngest event `device/released`.
- `AgentClient`: POST run/cancel/screenshot/exec/boot to `device.agentUrl`; failures → `AgentUnreachableError`.
- `Realtime` (`src/server/realtime.ts`): in-memory pub/sub hub of `RealtimeMessage` (shared schema) + latest-frame cache per device. Transport: check whether installed Next 16.2.10 route handlers support WebSocket upgrade (`export function GET` + `request.socket`/`UPGRADE` export — check next docs/types in node_modules). If yes, `/api/ws`; if not cleanly supported, implement SSE at `GET /api/events` streaming the same JSON messages, one per `data:` line. Either way the hub API is transport-agnostic and the transport is confined to one route file. Document which one you chose in a comment in realtime.ts.

## REST routes (`src/app/api/`)

Match `packages/shared/src/client.ts` paths exactly. Validate request bodies with the shared schemas (`Schema.decodeUnknown`); 400 on decode failure, JSON errors `{ error: string }`.

Public: POST/GET `/api/jobs`, GET `/api/jobs/[id]`, GET `/api/jobs/[id]/logs` (SSE: replay existing run_logs then live-tail via Realtime until job terminal, close with `event: done`), DELETE `/api/jobs/[id]` (cancel: mark canceled, cancel agent run if running, release lease), GET `/api/devices`, POST `/api/devices/[id]/watch`, GET `/api/devices/[id]/frame.jpg` (latest cached frame or 404), POST `/api/reservations`, GET `/api/reservations/[id]`, GET `.../screenshot?token=`, POST `.../exec?token=`, POST `.../extend?token=`, POST `.../release?token=`. Lease token invalid/expired/released → **410** with `{ error: "lease expired" }`.

Reservations map onto jobs of type `reserve` (payload `{ttlSeconds}`): the Reservation DTO is assembled from job + lease (+ device). `status`: queued (no lease yet), active (lease live), expired/released/canceled.

Internal (agent-facing): POST `/api/internal/agents/report` (upsert devices by (agent_host, udid); devices previously online from this agent but missing from the report → mark offline immediately and trigger the device-lost path for any active run/lease on them; respond with `AgentReportResponse` where watchedUdids = watched devices + devices with an active run-flow lease), POST `/api/internal/runs/[runId]/events` (append log lines with monotonically increasing seq, publish `run.log` realtime; on `exit`/`device_lost` events, send Inngest event `run/finished` `{runId, outcome, exitCode, artifactsDir}`), POST `/api/internal/devices/[udid]/frames` (raw image body; resolve the device by (`x-dfarm-agent-host` header, udid) → frame cache + realtime `frame`, keyed by device id).

E2E-only (`E2E_TEST_MODE=1`, else 404): POST `/api/e2e/reset` (truncate everything, clear in-memory state), POST `/api/e2e/stub` (validate `StubCommand`, forward to every registered agent's `agentUrl` + `/stub`), POST `/api/e2e/fixtures` (accept `{jobs: [...], runs: [...]}` shaped like the shared schemas and insert history rows for the history-page scenarios).

## Inngest (`src/inngest/`)

Client id `dfarm`; serve route at `/api/inngest` (next handler from `inngest/next`). Functions:

- `job.run-flow` (event `job/created`, only for type run_flow). Implement the attempt loop **inside** the function with per-attempt step ids (`acquire-1`, `execute-1`, ... keyed by attempt) rather than relying on function-level retries:
  1. acquire: run `LeaseService.acquire` excluding `excluded_device_ids`. On `NoDeviceAvailableError` with `bootableCandidateUdid`: step `boot-<n>` → AgentClient.boot, then re-acquire. On plain no-device: `step.waitForEvent('device/released', timeout 10m)` then loop back to acquire (bounded overall wait: keep re-waiting; job stays `queued`).
  2. create run row (attempt N), job → `running`/`assigned` appropriately, publish realtime; step `execute-<n>`: AgentClient.run(...) then `step.waitForEvent('run/finished', match runId, timeout 30m)`.
  3. outcome passed/failed: finalize run + job, release lease, done. outcome `device_lost`: finalize run as device_lost, release lease, add device to `excluded_device_ids`, increment attempt; if attempt >= max_attempts → job failed; else next loop iteration.
- `job.reserve` (event `job/created`, type reserve): acquire same way (kind 'interactive'), mark job running, then loop: `step.sleepUntil(lease.expiresAt)`; on wake re-read lease — if extended sleep again; if released early or now past expiry → release + job passed (normal end of reservation).
- `watchdog` (cron `* * * * *`): devices with last_heartbeat_at older than 60s → offline + device-lost path for their active runs (send `run/finished` device_lost); delete expired leases (device back online, reservation jobs finished).

Shared device-lost helper so report-handler and watchdog use the same code path.

## Also

- `next.config.ts`: `serverExternalPackages` for `postgres` if needed; output standalone not required.
- Artifacts dir from `DFARM_ARTIFACTS_DIR`; `runs.artifacts_dir` stores the path the agent reported. Route GET `/api/runs/[id]/artifacts` → JSON list of files; GET `/api/runs/[id]/artifacts/[...path]` streams a file (no traversal outside the dir).
- Everything must pass `bun x tsc -p apps/web --noEmit` and `bun run --cwd apps/web build`.
- Do not touch: `packages/*`, `apps/agent`, `e2e/`, root configs, AGENTS.md.
