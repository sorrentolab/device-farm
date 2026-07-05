import { join } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = fileURLToPath(new URL("../..", import.meta.url))
const e2eRoot = join(repoRoot, "e2e")
const projectName = "dfarm-e2e"
const composeFile = "docker-compose.e2e.yml"
const farmUrl = "http://localhost:3101"

const compose = (...args: readonly string[]) => [
  "docker",
  "compose",
  "-f",
  composeFile,
  "-p",
  projectName,
  ...args,
]

const runStreaming = async (
  cmd: readonly string[],
  options: { readonly cwd: string; readonly env?: Record<string, string | undefined> },
): Promise<number> => {
  const subprocess = Bun.spawn([...cmd], {
    cwd: options.cwd,
    env: options.env ?? Bun.env,
    stdout: "inherit",
    stderr: "inherit",
  })
  return subprocess.exited
}

const waitForFarm = async (): Promise<void> => {
  const deadline = Date.now() + 60_000
  let lastError: unknown

  while (Date.now() <= deadline) {
    try {
      const response = await fetch(`${farmUrl}/api/devices`)
      if (!response.ok) throw new Error(`GET /api/devices returned ${response.status}`)
      const body = (await response.json()) as {
        readonly devices?: ReadonlyArray<{ readonly udid?: unknown }>
      }
      const hasStubDevice = body.devices?.some(
        (device) => typeof device.udid === "string" && device.udid.startsWith("stub-"),
      )
      if (hasStubDevice) return
      lastError = new Error("no stub devices registered yet")
    } catch (error) {
      lastError = error
    }

    await Bun.sleep(500)
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`dfarm e2e stack did not become ready: ${String(lastError)}`)
}

const main = async (): Promise<number> => {
  const filter = Bun.argv[2]?.trim()
  let exitCode = 1

  try {
    exitCode = await runStreaming(compose("up", "-d", "--build", "--wait"), { cwd: repoRoot })
    if (exitCode !== 0) return exitCode

    await waitForFarm()

    // Scenarios wait on real scheduling (stub re-registration is one ~5s report
    // cycle, failover spans two full runs); bun's default 5s per-test timeout is
    // far too tight. Waits inside scenarios remain individually bounded.
    exitCode = await runStreaming(["bun", "test", "--timeout", "120000", ...(filter ? [filter] : [])], {
      cwd: e2eRoot,
      env: {
        ...Bun.env,
        DFARM_URL: farmUrl,
      },
    })
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    exitCode = 1
  } finally {
    const downCode = await runStreaming(compose("down", "-v"), { cwd: repoRoot })
    if (exitCode === 0 && downCode !== 0) exitCode = downCode
  }

  return exitCode
}

process.exitCode = await main()
