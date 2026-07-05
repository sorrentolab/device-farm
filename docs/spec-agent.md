# Spec: apps/agent — device agent (real + stub modes)

Read first: `docs/plan.md`, `packages/shared/src/agent-protocol.ts` (the exact wire contract), `docs/spec-web.md` (server endpoints the agent calls). Runtime: **Bun** (use `Bun.serve`, `Bun.spawn`), logic in **Effect** services per AGENTS.md. Deps: only `effect` + `@dfarm/shared` (already installed).

Entry: `apps/agent/src/main.ts`. `--stub` switches discovery/execution to the stub implementations; everything else (reporter, HTTP server shape) is shared. Env: `DFARM_URL` (server), `DFARM_AGENT_PORT` (default 4700), `DFARM_AGENT_HOST` (stable identifier), `DFARM_AGENT_URL` (how the server reaches this agent), `DFARM_ARTIFACTS_DIR`.

## Services

- **Discovery** (interface + two layers):
  - Real: every ~5s run `xcrun simctl list devices -j` (booted + shutdown-but-`isAvailable` sims), `xcrun devicectl list devices -j` (physical iOS; tolerate command absence), `adb devices -l` + `adb shell getprop ro.product.model ro.build.version.release` (emulators `emulator-*` = kind emulator, else physical). Map to `DiscoveredDevice`. Tolerate any tool missing (empty contribution, log once).
  - Stub: in-memory list, initial fixtures: `stub-ios-1`/`stub-ios-2` (iPhone 16 Sim, iOS 18.0, booted simulators), `stub-android-1` (Pixel 8 emulator, Android 15, booted). Mutated by `/stub` commands.
- **Reporter**: every 5s POST `AgentReport` to `${DFARM_URL}/api/internal/agents/report`; response `watchedUdids` drives the FrameStreamer. Server unreachable → log warn, keep looping.
- **FrameStreamer**: for each watched udid, capture ~1fps and POST the raw image to `/api/internal/devices/{udid}/frames` — the path segment is the **udid**; the server resolves (agentHost, udid) to its device row via the `x-dfarm-agent-host` header. Send `x-dfarm-agent-host: $DFARM_AGENT_HOST` on every internal call. Screenshot capture, real: sim `xcrun simctl io <udid> screenshot --type=jpeg <tmp>`; android `adb -s <udid> exec-out screencap -p` (PNG is fine — send with correct content-type; server treats it as an opaque image); physical iOS best-effort `idevicescreenshot` if present, else skip. Stub: generate a tiny PNG (static bytes) with a changing counter — content doesn't matter, cadence does.
- **RunSupervisor**: tracks active runs (runId → process). Real `/run`: write flowYaml to a temp dir, spawn `maestro test --device <udid> flow.yaml` with `--env` vars appended and env merged, plus `--debug-output <artifactsDir>`; artifactsDir = `${DFARM_ARTIFACTS_DIR}/<runId>`. Batch stdout+stderr lines and POST `RunEventBatch` to `/api/internal/runs/{runId}/events` every ~500ms; on process exit send `exit` event with exitCode + artifactsDir. If the device disappears from discovery mid-run (subscribe to Discovery) or maestro dies from device loss, send `device_lost` event instead. If `appPath` is set, install first (sim: `simctl install`, android: `adb install -r`); `appBundleId` + no appPath = app already installed. Install/launch failures are run failures (exit event, non-zero), not crashes.
  - Stub `/run`: per-device configurable via `configure_run` (durationMs, exitCode, default 2000ms/0): emit a few fake maestro-ish log lines over the duration, write `${artifactsDir}/maestro.log` + `screenshot.png` placeholders, then `exit`. A `disconnect` command mid-run → emit `device_lost` for active runs on that udid and remove the device from discovery.
- **CommandServer** (`Bun.serve`, bind 0.0.0.0 — in dev it's localhost anyway, in the e2e compose network the web container must reach it): 
  - `POST /run` (AgentRunRequest → 202 immediately, run supervised in background)
  - `POST /cancel` (kill process, no event beyond what the kill produces — server side already decided the outcome)
  - `POST /screenshot` (AgentScreenshotRequest → image bytes, content-type image/jpeg or image/png)
  - `POST /exec` (AgentExecRequest → ExecResult JSON; first argv element must be in `EXEC_ALLOW_LIST` from shared, else 403)
  - `POST /boot` (AgentBootRequest: real = `xcrun simctl boot <udid>` + `simctl bootstatus -b`, or `adb -s <udid> wait-for-device` no-op for already-running emulators; stub = mark device booted; reply 200 when booted)
  - `GET /healthz`
  - Stub mode only: `POST /stub` (StubCommand).
- Graceful behavior over cleverness everywhere: any handler error → 500 JSON `{error}`; never crash the process.

Must pass `bun x tsc -p apps/agent --noEmit`. A quick manual check must work: `bun run apps/agent/src/main.ts --stub` (with a dead DFARM_URL) starts, serves `/healthz`, logs report failures without crashing.

Do not touch anything outside `apps/agent/`.
