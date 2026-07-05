# Spec: packages/cli — `dfarm`

Read first: `docs/plan.md`, `packages/shared/src/client.ts` + `api.ts` (use `DfarmClient` for all server interaction — no raw fetch in the CLI). Runtime: **Bun**, logic in **Effect**. Deps: only `effect` + `@dfarm/shared` (already installed — no new dependencies; write a small hand-rolled argv parser in `src/args.ts`).

Entry `packages/cli/src/main.ts` (also the `bun build --compile` entry). `DFARM_URL` env selects the server (default http://localhost:3100). `--json` on read commands prints raw JSON. Errors: human message to stderr, exit 1 (network/API), exit 2 (usage). Default `createdBy`: `DFARM_CLIENT` env, else `$USER@<hostname>`.

## Commands

- `dfarm devices [--json]` — table: NAME, PLATFORM, KIND, OS, STATUS, UDID, HELD BY (job id/interactive or `-`).
- `dfarm run <flow.yaml> [--platform ios|android] [--kind simulator|emulator|physical] [--os-min X] [--os-max X] [--name PATTERN] [--device UDID] [--app PATH] [--bundle-id ID] [--env K=V]... [--max-attempts N] [--wait]` — reads the flow file, submits via `POST /api/jobs`. Without `--wait`: print job id, exit 0. With `--wait`: tail `/api/jobs/:id/logs` (SSE) printing lines to stdout, then poll the job to a terminal status; exit 0 iff `passed`, otherwise the run's exitCode if present else 1. Print a final line like `job <id> passed (attempt 2/3 on iPhone 16 simulator)` to stderr so stdout stays clean maestro output.
- `dfarm reserve [requirement flags as above] [--ttl 15m] [--wait]` — create reservation; `--wait` polls until `active` (or failed/canceled). Prints exactly two lines to stdout: `reservation <id>` and `token <token>`, plus a human summary line to stderr with device name + expiry. TTL accepts `90s`/`15m`/`2h`.
- `dfarm shot <reservationId> --token <t> [--out file.jpg]` — screenshot under the lease; no `--out` → raw bytes to stdout. Expired lease (HTTP 410) → clear message, exit 3.
- `dfarm exec <reservationId> --token <t> -- <argv...>` — run allow-listed command on the reserved device; prints stdout/stderr through, exits with the remote exit code. 410 → exit 3.
- `dfarm extend <reservationId> --token <t> --ttl 10m`
- `dfarm release <reservationId> --token <t>`
- `dfarm status <jobId> [--json]` — job + attempt timeline (one line per run: `attempt N on <device> — <outcome>`).
- `dfarm cancel <jobId>`
- `dfarm --help` / per-command help: terse, aligned, with one example each.

Must pass `bun x tsc -p packages/cli --noEmit`, and `bun run packages/cli/src/main.ts --help` must print usage. Do not touch anything outside `packages/cli/`.
