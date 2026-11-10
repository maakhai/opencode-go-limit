import test from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"

import { requestGoUsage } from "../src/usage.js"

const GO_BODY = JSON.stringify({
  usage: {
    rolling: { status: "ok", percent: 7, resetsAt: "2026-10-30T02:30:13.000Z" },
    weekly: { status: "ok", percent: 21, resetsAt: "2026-11-02T00:00:00.000Z" },
    monthly: { status: "ok", percent: 42, resetsAt: "2026-11-10T17:59:57.000Z" },
  },
})

test("requestGoUsage talks to a real HTTP endpoint", async (t) => {
  let authorization

  const server = createServer((request, response) => {
    authorization = request.headers.authorization
    response.writeHead(200, { "content-type": "application/json" })
    response.end(GO_BODY)
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))

  const address = server.address()
  assert.ok(address && typeof address === "object")

  const meters = await requestGoUsage("sk-local", {
    baseUrl: `http://127.0.0.1:${address.port}`,
  })

  assert.equal(authorization, "Bearer sk-local")
  assert.equal(meters.rolling.percent, 7)
  assert.equal(meters.weekly.percent, 21)
  assert.equal(meters.monthly.percent, 42)
})
