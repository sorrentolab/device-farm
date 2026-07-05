import { inngest } from "@/inngest/client"

export const sendInngestEvent = async (name: string, data: Record<string, unknown>) => {
  await inngest.send({ name, data })
}
