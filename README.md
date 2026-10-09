# satyam-mods

Two [Claude Code mods](https://code.claude.com/docs/en/plugins/mods) — plugins of function hooks that run inside Claude Code (terminal and the Desktop app's Code tab). Needs Claude Code **2.1.287 or later** (`claude --version`).

| Mod | What it does |
|---|---|
| **blast-guard** | Holds risky shell commands (`rm -r`, `Remove-Item -Recurse`, force push, `git reset --hard`, `git clean -f`, `git checkout .`, `git branch -D`) and asks **Cancel / Run it**, with a dry-run report of what would be lost. Blocks Python heredocs carrying `\1` / `\x..` escapes (they write control characters into files). Refuses a 5th concurrent subagent. |
| **cache-tax** | Status line: prompt-cache hit rate, context size, 1-hour TTL countdown. A toast whenever a request rebuilds the cache instead of reading it, with the token count, the extra cost, and what changed just before (model switch, effort change, idle past the TTL, or a prompt-prefix change). `/cache-tax` prints the session summary. |
| **savvy-progress** | A band above the prompt: a progress bar built from Claude's todo/task list with the step it is on now; live turn stats (elapsed, requests, tool calls, edits); and a stall alarm when the same command or file fails twice, or one file is edited 4+ times in a turn. `/savvy` hides or shows it. |

## Install

In a Claude Code terminal session:

```
/plugin install blast-guard --marketplace satyamk4517/claude-mods
/plugin install cache-tax --marketplace satyamk4517/claude-mods
/plugin install savvy-progress --marketplace satyamk4517/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user = every project).

## Before you install

Mods run with your permissions and are not sandboxed. Read the two hook files first, or list what they do without running them:

```
claude plugin validate ./blast-guard
claude plugin validate ./cache-tax
```

blast-guard calls `$.process.run` (git dry runs only), `$.ui.ask` and `$.agent.list`. cache-tax calls the clock, status line, toasts and registers one command; it makes no network or file calls.

## Notes

- cache-tax prices Opus (USD 4 / 20 per MTok) and Sonnet (USD 2 / 10) at list rates, with a 1-hour cache write at 2× input and a read at 0.1×. Other models get token counts only. On a subscription, read the figures as relative weight, not a bill. Edit `PRICES` in `cache-tax/hooks/register.ts` if your rates differ.
- The rebuild reason is what *coincided* with the rebuild, not a proven cause.
- blast-guard reads command text, so a command hidden in `$(...)` or a script file walks past it. Pair it with `deny` permission rules for anything that must never run.
- Tests: `claude plugin test ./blast-guard` and `claude plugin test ./cache-tax`.
