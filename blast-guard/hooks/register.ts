import type { Register } from 'claude-code'

// Concurrent subagent cap: many parallel agents can exhaust a usage window
// fast; waves of four keep the work flowing without that spike.
const MAX_AGENTS = 4

// Each risky pattern, what it does, and which dry run shows its reach.
type Risk = { pattern: RegExp; what: string; probe?: 'status' | 'clean' | 'push' }
const RISKS: Risk[] = [
  { pattern: /\brm\s+(-\w+\s+)*-\w*[rR]/, what: 'recursive delete (rm -r)' },
  { pattern: /\bRemove-Item\b[^|;\n]*-Recurse/i, what: 'recursive delete (Remove-Item -Recurse)' },
  { pattern: /\b(rd|rmdir)\s+\/s\b|\bdel\s+\/[sq]\b/i, what: 'recursive delete (cmd)' },
  { pattern: /\bgit\s+push\b[^|;&\n]*\s(--force(-with-lease)?|-f)\b/, what: 'force push', probe: 'push' },
  { pattern: /\bgit\s+reset\b[^|;&\n]*--hard\b/, what: 'git reset --hard (drops uncommitted work)', probe: 'status' },
  { pattern: /\bgit\s+clean\b[^|;&\n]*\s-\w*f/, what: 'git clean -f (deletes untracked files)', probe: 'clean' },
  { pattern: /\bgit\s+(checkout|restore)\b[^|;&\n]*\s(--\s+)?\.(\s|$)/, what: 'discard all working-tree changes', probe: 'status' },
  { pattern: /\bgit\s+branch\s+(-\w+\s+)*-D\b/, what: 'force-delete a branch' },
]

// A Python heredoc with a \1 or \x.. escape lands control
// characters in files. Plain \n is harmless and passes.
const HEREDOC = /python[^\n]*<</
const BAD_ESCAPE = /\\(\d|x[0-9a-fA-F])/

const firstLines = (text: string, n: number) => {
  const lines = text.trim().split('\n').filter(Boolean)
  if (lines.length === 0) return '  (nothing)'
  const shown = lines.slice(0, n).map(l => '  ' + l)
  return shown.join('\n') + (lines.length > n ? `\n  … and ${lines.length - n} more` : '')
}

type Git = (args: string[]) => Promise<string>

// What the dry run says the command would touch.
const report = async (git: Git, probe: Risk['probe']) => {
  if (probe === 'status') return 'Uncommitted changes that would be lost:\n' + firstLines(await git(['status', '--porcelain']), 10)
  if (probe === 'clean') return 'Files git clean would delete:\n' + firstLines(await git(['clean', '-n', '-d']), 10)
  if (probe === 'push') {
    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
    return `Branch: ${branch}\nRemote commits that would be overwritten:\n` + firstLines(await git(['log', '--oneline', 'HEAD..@{u}']), 10)
  }
  return ''
}

const commandOf = (e: unknown) => String((e as { command?: unknown }).command ?? '')

export const register: Register = on => {
  for (const tool of ['Bash', 'PowerShell'] as const) {
    on('tool.call', { tool }, async ($, e, next) => {
      const command = commandOf(e)

      if (HEREDOC.test(command) && BAD_ESCAPE.test(command)) {
        return {
          deny: 'blast-guard: Python heredoc contains a backslash escape (\\1 or \\x..). Write the script with the Write tool and run the file instead.',
        }
      }

      const hits = RISKS.filter(r => r.pattern.test(command))
      if (hits.length === 0) return next(e)

      const git: Git = async args => {
        try {
          const r = await $.process.run(['git', ...args], { timeoutMs: 10_000 })
          return r.exitCode === 0 ? r.stdout : `(git ${args[0]} failed: ${r.stderr.trim().slice(0, 120)})`
        } catch {
          return '(git not reachable here)'
        }
      }
      const reach = (await Promise.all([...new Set(hits.map(h => h.probe))].map(p => report(git, p)))).filter(Boolean)
      const question = [
        `Risky ${tool} command: ${hits.map(h => h.what).join('; ')}.`,
        `  ${command.length > 200 ? command.slice(0, 200) + '…' : command}`,
        ...reach,
        'Run it?',
      ].join('\n')

      let answer = ''
      try {
        answer = await $.ui.ask(question, { header: 'Blast radius', options: ['Cancel', 'Run it'] })
      } catch {
        return { deny: 'blast-guard: no one could confirm this risky command, so it was not run.' }
      }
      return answer === 'Run it'
        ? next(e)
        : { deny: `blast-guard: the user declined (${hits.map(h => h.what).join('; ')}). Ask them how to proceed.` }
    }).catch(($, e, next) =>
      next.called ? next(e) : { deny: 'blast-guard: the guard failed, so the command was held. Ask the user.' },
    )
  }

  on('tool.call', { tool: 'Agent' }, async ($, e, next) => {
    const live = (await $.agent.list()).filter(a => a.status === 'running' || a.status === 'pending')
    if (live.length >= MAX_AGENTS) {
      return {
        deny: `blast-guard: ${live.length} agents are already running (cap ${MAX_AGENTS}). Wait for one to finish, or run the rest as a second wave.`,
      }
    }
    return next(e)
    // The cap is about spend, not safety: if the count fails, let the agent run.
  }).catch(($, e, next) => next(e))
}
