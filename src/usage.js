import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

/**
 * OpenCode Go exposes an official usage endpoint used by the Console
 * dashboard: GET https://opencode.ai/zen/go/v1/usage
 * It accepts the OpenCode Console "service account" key (oc_sk_...) or a Go
 * API key (sk-...) and returns the three subscription windows.
 */
export const GO_USAGE_URL = "https://opencode.ai/zen/go/v1/usage"
export const DEFAULT_TIMEOUT_MS = 12_000
export const WINDOW_KEYS = ["rolling", "weekly", "monthly"]

export class UsageError extends Error {
  /** @param {"no-key" | "config" | "unauthorized" | "no-subscription" | "bad-response" | "network" | "http"} kind */
  constructor(kind, message, status) {
    super(message)
    this.name = "UsageError"
    this.kind = kind
    this.status = status
  }
}

/** @param {unknown} value */
function clampPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, value))
}

/**
 * Normalizes one meter from either the Console API (numeric epoch) or the Go
 * usage API (ISO date string).
 */
function normalizeMeter(raw) {
  if (!raw || typeof raw !== "object") return undefined
  const source = /** @type {Record<string, unknown>} */ (raw)
  const percent = clampPercent(source.percent)
  const resetsAt =
    typeof source.resetsAt === "number"
      ? source.resetsAt
      : typeof source.resetsAt === "string"
        ? Date.parse(source.resetsAt)
        : Number.NaN
  const status = typeof source.status === "string" ? source.status : undefined
  const limited =
    source.limited === true ||
    percent >= 100 ||
    (typeof status === "string" && status !== "ok")

  return {
    percent,
    resetsAt: Number.isFinite(resetsAt) ? resetsAt : Date.now(),
    limited,
    ...(status === undefined ? {} : { status }),
  }
}

/** Parses the body of `GET /zen/go/v1/usage`. */
export function parseGoUsage(body) {
  const usage =
    body && typeof body === "object" && /** @type {Record<string, unknown>} */ (body).usage
  if (!usage || typeof usage !== "object") {
    throw new UsageError("bad-response", "Invalid OpenCode Go usage response")
  }

  /** @type {Record<string, ReturnType<typeof normalizeMeter>>} */
  const meters = {}
  for (const key of WINDOW_KEYS) {
    const meter = normalizeMeter(/** @type {Record<string, unknown>} */ (usage)[key])
    if (!meter) {
      throw new UsageError("bad-response", `Window "${key}" is missing from the Go response`)
    }
    meters[key] = meter
  }
  return meters
}

/** Parses the `go` field of `GET /api/experimental/usage/limits`. */
export function parseConsoleMeters(go) {
  if (!go || typeof go !== "object") return undefined
  /** @type {Record<string, ReturnType<typeof normalizeMeter>>} */
  const meters = {}
  for (const key of WINDOW_KEYS) {
    const meter = normalizeMeter(/** @type {Record<string, unknown>} */ (go)[key])
    if (!meter) return undefined
    meters[key] = meter
  }
  return meters
}

/**
 * Builds the snapshot rendered by the TUI from the server usage-limits
 * endpoint payload (`UsageLimits.Info`).
 */
export function snapshotFromConsoleInfo(info, now = Date.now()) {
  if (!info || typeof info !== "object") return undefined
  const go = parseConsoleMeters(/** @type {Record<string, unknown>} */ (info).go)
  if (!go) return undefined
  const workspace =
    info.workspace && typeof info.workspace === "object" ? info.workspace : undefined
  const budgets = Array.isArray(info.budgets) ? info.budgets : []

  return {
    workspace,
    go,
    budgets,
    source: "console",
    fetchedAt: now,
  }
}

/** Builds a snapshot from the direct Go usage endpoint result. */
export function snapshotFromGoUsage(meters, source, now = Date.now()) {
  return {
    workspace: undefined,
    go: meters,
    budgets: [],
    source,
    fetchedAt: now,
  }
}

/**
 * Requests the Go usage endpoint with one API key.
 *
 * @param {string} apiKey
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch, signal?: AbortSignal, timeoutMs?: number }} [options]
 */
export async function requestGoUsage(apiKey, options = {}) {
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    throw new UsageError("no-key", "No OpenCode Go API key found")
  }

  const baseUrl = assertSecureBaseUrl(stripTrailingSlashes(options.baseUrl?.trim() || GO_USAGE_URL))
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs =
    typeof options.timeoutMs === "number" && options.timeoutMs > 0
      ? options.timeoutMs
      : DEFAULT_TIMEOUT_MS

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const forwardAbort = () => controller.abort()
  options.signal?.addEventListener("abort", forwardAbort, { once: true })

  try {
    const response = await fetchImpl(baseUrl, {
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        Accept: "application/json",
      },
      redirect: "error",
      signal: controller.signal,
    })

    if (response.status === 401) {
      throw new UsageError("unauthorized", "OpenCode Go API key rejected (HTTP 401)", 401)
    }
    if (response.status === 403) {
      throw new UsageError(
        "no-subscription",
        "This account does not have an active OpenCode Go subscription (HTTP 403)",
        403,
      )
    }
    if (!response.ok) {
      throw new UsageError(
        "http",
        `OpenCode Go usage endpoint returned HTTP ${response.status}`,
        response.status,
      )
    }

    let body
    try {
      body = await response.json()
    } catch {
      throw new UsageError("bad-response", "OpenCode Go usage response is not valid JSON")
    }

    return parseGoUsage(body)
  } catch (error) {
    if (error instanceof UsageError) throw error
    const message = timedOut
      ? `OpenCode Go did not respond within ${timeoutMs}ms`
      : options.signal?.aborted
        ? "Limits query cancelled"
        : `Could not reach ${baseUrl}`
    throw new UsageError("network", message)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener("abort", forwardAbort)
  }
}

/**
 * Tries candidates in order. Authentication failures move on to the next key;
 * any other failure (network, malformed response) is returned immediately.
 *
 * @param {Array<{ key: string, source: string }>} candidates
 * @param {{ baseUrl?: string, fetchImpl?: typeof fetch, signal?: AbortSignal, timeoutMs?: number }} [options]
 */
export async function fetchUsageFromCandidates(candidates, options = {}) {
  const unique = dedupeCandidates(candidates)
  if (unique.length === 0) {
    throw new UsageError(
      "no-key",
      "No OpenCode Go/Console API key found. Sign in with /connect or set OPENCODE_API_KEY.",
    )
  }

  /** @type {UsageError | undefined} */
  let best
  for (const candidate of unique) {
    try {
      const go = await requestGoUsage(candidate.key, options)
      return { go, source: candidate.source }
    } catch (error) {
      if (!(error instanceof UsageError)) throw error
      if (error.kind === "unauthorized" || error.kind === "no-subscription") {
        if (!best || (best.kind === "unauthorized" && error.kind === "no-subscription")) {
          best = error
        }
        continue
      }
      throw error
    }
  }
  throw best
}

/** @param {Array<{ key: string, source: string }>} candidates */
export function dedupeCandidates(candidates) {
  /** @type {Set<string>} */
  const seen = new Set()
  /** @type {Array<{ key: string, source: string }>} */
  const unique = []
  for (const candidate of candidates) {
    if (!candidate || typeof candidate.key !== "string") continue
    const key = candidate.key.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push({ key, source: candidate.source })
  }
  return unique
}

/**
 * Resolves keys available to the server plugin, preferring the live
 * credential store over the legacy auth.json file.
 *
 * @param {{ integration?: { connection?: { active?: (id: string) => Promise<unknown>, resolve?: (connection: unknown) => Promise<unknown> } } }} ctx
 * @param {Readonly<Record<string, unknown>>} [options]
 */
export async function resolveServerCandidates(ctx, options = {}) {
  /** @type {Array<{ key: string, source: string }>} */
  const candidates = []

  if (typeof options.apiKey === "string" && options.apiKey.trim()) {
    candidates.push({ key: options.apiKey.trim(), source: "option" })
  }
  if (typeof process.env.OPENCODE_API_KEY === "string" && process.env.OPENCODE_API_KEY.trim()) {
    candidates.push({ key: process.env.OPENCODE_API_KEY.trim(), source: "env" })
  }

  for (const integrationID of ["opencode", "opencode-go"]) {
    try {
      const connection = await ctx.integration?.connection?.active?.(integrationID)
      if (!connection) continue
      const credential = await ctx.integration?.connection?.resolve?.(connection)
      if (!credential || typeof credential !== "object") continue
      if (credential.type === "key" && typeof credential.key === "string") {
        candidates.push({ key: credential.key, source: integrationID })
      } else if (credential.type === "oauth" && typeof credential.access === "string") {
        candidates.push({ key: credential.access, source: integrationID })
      }
    } catch {
      // A broken credential must not prevent the other sources from being tried.
    }
  }

  candidates.push(...(await resolveLocalCandidates()))
  return dedupeCandidates(candidates)
}

/**
 * Resolves keys available to the TUI process: explicit env, then auth.json.
 */
export async function resolveLocalCandidates(options = {}) {
  /** @type {Array<{ key: string, source: string }>} */
  const candidates = []

  if (typeof options.apiKey === "string" && options.apiKey.trim()) {
    candidates.push({ key: options.apiKey.trim(), source: "option" })
  }
  if (typeof process.env.OPENCODE_API_KEY === "string" && process.env.OPENCODE_API_KEY.trim()) {
    candidates.push({ key: process.env.OPENCODE_API_KEY.trim(), source: "env" })
  }

  const auth = await readAuthFile()
  if (auth) {
    for (const integrationID of ["opencode", "opencode-go"]) {
      const entry = auth[integrationID]
      if (!entry || typeof entry !== "object") continue
      const key =
        typeof entry.key === "string"
          ? entry.key
          : typeof entry.apiKey === "string"
            ? entry.apiKey
            : undefined
      if (key && key.trim()) candidates.push({ key: key.trim(), source: integrationID })
    }
  }

  return dedupeCandidates(candidates)
}

function stripTrailingSlashes(value) {
  return value.replace(/\/+$/, "")
}

function assertSecureBaseUrl(baseUrl) {
  let parsed
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new UsageError("config", `Invalid usage URL: "${baseUrl}"`)
  }
  if (parsed.protocol === "https:") return baseUrl
  if (parsed.protocol === "http:") {
    const host = parsed.hostname.toLowerCase()
    if (host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host)) {
      return baseUrl
    }
  }
  throw new UsageError(
    "config",
    "The usage URL must use https; http is only allowed for localhost/loopback",
  )
}

function authFilePath() {
  if (process.env.OPENCODE_AUTH_JSON?.trim()) return process.env.OPENCODE_AUTH_JSON.trim()
  const home = homedir()
  switch (process.platform) {
    case "win32":
      return join(process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "opencode", "auth.json")
    case "darwin":
      return join(home, "Library", "Application Support", "opencode", "auth.json")
    default:
      return join(
        process.env.XDG_DATA_HOME?.trim() || join(home, ".local", "share"),
        "opencode",
        "auth.json",
      )
  }
}

async function readAuthFile() {
  try {
    const raw = await readFile(authFilePath(), "utf8")
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === "object" ? parsed : undefined
  } catch {
    return undefined
  }
}
