"use client"

import Link from "next/link"
import type { Device } from "@dfarm/shared"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { Screen } from "@/components/devices/screen"

/** Compact card shown in the live-view strip for watched devices only. */
export function LiveCard({ device, frame }: { device: Device; frame: string | null }) {
  const interactive = device.currentLeaseKind === "interactive"
  return (
    <div className="border border-border bg-card flex flex-col">
      <Screen device={device} frame={frame} />
      <div className="flex items-center gap-2 border-t border-border px-2.5 py-2">
        <span className="truncate text-[13px] font-semibold">{device.name}</span>
        {device.currentJobId && (
          <Link
            href={`/jobs/${device.currentJobId}`}
            className="mono shrink-0 text-xs"
            title={interactive ? "held interactively" : "running job"}
          >
            {device.currentJobId.slice(0, 8)}
          </Link>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto h-6 shrink-0 px-2 text-xs text-muted-foreground"
          onClick={() => api.setWatched(device.id, false)}
        >
          stop
        </Button>
      </div>
    </div>
  )
}
