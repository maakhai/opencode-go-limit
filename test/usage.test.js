import test from "node:test"
import assert from "node:assert/strict"

import {
  UsageError,
  fetchUsageFromCandidates,
  parseConsoleMeters,
  parseGoUsage,
  requestGoUsage,
  snapshotFromConsoleInfo,
  snapshotFromGoUsage,
} from "../src/usage.js"

const GO_BODY = {
  usage: {
    rolling: { status: "ok", percent: 2, resetsAt: "2026-10-30T02:30:13.000Z" },
    weekly: { status: "ok", percent: 9, resetsAt: "2026-11-02T00:00:00.000Z" },
    monthly: { status: "ok", percent: 15, resetsAt: "2026-11-10T17:59:57.000Z" },
  },
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

test("parseGoUsage normalizes ISO reset dates to epoch ms", () => {
  const meters = parseGoUsage(GO_BODY)
  assert.equal(meters.rolling.percent, 2)
  assert.equal(meters.rolling.resetsAt, Date.parse("2026-10-30T02:30:13.000Z"))
  assert.equal(meters.weekly.percent, 9)
  assert.equal(meters.monthly.limited, false)
})

test("parseGoUsage rejects missing windows", () => {
  assert.throws(
    () => parseGoUsage({ usage: { rolling: { percent: 1 } } }),
    (error) => error instanceof UsageError && error.kind === "bad-response",
  )
  assert.throws(() => parseGoUsage({}), UsageError)
})

test("parseGoUsage marks non-ok windows as limited", () => {
  const meters = parseGoUsage({
    usage: {
      rolling: { status: "limited", percent: 100, resetsAt: "2026-10-30T02:30:13.000Z" },
      weekly: { percent: 100 },
      monthly: { percent: 100 },
    },
  })
  assert.equal(meters.rolling.limited, true)
  assert.equal(meters.weekly.limited, true)
  assert.equal(meters.monthly.limited, true)
})

test("parseConsoleMeters accepts the server numeric payload", () => {
  const now = Date.parse("2026-10-29T12:00:00Z")
  const meters = parseConsoleMeters({
    rolling: { percent: 12, limited: false, resetsAt: now + 1000 },
    weekly: { percent: 80, limited: false, resetsAt: now + 2000 },
    monthly: { percent: 100, limited: true, resetsAt: now + 3000 },
  })
  assert.equal(meters.rolling.percent, 12)
  assert.equal(meters.weekly.percent, 80)
  assert.equal(meters.monthly.limited, true)
})

test("snapshotFromConsoleInfo includes workspace and budgets", () => {
  const snapshot = snapshotFromConsoleInfo({
    workspace: { id: "ws_1", name: "azura", usageURL: "https://opencode.ai/console/ws_1" },
    go: {
      rolling: { percent: 2, limited: false, resetsAt: 1 },
      weekly: { percent: 9, limited: false, resetsAt: 2 },
      monthly: { percent: 15, limited: false, resetsAt: 3 },
    },
    budgets: [{ id: "b1", limit: 100, spent: 12, scope: "each", per: "set", coverage: "all", models: [], vendors: [], picked: false, shared: false, resetsAt: 4 }],
  })
  assert.equal(snapshot.source, "console")
  assert.equal(snapshot.workspace.name, "azura")
  assert.equal(snapshot.budgets.length, 1)
  assert.equal(snapshot.go.monthly.percent, 15)
})

test("snapshotFromConsoleInfo returns undefined without a Go section", () => {
  assert.equal(snapshotFromConsoleInfo({ workspace: { id: "ws" }, budgets: [] }), undefined)
  assert.equal(snapshotFromConsoleInfo(null), undefined)
})

test("snapshotFromGoUsage keeps the credential source", () => {
  const meters = parseGoUsage(GO_BODY)
  const snapshot = snapshotFromGoUsage(meters, "opencode")
  assert.equal(snapshot.source, "opencode")
  assert.equal(snapshot.workspace, undefined)
  assert.equal(snapshot.budgets.length, 0)
})

test("requestGoUsage maps authentication and subscription errors", async () => {
  await assert.rejects(
    requestGoUsage("sk-x", {
      fetchImpl: async () => jsonResponse({ error: "expired" }, 401),
    }),
    (error) => error instanceof UsageError && error.kind === "unauthorized",
  )
  await assert.rejects(
    requestGoUsage("sk-x", {
      fetchImpl: async () => jsonResponse({ error: "no plan" }, 403),
    }),
    (error) => error instanceof UsageError && error.kind === "no-subscription",
  )
  await assert.rejects(
    requestGoUsage("sk-x", {
      fetchImpl: async () => new Response("boom", { status: 500 }),
    }),
    (error) => error instanceof UsageError && error.kind === "http" && error.status === 500,
  )
})

test("requestGoUsage sends the bearer token and parses the payload", async () => {
  let seen
  const meters = await requestGoUsage("sk-test", {
    fetchImpl: async (url, init) => {
      seen = { url, init }
      return jsonResponse(GO_BODY)
    },
  })
  assert.equal(seen.url, "https://opencode.ai/zen/go/v1/usage")
  assert.equal(seen.init.headers.Authorization, "Bearer sk-test")
  assert.equal(meters.rolling.percent, 2)
})

test("requestGoUsage rejects insecure non-loopback base URLs", async () => {
  await assert.rejects(
    requestGoUsage("sk-test", {
      baseUrl: "http://example.com/usage",
      fetchImpl: async () => jsonResponse(GO_BODY),
    }),
    (error) => error instanceof UsageError && error.kind === "config",
  )
})

test("fetchUsageFromCandidates falls back after a rejected key", async () => {
  let calls = 0
  const result = await fetchUsageFromCandidates(
    [
      { key: "expired", source: "opencode-go" },
      { key: "live", source: "opencode" },
    ],
    {
      fetchImpl: async (_url, init) => {
        calls++
        return init.headers.Authorization === "Bearer live"
          ? jsonResponse(GO_BODY)
          : jsonResponse({ error: "expired" }, 401)
      },
    },
  )
  assert.equal(calls, 2)
  assert.equal(result.source, "opencode")
  assert.equal(result.go.monthly.percent, 15)
})

test("fetchUsageFromCandidates prefers the no-subscription error", async () => {
  await assert.rejects(
    fetchUsageFromCandidates(
      [
        { key: "a", source: "opencode" },
        { key: "b", source: "opencode-go" },
      ],
      {
        fetchImpl: async (_url, init) =>
          init.headers.Authorization === "Bearer a"
            ? jsonResponse({ error: "no plan" }, 403)
            : jsonResponse({ error: "expired" }, 401),
      },
    ),
    (error) => error instanceof UsageError && error.kind === "no-subscription",
  )
})

test("fetchUsageFromCandidates throws no-key without candidates", async () => {
  await assert.rejects(
    fetchUsageFromCandidates([]),
    (error) => error instanceof UsageError && error.kind === "no-key",
  )
})

test("fetchUsageFromCandidates deduplicates identical keys", async () => {
  let calls = 0
  await fetchUsageFromCandidates(
    [
      { key: "same", source: "opencode" },
      { key: "same", source: "opencode-go" },
    ],
    {
      fetchImpl: async () => {
        calls++
        return jsonResponse(GO_BODY)
      },
    },
  )
  assert.equal(calls, 1)
})
