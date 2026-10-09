# satyam-mods

Two [Claude Code mods](https://code.claude.com/docs/en/plugins/mods) — plugins of function hooks that run inside Claude Code (terminal and the Desktop app's Code tab). Needs Claude Code **2.1.287 or later** (`claude --version`).

| Mod | What it does |
|---|---|
| **blast-guard** | Holds risky shell commands (`rm -r`, `Remove-Item -Recurse`, force push, `git reset --hard`, `git clean -f`, `git checkout .`, `git branch -D`) and asks **Cancel / Run it**, with a dry-run report of what would be lost. Blocks Python heredocs carrying `\1` / `\x..` escapes (they write control characters into files). Refuses a 5th concurrent subagent. |
| **cache-meter** | Status line: prompt-cache hit rate, context size, 1-hour TTL countdown. A toast whenever a request rebuilds the cache instead of reading it, with the token count, the extra cost, and what changed just before (model switch, effort change, idle past the TTL, or a prompt-prefix change). `/cache-meter` prints the session summary. |

## Install

In a Claude Code terminal session:

```
/plugin install blast-guard --marketplace satyamk4517/claude-mods
/plugin install cache-meter --marketplace satyamk4517/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user = every project).

## Before you install

Mods run with your permissions and are not sandboxed. Read the two hook files first, or list what they do without running them:

```
claude plugin validate ./blast-guard
claude plugin validate ./cache-meter
```

blast-guard calls `$.process.run` (git dry runs only), `$.ui.ask` and `$.agent.list`. cache-meter calls the clock, status line, toasts and registers one command; it makes no network or file calls.

## Notes

- cache-meter prices Opus (USD 4 / 20 per MTok) and Sonnet (USD 2 / 10) at list rates, with a 1-hour cache write at 2× input and a read at 0.1×. Other models get token counts only. On a subscription, read the figures as relative weight, not a bill. Edit `PRICES` in `cache-meter/hooks/register.ts` if your rates differ.
- The rebuild reason is what *coincided* with the rebuild, not a proven cause.
- blast-guard reads command text, so a command hidden in `$(...)` or a script file walks past it. Pair it with `deny` permission rules for anything that must never run.
- Tests: `claude plugin test ./blast-guard` and `claude plugin test ./cache-meter`.
