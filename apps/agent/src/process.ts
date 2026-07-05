import type { CommandOutput, CommandResult } from "./types.js"

const decoder = new TextDecoder()

export type SpawnOptions = {
  readonly cwd?: string
  readonly env?: Record<string, string>
}

export class ProcessRunner {
  spawn(argv: ReadonlyArray<string>, options: SpawnOptions = {}): Bun.ReadableSubprocess {
    return Bun.spawn([...argv], {
      cwd: options.cwd,
      env: options.env ? { ...Bun.env, ...options.env } : Bun.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })
  }

  async collect(argv: ReadonlyArray<string>, options: SpawnOptions = {}): Promise<CommandOutput> {
    const proc = this.spawn(argv, options)
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).arrayBuffer(),
      new Response(proc.stderr).arrayBuffer(),
      proc.exited,
    ])

    return {
      exitCode,
      stdout: new Uint8Array(stdout),
      stderr: new Uint8Array(stderr),
    }
  }

  async collectText(argv: ReadonlyArray<string>, options: SpawnOptions = {}): Promise<CommandResult> {
    const result = await this.collect(argv, options)
    return {
      exitCode: result.exitCode,
      stdout: decoder.decode(result.stdout),
      stderr: decoder.decode(result.stderr),
    }
  }
}

export const linesFromStream = async (
  stream: ReadableStream<Uint8Array> | null,
  onLine: (line: string) => void,
): Promise<void> => {
  if (!stream) return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ""

  for (;;) {
    const read = await reader.read()
    if (read.done) break
    buffered += decoder.decode(read.value, { stream: true })
    for (;;) {
      const newline = buffered.search(/\r?\n/)
      if (newline === -1) break
      const line = buffered.slice(0, newline)
      buffered = buffered.slice(buffered[newline] === "\r" ? newline + 2 : newline + 1)
      if (line.length > 0) onLine(line)
    }
  }

  buffered += decoder.decode()
  if (buffered.length > 0) onLine(buffered)
}
