# opencode-go-limit

OpenCode (v2) plugin that shows the **OpenCode Go** plan limits in a dialog when
you run `/limit`.

```text
╭──────────────────────────────────────────────────────────────────────────────────────╮
│  OpenCode Go · Plan limits                                                           │
│                                                                                      │
│  ┃                                                                                   │
│  ┃ 5 hours     3% █░░░░░░░░░ resets in 2h 46m  (Oct 29, 23:30)                       │
│  ┃ Weekly      9% █░░░░░░░░░ resets in 3d      (Nov 1, 21:00)                        │
│  ┃ Monthly    15% ██░░░░░░░░ resets in 11d 18h (Nov 10, 14:59)                       │
│  ┃                                                                                   │
│                                                                                      │
│  Workspace   personal                                                                │
│  Source      Console (server API)                                                    │
│  Updated     20:44                                                                   │
│                                                                                      │
│  [r] Refresh   [esc] Close                                                           │
╰──────────────────────────────────────────────────────────────────────────────────────╯
```

- **5 hours**: rolling 5-hour window (20% of the monthly limit)
- **Weekly**: weekly window (50% of the monthly limit)
- **Monthly**: monthly window (100% of the limit)

Each row shows the used percentage, a progress bar, and when the window resets.
The color changes to yellow from 70% and red from 90% (or when the window is
already limited).

## Installation

The plugin is installed at OpenCode's global plugin path:

```
~/.config/opencode/plugins/opencode-go-limit
```

This path is a symlink to `/home/makhai/projetos/opencode-go-limit`, so editing
the repository updates the installed plugin. OpenCode discovers plugin
directories inside `~/.config/opencode/plugins/` automatically; nothing needs to
be declared in `opencode.jsonc`.

For an independent installation (without the symlink), copy the directory to
`~/.config/opencode/plugins/opencode-go-limit`. OpenCode loads the `server` and `tui`
parts declared in `package.json`.

## Usage

In the OpenCode prompt:

```
/limit
```

Shortcuts inside the window:

| Key | Action |
| --- | --- |
| `r` | Fetch the limits again |
| `esc` | Close the window |

Both footer actions are also clickable. The command also appears in the command
palette as **Show OpenCode Go limits**.

## Where the data comes from

The plugin tries, in order:

1. **Official server API** — `GET /api/experimental/usage/limits`, which returns
   the workspace, the three Go windows, and the Console budgets.
2. **Plugin RPC on the server** — resolves the active OpenCode Console
   (`opencode`) or OpenCode Go (`opencode-go`) credential from the credential
   store and queries `GET https://opencode.ai/zen/go/v1/usage` with that key.
3. **Local key** — `OPENCODE_API_KEY` or `~/.local/share/opencode/auth.json`.

Step 2 is what makes the window work even when the server does not yet have a
Console OAuth session but a service account key (`oc_sk_...`) is registered.
Expired keys are skipped and the next one is tried.

If no source works, the window shows the reason for each attempt and asks you to
sign in with `/connect` or configure a Go API key.

## Optional configuration

```jsonc
{
  "plugins": [
    {
      "package": "/home/makhai/projetos/opencode-go-limit",
      "options": {
        "apiKey": "oc_sk_...",          // optional; wins over the other sources
        "baseUrl": "https://opencode.ai/zen/go/v1/usage" // optional; full usage endpoint
      },
    },
  ],
}
```

`baseUrl` only accepts `https` (or `http` on localhost/loopback, for tests).

## Development

The plugin needs no build step: OpenCode loads `src/index.ts` and `src/tui.tsx`
directly. The pure parts (`src/usage.js`, `src/format.js`) are JavaScript so they
can be tested with Node alone.

```sh
node --test test/*.test.js
node scripts/live-check.mjs   # queries the real API using `opencode auth export`
```

Structure:

```
src/index.ts   server part: registers the RPC and resolves the credential
src/tui.tsx    TUI part: /limit command and window
src/rpc.ts     shared RPC contract
src/usage.js   usage endpoint client, normalization, and key fallback
src/format.js  bars, percentages, countdowns, and colors
test/          unit tests and HTTP test with a mock server
```
