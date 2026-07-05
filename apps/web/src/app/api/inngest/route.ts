import { functions } from "@/inngest/functions"
import { inngest } from "@/inngest/client"
import { serve } from "inngest/next"

export const runtime = "nodejs"

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
  // The Inngest dev server runs in docker; it must call back into this app via a
  // URL reachable from inside the container, not the localhost URL registration sees.
  serveOrigin: process.env.INNGEST_SERVE_HOST,
})
