import { runRepo } from "@/server/run-repo"
import * as Effect from "effect/Effect"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"

const resolveRunArtifactsDir = async (runId: string) => {
  const run = await Effect.runPromise(runRepo.get(runId))
  return run?.artifactsDir ? path.resolve(run.artifactsDir) : null
}

const walk = async (base: string, current = base): Promise<string[]> => {
  const entries = await readdir(current, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const absolute = path.join(current, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walk(base, absolute)))
    } else if (entry.isFile()) {
      files.push(path.relative(base, absolute))
    }
  }
  return files
}

export const listArtifacts = (runId: string) =>
  Effect.tryPromise({
    try: async () => {
      const base = await resolveRunArtifactsDir(runId)
      if (!base) return null
      const info = await stat(base).catch(() => null)
      if (!info?.isDirectory()) return { files: [] }
      return { files: await walk(base) }
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })

export const readArtifact = (runId: string, segments: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: async () => {
      const base = await resolveRunArtifactsDir(runId)
      if (!base) return null
      const target = path.resolve(base, ...segments)
      const relative = path.relative(base, target)
      if (relative.startsWith("..") || path.isAbsolute(relative)) return null
      const info = await stat(target).catch(() => null)
      if (!info?.isFile()) return null
      return readFile(target)
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  })
