/** @jsxImportSource @opentui/solid */
import { For, Show, createSignal, onCleanup } from "solid-js"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import { GoLimitRpc } from "./rpc.js"
import {
  fetchUsageFromCandidates,
  resolveLocalCandidates,
  snapshotFromConsoleInfo,
  snapshotFromGoUsage,
} from "./usage.js"
import {
  describeSource,
  formatCountdown,
  formatPercent,
  formatResetDate,
  meterLevel,
  progressBarParts,
} from "./format.js"

type Meter = {
  percent: number
  resetsAt: number
  limited: boolean
  status?: string
}

type Snapshot = {
  workspace?: { id?: string; name?: string; usageURL?: string }
  go: Record<"rolling" | "weekly" | "monthly", Meter>
  source: string
  fetchedAt: number
}

const WINDOWS: ReadonlyArray<{ key: "rolling" | "weekly" | "monthly"; label: string }> = [
  { key: "rolling", label: "5 hours" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
]

const FETCH_TIMEOUT_MS = 15_000

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const data = (error as Record<string, unknown>).data
    if (data && typeof data === "object") {
      const message = (data as Record<string, unknown>).message
      if (typeof message === "string" && message) return message
    }
    const message = (error as Record<string, unknown>).message
    if (typeof message === "string" && message) return message
  }
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function withDeadline<T>(task: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    task.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Fetches limits using the most reliable source available:
 * 1. the server's official usage-limits endpoint (workspace + budgets),
 * 2. a server RPC that resolves the live Console credential,
 * 3. local env/auth.json keys as a last resort.
 */
async function loadLimits(ctx: Context): Promise<Snapshot> {
  const options = ctx.options as Readonly<Record<string, unknown>>
  const notes: string[] = []

  try {
    const response = await withDeadline(
      ctx.client.experimental.usage.limits(
        ctx.location ? { location: { directory: ctx.location.directory } } : undefined,
      ),
      FETCH_TIMEOUT_MS,
      "The server usage API did not respond",
    )
    const snapshot = snapshotFromConsoleInfo(response.data)
    if (snapshot) return snapshot as Snapshot
    notes.push("Console is not authenticated on the server")
  } catch (error) {
    notes.push(`Server usage API: ${errorMessage(error)}`)
  }

  try {
    const rpc = ctx.client.rpc(GoLimitRpc)
    const result = (await withDeadline(
      rpc.getUsage({}),
      FETCH_TIMEOUT_MS,
      "The plugin server did not respond",
    )) as { go: Snapshot["go"]; source: string }
    return snapshotFromGoUsage(result.go, result.source) as Snapshot
  } catch (error) {
    notes.push(`Plugin server RPC: ${errorMessage(error)}`)
  }

  try {
    const candidates = await resolveLocalCandidates(options)
    const result = await withDeadline(
      fetchUsageFromCandidates(candidates, {
        baseUrl: typeof options.baseUrl === "string" ? options.baseUrl : undefined,
      }),
      FETCH_TIMEOUT_MS,
      "The local limits query did not respond",
    )
    return snapshotFromGoUsage(result.go, result.source) as Snapshot
  } catch (error) {
    notes.push(`Local key: ${errorMessage(error)}`)
  }

  throw new Error(
    `Could not read OpenCode Go limits.\n\n${notes.join("\n")}\n\n` +
      "Sign in to the OpenCode Console with /connect or configure a Go API key.",
  )
}

type DialogTheme = ReturnType<Context["theme"]["surface"]>

function levelColor(theme: DialogTheme, level: "success" | "warning" | "error") {
  return theme.text.feedback[level].base
}

function FooterAction(props: {
  theme: DialogTheme
  keyLabel: string
  label: string
  disabled?: boolean
  onPress: () => void
}) {
  const [hovered, setHovered] = createSignal(false)
  const theme = props.theme

  return (
    <box
      flexDirection="row"
      gap={1}
      paddingLeft={1}
      paddingRight={1}
      onMouseOver={() => setHovered(true)}
      onMouseOut={() => setHovered(false)}
      onMouseUp={() => {
        if (!props.disabled) props.onPress()
      }}
    >
      <text fg={props.disabled ? theme.text.faint : theme.text.base}>
        <b>[{props.keyLabel}]</b>
      </text>
      <text
        fg={
          props.disabled
            ? theme.text.faint
            : hovered()
              ? theme.text.base
              : theme.text.muted
        }
      >
        {props.label}
      </text>
    </box>
  )
}

function LimitsDialog(props: {
  ctx: Context
  snapshot: Snapshot
  now: number
}) {
  const theme = props.ctx.theme.surface("dialog")
  const [snapshot, setSnapshot] = createSignal(props.snapshot)
  const [now, setNow] = createSignal(props.now)
  const [refreshing, setRefreshing] = createSignal(false)
  const [error, setError] = createSignal<string | undefined>(undefined)
  let disposed = false

  onCleanup(() => {
    disposed = true
  })

  async function refresh() {
    if (disposed || refreshing()) return
    setRefreshing(true)
    setError(undefined)
    try {
      const next = await loadLimits(props.ctx)
      if (disposed) return
      setSnapshot(next)
      setNow(Date.now())
    } catch (cause) {
      if (!disposed) setError(errorMessage(cause))
    } finally {
      if (!disposed) setRefreshing(false)
    }
  }

  props.ctx.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "opencode-go-limit.refresh",
        title: "Refresh OpenCode Go limits",
        bind: "r",
        run: () => void refresh(),
      },
    ],
  }))

  const updatedAt = () =>
    new Date(now()).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })

  return (
    <box
      flexDirection="column"
      width="100%"
      backgroundColor={theme.background.base}
      border={true}
      borderStyle="rounded"
      borderColor={theme.border.base}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
      gap={0}
    >
      <text fg={theme.text.base}>
        <b>OpenCode Go · Plan limits</b>
      </text>

      <box flexDirection="column" marginTop={1}>
        <box
          border={["left"]}
          borderColor={theme.text.action.primary.base}
          backgroundColor={theme.background.raised.base}
          paddingLeft={2}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
          flexDirection="column"
        >
          <For each={WINDOWS}>
            {(window) => {
              const meter = () => snapshot().go[window.key]
              const level = () => meterLevel(meter().percent, meter().limited)
              const bar = () => progressBarParts(meter().percent, 10)
              return (
                <box flexDirection="row" gap={1}>
                  <box width={9} flexShrink={0}>
                    <text fg={theme.text.muted}>{window.label}</text>
                  </box>
                  <box width={4} flexShrink={0} justifyContent="flex-end">
                    <text fg={levelColor(theme, level())}>{formatPercent(meter().percent)}</text>
                  </box>
                  <box flexDirection="row" flexShrink={0}>
                    <text fg={levelColor(theme, level())}>{bar().filled}</text>
                    <text fg={theme.text.faint}>{bar().empty}</text>
                  </box>
                  <box flexDirection="row" gap={1}>
                    <text fg={theme.text.muted}>
                      resets in {formatCountdown(now(), meter().resetsAt)}
                    </text>
                    <text fg={theme.text.faint}>({formatResetDate(meter().resetsAt)})</text>
                  </box>
                </box>
              )
            }}
          </For>
        </box>
      </box>

      <box flexDirection="column" marginTop={1}>
        <box flexDirection="row" gap={2}>
          <box width={10} flexShrink={0}>
            <text fg={theme.text.faint}>Workspace</text>
          </box>
          <text fg={theme.text.muted} wrapMode="word">
            {snapshot().workspace?.name || "—"}
          </text>
        </box>
        <box flexDirection="row" gap={2}>
          <box width={10} flexShrink={0}>
            <text fg={theme.text.faint}>Source</text>
          </box>
          <text fg={theme.text.muted} wrapMode="word">
            {describeSource(snapshot().source)}
          </text>
        </box>
        <box flexDirection="row" gap={2}>
          <box width={10} flexShrink={0}>
            <text fg={theme.text.faint}>Updated</text>
          </box>
          <text fg={theme.text.muted}>{updatedAt()}</text>
        </box>
      </box>

      <box minHeight={1} marginTop={1}>
        <Show when={error()}>
          <text fg={theme.text.feedback.error.base} wrapMode="word">
            ✗ {error()}
          </text>
        </Show>
        <Show when={!error() && refreshing()}>
          <text fg={theme.text.feedback.info.base}>⋯ Refreshing limits…</text>
        </Show>
      </box>

      <box flexDirection="row" gap={2} marginTop={1} flexShrink={0}>
        <FooterAction
          theme={theme}
          keyLabel="r"
          label="Refresh"
          disabled={refreshing()}
          onPress={() => void refresh()}
        />
        <FooterAction
          theme={theme}
          keyLabel="esc"
          label="Close"
          onPress={() => props.ctx.ui.dialog.clear()}
        />
      </box>
    </box>
  )
}

function CommandHost(props: { ctx: Context; run: () => void }) {
  props.ctx.keymap.layer(() => ({
    mode: "global",
    priority: 10,
    commands: [
      {
        id: "opencode-go-limit.show",
        title: "Show OpenCode Go limits",
        description: "Open a window with the 5-hour, weekly and monthly Go plan windows",
        group: "OpenCode Go",
        palette: true,
        suggested: true,
        bind: false,
        slash: { name: "limit" },
        run: () => props.run(),
      },
    ],
  }))

  return <box />
}

export default Plugin.define({
  id: "opencode-go-limit",
  setup(ctx) {
    let busy = false

    async function openLimits() {
      if (busy) return
      busy = true
      try {
        const snapshot = await loadLimits(ctx)
        const now = Date.now()
        ctx.ui.dialog.show(() => <LimitsDialog ctx={ctx} snapshot={snapshot} now={now} />)
        // show() resets the size to medium; configure it afterwards.
        ctx.ui.dialog.set({ size: "large", centered: true })
      } catch (error) {
        await ctx.ui.dialog.alert({
          title: "OpenCode Go · Limits",
          message: errorMessage(error),
        })
      } finally {
        busy = false
      }
    }

    const dispose = ctx.ui.slot({
      append: "app",
      render: () => <CommandHost ctx={ctx} run={() => void openLimits()} />,
    })

    return () => dispose()
  },
})
