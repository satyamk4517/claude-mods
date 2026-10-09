# satyam-mods

Two [Claude Code mods](https://code.claude.com/docs/en/plugins/mods) — plugins of function hooks that run inside Claude Code (terminal and the Desktop app's Code tab). Needs Claude Code **2.1.287 or later** (`claude --version`).

| Mod | What it does |
|---|---|
| **blast-guard** | Holds risky shell commands (`rm -r`, `Remove-Item -Recurse`, force push, `git reset --hard`, `git clean -f`, `git checkout .`, `git branch -D`) and asks **Cancel / Run it**, with a dry-run report of what would be lost. Blocks Python heredocs carrying `\1` / `\x..` escapes (they write control characters into files). Refuses a 5th concurrent subagent. |
| **cache-meter** | Status line: prompt-cache hit rate and the 1-hour TTL countdown (context size lives in usage-bar). A toast whenever a request rebuilds the cache instead of reading it, with the token count, the extra cost, and what changed just before (model switch, effort change, idle past the TTL, or a prompt-prefix change). `/cache-meter` prints the session summary. |
| **usage-bar** | One slim row above the prompt with solid bars for context fill and your 5-hour and 7-day plan limits (percent used, time to reset), plus the session cost. Bars are green under 60%, amber from 60%, red from 85%; at 90% the label turns into a bold red **⚠** warning and a toast fires once per reset window. **more** adds plain sentences (used, left, resets); **×** hides it. While subagents run, the row adds agent dots (pulsing while running, ✓ when done) and an **agents** button for savvy-progress's `/agents-info`. `/usage-bar` hides/shows, `/usage-bar details` expands and refreshes. |

## Install

In a Claude Code terminal session:

```
/plugin install blast-guard --marketplace satyamk4517/claude-mods
/plugin install cache-meter --marketplace satyamk4517/claude-mods
/plugin install usage-bar --marketplace satyamk4517/claude-mods
```

Answer `y` to add the marketplace, then pick a scope (user = every project).

## Before you install

Mods run with your permissions and are not sandboxed. Read the two hook files first, or list what they do without running them:

```
claude plugin validate ./blast-guard
claude plugin validate ./cache-meter
claude plugin validate ./usage-bar
```

blast-guard calls `$.process.run` (git dry runs only), `$.ui.ask` and `$.agent.list`. cache-meter calls the clock, status line, toasts and registers one command; it makes no network or file calls. usage-bar calls `$.session.usage` (the status line's own figures, no network request), `$.agent.list`, the clock, its store and toasts, and runs `/agents-info` only when you press **agents**.

## Notes

- cache-meter prices Opus (USD 4 / 20 per MTok) and Sonnet (USD 2 / 10) at list rates, with a 1-hour cache write at 2× input and a read at 0.1×. Other models get token counts only. On a subscription, read the figures as relative weight, not a bill. Edit `PRICES` in `cache-meter/hooks/register.ts` if your rates differ.
- The rebuild reason is what *coincided* with the rebuild, not a proven cause.
- blast-guard reads command text, so a command hidden in `$(...)` or a script file walks past it. Pair it with `deny` permission rules for anything that must never run.
- usage-bar shows the plan limits as Anthropic reports them: a percentage and a reset time. There is no token allowance to show, because the API reports none. The percentage is account-wide, so it includes your other sessions; it fills in after the first reply.
- usage-bar's cost is what `/cost` totals, at API prices; on a subscription treat it as relative weight.
- Tests: `claude plugin test ./blast-guard`, `claude plugin test ./cache-meter` and `claude plugin test ./usage-bar`.
