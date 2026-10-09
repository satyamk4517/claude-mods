import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { PlanItem, Progress } from '../types'

const EMPTY: Progress = { plan: [], isRunning: false, startedAt: 0, now: 0, steps: 0, tools: 0, edits: 0, alert: null }
const progress = atom({ plugin: 'savvy-progress', key: 'progress' } as const, EMPTY)
const isHidden = atom({ plugin: 'savvy-progress', key: 'isHidden' } as const, false)

// Two failed attempts at the same target means the diagnosis is wrong, not
// the patch; one file edited this often in one turn is churn.
const FAILS_TO_ALERT = 2
const EDITS_TO_ALERT = 4
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])

const duration = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const short = (text: string, n: number) => (text.length > n ? text.slice(0, n - 1) + '…' : text)
const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path

// What a failed call was aimed at, so repeats of the same attempt match.
const targetOf = (tool: string, input: Record<string, unknown>) => {
  if (typeof input.file_path === 'string') return `${tool} ${baseName(input.file_path)}`
  if (typeof input.command === 'string') return `${tool} \`${short(input.command.trim().split('\n')[0] ?? '', 50)}\``
  return tool
}

export const register: Register = on => {
  // Per-turn counters the band does not draw; reset on each prompt.
  let failures = new Map<string, number>()
  let editsByFile = new Map<string, number>()

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'savvy', description: 'Show or hide the savvy-progress band above the prompt.' })
    $.clock.every(5000, () => update($, progress, p => (p.isRunning ? { ...p, now: Date.now() } : p)))
    return next(e)
  })

  on('command.run', { command: 'savvy' }, async $ => {
    await update($, isHidden, h => !h)
    const hidden = await read($, isHidden)
    return { text: hidden ? 'savvy-progress hidden. /savvy shows it again.' : 'savvy-progress shown.' }
  })

  on('prompt.submit', async ($, e, next) => {
    failures = new Map()
    editsByFile = new Map()
    const now = await $.clock.now()
    await update($, progress, p => ({ ...p, isRunning: true, startedAt: now, now, steps: 0, tools: 0, edits: 0, alert: null }))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const res = yield* next(e)
    if (e.agentId === undefined) await update($, progress, p => ({ ...p, steps: p.steps + 1 }))
    return res
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    if (e.agentId === undefined) {
      const now = await $.clock.now()
      await update($, progress, p => ({ ...p, isRunning: false, now }))
    }
    return res
  })

  on('tool.call', async ($, e, next) => {
    const res = await next(e)
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const ok = res.deny === undefined && res.isError !== true
    const result = (res.result ?? {}) as Record<string, unknown>

    let alert: string | null = null
    let plan: ((plan: PlanItem[]) => PlanItem[]) | null = null
    let edited = 0

    if (ok && tool === 'TodoWrite' && Array.isArray(input.todos)) {
      const todos = input.todos as { content: string; status: PlanItem['status']; activeForm?: string }[]
      plan = () => todos.map((t, i) => ({ id: `todo-${i}`, subject: t.content, status: t.status, active: t.activeForm }))
    }
    if (ok && tool === 'TaskCreate') {
      const task = (result.task ?? {}) as { id?: string; subject?: string }
      if (task.id) {
        const item: PlanItem = { id: task.id, subject: task.subject ?? String(input.subject ?? ''), status: 'pending', active: input.activeForm as string | undefined }
        plan = p => [...p.filter(x => x.id !== item.id), item]
      }
    }
    if (ok && tool === 'TaskUpdate' && typeof input.taskId === 'string') {
      const id = input.taskId
      const status = input.status as PlanItem['status'] | 'deleted' | undefined
      plan = p =>
        status === 'deleted'
          ? p.filter(x => x.id !== id)
          : p.map(x =>
              x.id === id
                ? {
                    ...x,
                    status: status ?? x.status,
                    subject: (input.subject as string | undefined) ?? x.subject,
                    active: (input.activeForm as string | undefined) ?? x.active,
                  }
                : x,
            )
    }

    if (ok && EDIT_TOOLS.has(tool) && typeof input.file_path === 'string') {
      edited = 1
      const file = baseName(input.file_path)
      const n = (editsByFile.get(file) ?? 0) + 1
      editsByFile.set(file, n)
      if (n === EDITS_TO_ALERT) alert = `${file} edited ${n} times this turn. Is the approach converging?`
    }

    if (res.isError === true) {
      const key = targetOf(tool, input)
      const n = (failures.get(key) ?? 0) + 1
      failures.set(key, n)
      if (n === FAILS_TO_ALERT) alert = `${n} failed attempts at ${key}. Test the assumption underneath before patching again.`
    }

    await update($, progress, p => ({
      ...p,
      plan: plan ? plan(p.plan) : p.plan,
      tools: p.tools + 1,
      edits: p.edits + edited,
      alert: alert ?? p.alert,
    }))
    if (alert) $.ui.toast(alert, { timeoutMs: 8000 })
    return res
  })
    // An observer: if counting fails, the call's own result still stands.
    .catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const p = await read($, progress)
    const quiet = e.props.hasSurvey || (await read($, isHidden)) || (p.plan.length === 0 && p.tools === 0 && p.steps === 0 && p.alert === null)
    if (quiet) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const width = Math.max(20, (e.props.bodyColumns ?? 80) - 12)

    const done = p.plan.filter(x => x.status === 'completed').length
    const current = p.plan.find(x => x.status === 'in_progress')
    const cells = 10
    const filled = p.plan.length ? Math.round((cells * done) / p.plan.length) : 0
    const bar = '▰'.repeat(filled) + '▱'.repeat(cells - filled)
    const planLine =
      p.plan.length === 0
        ? null
        : done === p.plan.length
          ? `✓ ${done}/${p.plan.length} done`
          : `${bar} ${done}/${p.plan.length}${current ? ' · now: ' + (current.active ?? current.subject) : ''}`

    const elapsed = duration(p.now - p.startedAt)
    const stats = [plural(p.steps, 'request'), plural(p.tools, 'tool'), plural(p.edits, 'edit')].join(' · ')
    const statsLine = p.steps + p.tools === 0 ? null : `${p.isRunning ? '⏱ ' + elapsed : 'last turn ' + elapsed} · ${stats}`

    return (
      <Box flexDirection="column">
        {planLine && <Text wrap="truncate-end">{short(planLine, width)}</Text>}
        <Box>
          {statsLine && <Text dimColor wrap="truncate-end">{short(statsLine, width)} </Text>}
          <Button key="hide" label="Hide" plain onPress={() => update($, isHidden, () => true)} />
        </Box>
        {p.alert && <Text color="yellow" wrap="truncate-end">⚠ {short(p.alert, width)}</Text>}
      </Box>
    )
  })
}
