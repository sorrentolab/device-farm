import { functions } from "@/inngest/functions"
import { inngest } from "@/inngest/client"
import { serve } from "inngest/next"

export const runtime = "nodejs"

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
})
