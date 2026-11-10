/**
 * Small, dependency-free formatting helpers. They are plain JavaScript so the
 * test suite can run with Node alone (the TUI itself runs under Bun).
 */

/** Clamps a percentage to the 0..100 range, tolerating NaN/Infinity. */
export function clampPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

/** Rounds a percentage for display. */
export function formatPercent(value) {
  return `${Math.round(clampPercent(value))}%`;
}

/** Splits the unicode progress bar into filled and empty segments. */
export function progressBarParts(percent, width = 16) {
  const size = Math.max(1, Math.round(width));
  const clamped = clampPercent(percent);
  const exact = (clamped / 100) * size;
  const filled = clamped > 0 ? Math.max(1, Math.round(exact)) : 0;
  return {
    filled: "━".repeat(filled),
    empty: "─".repeat(size - filled),
  };
}

/** A unicode progress bar; `percent` is clamped to 0..100. */
export function progressBar(percent, width = 16) {
  const { filled, empty } = progressBarParts(percent, width);
  return filled + empty;
}

/**
 * Renders the time until a reset as "2h 15m", "3d 4h", "now".
 * Accepts an epoch in milliseconds, an ISO string, or undefined.
 */
export function formatCountdown(now, resetsAt) {
  if (resetsAt === undefined || resetsAt === null) return "";
  const target =
    typeof resetsAt === "number"
      ? resetsAt
      : typeof resetsAt === "string"
        ? Date.parse(resetsAt)
        : Number.NaN;
  if (!Number.isFinite(target)) return "";

  const remainingMs = target - now;
  if (remainingMs <= 0) return "now";

  const minutes = Math.max(1, Math.round(remainingMs / 60_000));
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const minutePart = minutes % 60;
    return minutePart === 0 ? `${hours}h` : `${hours}h ${minutePart}m`;
  }

  const days = Math.floor(hours / 24);
  const hourPart = hours % 24;
  return hourPart === 0 ? `${days}d` : `${days}d ${hourPart}h`;
}

const resetDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** Formats an epoch (ms) as a short English date/time, e.g. "Oct 30, 02:30". */
export function formatResetDate(value) {
  const target =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : Number.NaN;
  if (!Number.isFinite(target)) return "";
  return resetDateFormatter.format(new Date(target));
}

/**
 * Severity used to color a meter: success below 70%, warning from 70%,
 * error from 90% or when the window is already limited.
 */
export function meterLevel(percent, limited = false) {
  if (limited) return "error";
  const clamped = clampPercent(percent);
  if (clamped >= 90) return "error";
  if (clamped >= 70) return "warning";
  return "success";
}

/** Human-friendly label for the credential/source that answered. */
export function describeSource(source) {
  switch (source) {
    case "console":
      return "Console (server API)";
    case "opencode":
      return "Console";
    case "opencode-go":
      return "Go key";
    case "env":
      return "OPENCODE_API_KEY";
    case "option":
      return "plugin config";
    case "auth":
      return "auth.json";
    default:
      return source || "unknown";
  }
}

/** Formats a USD amount for budgets. */
export function formatUSD(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `$${value.toFixed(2)}`;
}
