import { Plugin } from "@opencode/plugin"
import { GoLimitRpc } from "./rpc.js"
import { UsageError, fetchUsageFromCandidates, resolveServerCandidates } from "./usage.js"

export default Plugin.define({
  id: "opencode-go-limit",
  async setup(ctx) {
    const registration = await ctx.rpc.register(GoLimitRpc, {
      getUsage: async (input, context) => {
        const parsed = (input ?? {}) as { baseUrl?: unknown }
        const options = ctx.options as Readonly<Record<string, unknown>>
        const baseUrl =
          typeof parsed.baseUrl === "string"
            ? parsed.baseUrl
            : typeof options.baseUrl === "string"
              ? options.baseUrl
              : undefined

        try {
          const candidates = await resolveServerCandidates(ctx, options)
          const result = await fetchUsageFromCandidates(candidates, {
            baseUrl,
            signal: context.signal,
          })
          return result
        } catch (error) {
          if (error instanceof UsageError) {
            return context.error(error.kind, error.message, {
              message: error.message,
              ...(typeof error.status === "number" ? { status: error.status } : {}),
            })
          }
          const message = error instanceof Error ? error.message : String(error)
          return context.error("network", message, { message })
        }
      },
    })

    return () => registration.dispose()
  },
})
