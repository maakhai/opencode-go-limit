import { Rpc } from "@opencode/plugin/rpc"

const meterSchema = {
  type: "object",
  properties: {
    percent: { type: "number" },
    resetsAt: { type: "number" },
    limited: { type: "boolean" },
    status: { type: "string" },
  },
  required: ["percent", "resetsAt", "limited"],
  additionalProperties: false,
} as const

const errorSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
    status: { type: "number" },
  },
  required: ["message"],
  additionalProperties: false,
} as const

/**
 * Server-side contract used by the TUI part. The server resolves the live
 * OpenCode Console/Go credential, which the TUI cannot read from the
 * credential store, and calls the official Go usage endpoint.
 */
export const GoLimitRpc = Rpc.define({
  id: "opencode-go-limit",
  methods: {
    getUsage: {
      input: {
        type: "object",
        properties: {
          baseUrl: { type: "string" },
        },
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          go: {
            type: "object",
            properties: {
              rolling: meterSchema,
              weekly: meterSchema,
              monthly: meterSchema,
            },
            required: ["rolling", "weekly", "monthly"],
            additionalProperties: false,
          },
          source: { type: "string" },
        },
        required: ["go", "source"],
        additionalProperties: false,
      },
      errors: {
        "no-key": errorSchema,
        config: errorSchema,
        unauthorized: errorSchema,
        "no-subscription": errorSchema,
        "bad-response": errorSchema,
        network: errorSchema,
        http: errorSchema,
      },
    },
  },
  events: {},
})
