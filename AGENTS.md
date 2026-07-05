# Device Farm — agent guide

Shared iOS/Android device orchestrator for maestro flows and interactive device sessions.
Full design doc: [docs/plan.md](docs/plan.md). Using the farm from another project: [docs/using-dfarm.md](docs/using-dfarm.md).

## Layout

- `apps/web` — Next.js (Node, App Router): admin dashboard, REST API, WebSocket, Inngest functions. The only piece that talks to Postgres.
- `apps/agent` — device agent (Bun + Effect): discovers simulators/emulators/physical devices, heartbeats, executes maestro runs. `--stub` mode serves fake devices for e2e.
- `packages/shared` — Effect `Schema` definitions for every API surface (REST DTOs, agent protocol, WS messages) plus the typed API client. This is the contract; change it first, then the implementations.
- `packages/cli` — `dfarm` CLI (Bun + Effect) used by coding agents and CI.
- `e2e/<target>/<scenario>` — black-box e2e suites (see rules below).
- `docker-compose.base.yml` / `.dev.yml` / `.e2e.yml` — compose layering via `extends:`; dev = infra only (postgres + inngest), e2e adds web + stub agent.

## Tasks (mise is the single entry point)

- `mise run dev` — dev infra (compose) + `next dev` + local device agent
- `mise run infra:up` / `infra:down` — just postgres + inngest
- `mise run db:generate` / `db:migrate` — Drizzle migrations
- `mise run e2e` — full headless e2e stack + all suites; `mise run e2e -- cli/run-flow-and-wait` for one scenario
- `mise run typecheck` / `lint`
- Env (`DATABASE_URL`, `DFARM_URL`, ports) lives in `mise.toml` `[env]` — no scattered `.env` files.

## Conventions

- **Effect everywhere logic lives.** Services are `Effect.Service` layers (`DeviceRepo`, `LeaseService`, `AgentClient`, `ScreenshotHub`). Validation is `effect/Schema` (no zod). Failures are typed errors (`DeviceLostError`, `NoDeviceAvailableError`, `LeaseExpiredError`) — never thrown strings; Inngest retry decisions map onto these. Route handlers and Inngest steps are thin adapters that `Effect.runPromise` a program.
- **Bun** runs `apps/agent`, `packages/cli`, and the e2e suites. `apps/web` stays on Node (Next's WS support).
- **Realtime is isolated** behind `apps/web/src/lib/realtime.ts`; if Next's beta WS misbehaves, swap SSE in there without touching callers.
- **Lease acquisition is the whole concurrency story**: one Postgres transaction, `SELECT ... FOR UPDATE SKIP LOCKED` + lease insert. Don't add app-level locks or Inngest concurrency keys around device selection.

## E2E rules (binding for implementers and reviewers)

- **Tests are specs.** One scenario = one user journey, written as an executable specification: descriptive names, given/when/then structure, assertions on user-observable outcomes. A reviewer must be able to judge correctness by reading the scenario alone.
- **Black-box only.** Tests touch public surfaces exclusively: the `dfarm` CLI, the REST/WS API, and the seed API. Never import app internals, query Postgres directly, or reach around the API. This applies to reviewer agents too.
- **Self-contained.** Each scenario brings up what it needs via `e2e/setup` (compose e2e stack + stub agent), seeds its own state, and cleans up. No inter-scenario dependencies or ordering.
- **Blockers are reported, not worked around.** If a journey can't be expressed because of a missing seed hook, a stub limitation, or an app bug, report it to the implementer / in your review. Do not add sleeps, retry-until-green loops, or internal shortcuts.
- The seed/test-support API (`/api/e2e/*`) exists only when `E2E_TEST_MODE=1` (set in the e2e compose file, never in dev).

### Reviewer workflow

Reviewer agents verify implementer work by:
1. Reading the scenarios as the spec and judging whether they faithfully describe the intended behavior.
2. Running `mise run e2e` (or a single scenario) and reporting failures back to the implementer.

Reviewers never fix tests, never import internals, and never bypass the public surface to "confirm" behavior.

## Real-device verification

Headless e2e covers scheduling/failover logic against the stub agent. Real-hardware checks stay host-side: `mise run dev`, submit a flow with `dfarm run`, and for failover kill a simulator mid-run (`xcrun simctl shutdown <udid>`) — the run should be marked `device_lost` and retried on another device, visible in the history timeline.

## Picking the right models for workflows and subagents

Rankings, higher = better. Cost reflects what I actually pay (OpenAI has really generous limits), not list price. Intelligence is how hard a problem you can hand the model unsupervised. Taste covers UI/UX, code quality, API design, and copy.

| model    | cost | intelligence | taste |
|----------|------|--------------|-------|
| gpt-5.5  | 9    | 8            | 5     |
| sonnet-5 | 5    | 5            | 7     |
| opus-4.8 | 4    | 7            | 8     |
| fable-5  | 2    | 9            | 9     |

How to apply:
- These are defaults, not limits. You have standing permission to override them: if a cheaper model's output doesn't meet the bar, rerun or redo the work with a smarter model without asking. Judge the output, not the price tag. Escalating costs less than shipping mediocre work.
- Cost is a tie-breaker only; when axes conflict for anything that ships, intelligence > taste > cost.
- Bulk/mechanical work (clear-spec implementation, data analysis, migrations): gpt-5.5 — it's effectively free.
- Anything user-facing (UI, copy, API design) needs taste ≥ 7.
- Reviews of plans/implementations: fable-5 or opus-4.8, optionally gpt-5.5 as an extra independent perspective.
- Never use Haiku.
- Mechanics: gpt-5.5 is only reachable through the Codex CLI — `codex exec` / `codex review` (my ~/.codex/config.toml defaults to gpt-5.5). Use the codex-implementation, codex-review, and codex-computer-use skills; for work they don't cover (investigation, data analysis), run `codex exec -s read-only` directly with a self-contained prompt.
- Claude models (sonnet-5, opus-4.8, fable-5) run via the Agent/Workflow model parameter.

Using gpt-5.5 inside workflows and subagents (the model parameter only takes Claude models, so use a wrapper):
- Spawn a thin Claude wrapper agent with `model: 'sonnet', effort: 'low'` whose prompt instructs it to write a self-contained codex prompt, run `codex exec` via Bash, and return codex's final message plus the list of files it changed, verbatim, without editing anything itself. The wrapper exists only to bridge the model parameter to the Codex CLI — all judgment stays with the orchestrator, all implementation with gpt-5.5.

<!-- Note: the final bullet above was truncated in the source scan; the text after "and return" is a faithful reconstruction of its intent, pending the original doc. -->
