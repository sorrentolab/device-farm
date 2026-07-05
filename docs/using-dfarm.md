# Using the device farm from your project

This Mac runs a shared device farm. **Never talk to simulators, emulators, or physical devices directly** — no bare `maestro test`, `simctl`, or `adb` against devices; another agent may own them. Go through `dfarm` and you get queueing, a compatible device, automatic retry if the device drops, and artifacts collected for you.

Add to your project's CLAUDE.md / AGENTS.md:

```md
UI tests and device work go through the shared device farm — run `dfarm docs` for the usage guide.
Never run maestro/simctl/adb against a device directly.
```

Setup: install the CLI with `cd ~/projects/sorrentolab/device-farm && mise run cli:install` (standalone binary in `~/.local/bin/dfarm`; re-run the same command to update after the farm changes). `DFARM_URL=http://localhost:3100` is the default. Set `DFARM_CLIENT=<your project/agent name>` so the dashboard shows who submitted what.

## Run a maestro flow

```sh
dfarm run flow.yaml --platform ios --app /abs/path/MyApp.app --env BASE_URL=http://localhost:8080 --wait
```

Behaves like `maestro test`: streams the flow's log to stdout, exit code 0 iff the flow passed. The farm picks any compatible device; pin one with `--device <udid>` or narrow with `--kind simulator --os-min 17.0 --name "iPhone 16"`. If the device dies mid-run the farm retries on another one (up to `--max-attempts`, default 3) — your command just keeps streaming.

Without `--wait` it prints a job id; check later with `dfarm status <jobId>`.

## Look at a device (visual checks, manual poking)

```sh
dfarm reserve --platform ios --ttl 15m --wait   # → reservation <id> / token <t>
dfarm shot <id> --token <t> --out screen.jpg     # screenshot for visual review
dfarm exec <id> --token <t> -- xcrun simctl openurl <udid> myapp://route
dfarm release <id> --token <t>                   # release early; TTL auto-releases otherwise
```

While reserved, the device is yours alone — jobs queue behind you, so keep TTLs short and release when done. An expired/released reservation makes `shot`/`exec` exit 3; reserve again.

## Everything else

- `dfarm devices` — what exists and who holds it
- `dfarm cancel <jobId>`
- Dashboard (live screens, queue, history): http://localhost:3100
- Same operations over plain REST if you can't shell out: `POST $DFARM_URL/api/jobs`, `GET /api/devices`, … (see `packages/shared/src/client.ts` in the farm repo for the full surface)

Flows are submitted by content, so your flow file can live anywhere; app binaries must be absolute paths on this machine (v1).
