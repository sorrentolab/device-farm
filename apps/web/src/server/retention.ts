import { runs } from "@/db/schema"
import { getDb } from "@/server/db"
import { effectify } from "@/server/effect"
import { and, eq, isNotNull, lt } from "drizzle-orm"
import { rm } from "node:fs/promises"
import path from "node:path"

const DEFAULT_RETENTION_DAYS = 14

export const artifactRetentionDays = (): number => {
  const parsed = Number(process.env.DFARM_ARTIFACT_RETENTION_DAYS)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RETENTION_DAYS
}

/**
 * Delete the artifact directories of runs that finished before the retention
 * cutoff and null out runs.artifacts_dir so the artifacts API 404s cleanly.
 * Bounded per tick; anything beyond the batch is picked up on the next cron.
 */
export const pruneArtifacts = (retentionDays: number = artifactRetentionDays()) =>
  effectify(async () => {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000)
    const prunable = await getDb()
      .select({ id: runs.id, artifactsDir: runs.artifactsDir })
      .from(runs)
      .where(
        and(
          isNotNull(runs.artifactsDir),
          isNotNull(runs.finishedAt),
          lt(runs.finishedAt, cutoff),
        ),
      )
      .limit(500)

    let pruned = 0
    for (const row of prunable) {
      if (!row.artifactsDir) continue
      const dir = path.resolve(row.artifactsDir)
      // Refuse to rm anything that doesn't look like a per-run directory (e.g. "/" or "/artifacts").
      if (dir.split(path.sep).filter(Boolean).length < 2) continue
      await rm(dir, { force: true, recursive: true })
      await getDb().update(runs).set({ artifactsDir: null }).where(eq(runs.id, row.id))
      pruned += 1
    }
    return { pruned }
  })
