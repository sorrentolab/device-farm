"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { Logo } from "@/components/logo"
import { realtime } from "@/lib/realtime-client"

const tabs = [
  { href: "/", label: "Devices" },
  { href: "/queue", label: "Queue" },
  { href: "/history", label: "History" },
]

export function Nav() {
  const pathname = usePathname()
  const [live, setLive] = useState(false)
  useEffect(() => realtime.onStatus(setLive), [])

  return (
    <div className="nav">
      <Link href="/" className="brand">
        <Logo size={15} /> device farm
      </Link>
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`tab ${pathname === t.href ? "active" : ""}`}
        >
          {t.label}
        </Link>
      ))}
      <div className="spacer" />
      <div className={`conn ${live ? "live" : ""}`} title="realtime connection">
        <span className="dot" />
        {live ? "live" : "connecting…"}
      </div>
    </div>
  )
}
