import type { Metadata } from "next"
import type { ReactNode } from "react"
import { Nav } from "@/components/nav"
import "./globals.css"

export const metadata: Metadata = {
  title: "device farm",
  description: "Shared iOS/Android device orchestrator",
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  )
}
