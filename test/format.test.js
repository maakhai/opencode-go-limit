import test from "node:test"
import assert from "node:assert/strict"

import {
  clampPercent,
  describeSource,
  formatCountdown,
  formatPercent,
  formatResetDate,
  formatUSD,
  meterLevel,
  progressBar,
  progressBarParts,
} from "../src/format.js"

test("clampPercent keeps values in 0..100", () => {
  assert.equal(clampPercent(-5), 0)
  assert.equal(clampPercent(42), 42)
  assert.equal(clampPercent(140), 100)
  assert.equal(clampPercent(Number.NaN), 0)
})

test("formatPercent rounds", () => {
  assert.equal(formatPercent(9.6), "10%")
  assert.equal(formatPercent(0), "0%")
})

test("progressBar fills proportionally and clamps", () => {
  assert.equal(progressBar(0, 5), "░░░░░")
  assert.equal(progressBar(50, 4), "██░░")
  assert.equal(progressBar(100, 4), "████")
  assert.equal(progressBar(130, 4), "████")
  assert.equal(progressBar(3, 14), "█" + "░".repeat(13))
})

test("progressBarParts splits filled and empty segments", () => {
  assert.deepEqual(progressBarParts(0, 5), { filled: "", empty: "░░░░░" })
  assert.deepEqual(progressBarParts(50, 4), { filled: "██", empty: "░░" })
  assert.deepEqual(progressBarParts(130, 4), { filled: "████", empty: "" })
})

test("formatCountdown handles minutes, hours and days", () => {
  const now = Date.parse("2026-10-29T12:00:00Z")
  assert.equal(formatCountdown(now, now + 30 * 60_000), "30m")
  assert.equal(formatCountdown(now, now + (2 * 60 + 15) * 60_000), "2h 15m")
  assert.equal(formatCountdown(now, now + (3 * 24 + 4) * 3_600_000), "3d 4h")
  assert.equal(formatCountdown(now, now - 1), "now")
  assert.equal(formatCountdown(now, undefined), "")
})

test("formatResetDate formats an ISO date", () => {
  const value = formatResetDate("2026-10-30T02:30:00.000Z")
  assert.match(value, /^[A-Z][a-z]{2} \d{2}, \d{2}:\d{2}$/)
})

test("meterLevel uses success, warning and error thresholds", () => {
  assert.equal(meterLevel(10), "success")
  assert.equal(meterLevel(69.9), "success")
  assert.equal(meterLevel(70), "warning")
  assert.equal(meterLevel(89.9), "warning")
  assert.equal(meterLevel(90), "error")
  assert.equal(meterLevel(1, true), "error")
})

test("formatUSD and describeSource", () => {
  assert.equal(formatUSD(1.5), "$1.50")
  assert.equal(formatUSD(undefined), "—")
  assert.equal(describeSource("console"), "Console (server API)")
  assert.equal(describeSource("opencode"), "Console")
  assert.equal(describeSource("opencode-go"), "Go key")
  assert.equal(describeSource(undefined), "unknown")
})
