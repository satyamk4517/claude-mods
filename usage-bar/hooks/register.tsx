import { atom, read, update } from 'claude-code'
import type { AgentInfo, Register, SessionUsage } from 'claude-code'

import type { AgentRow, UsageSnapshot, View } from '../types'
import { bar, limitLong, limitName, money, pctColor, tokens, until } from './format'

const usage = atom({ plugin: 'usage-bar', key: 'usage' } as const, null)
const agents = atom({ plugin: 'usage-bar', key: 'agents' } as const, [])
const view = atom({ plugin: 'usage-bar', key: 'view' } as const, { isExpanded: false, isHidden: false })
const now = atom({ plugin: 'usage-bar', key: 'now' } as const, 0)

const LIVE = new Set(['pending', 'running', 'waiting'])

const snapshotOf = (u: SessionUsage): UsageSnapshot => ({
  ctxTokens: u.context.tokens ?? 0,
  ctxWindow: u.context.window,
  ctxPct: u.context.percent ?? (u.context.window ? Math.round((100 * (u.context.tokens ?? 0)) / u.context.window) : 0),
  limits: u.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed, resetsAt: r.resetsAt })),
  usd: u.cost?.usd ?? null,
})

// The batch the band shows: agents started since the prompt, plus any still live.
const rowsOf = (list: AgentInfo[], before: Set<string>): AgentRow[] =>
  list
    .filter(a => a.type !== 'teammate' && (LIVE.has(a.status) || !before.has(a.id)))
    .map(a => ({ id: a.id, desc: a.description, type: a.type, status: a.status }))

export const register: Register = on => {
  let before = new Set<string>()
  let isTurnRunning = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'usage-bar', description: 'Show or hide the usage band; "/usage-bar details" expands it.' })
    const saved = (await $.store.get('view')) as View | undefined
    if (saved) await update($, view, () => saved)
    // Reset countdowns and the plan limits move on their own: refresh twice a minute.
    $.clock.every(30_000, async () => {
      await update($, now, () => Date.now())
      try {
        const u = await $.session.usage()
        await update($, usage, () => snapshotOf(u))
      } catch {}
    })
    // While a turn runs, follow subagents closely.
    $.clock.every(3000, async () => {
      if (!isTurnRunning) return
      try {
        const list = await $.agent.list()
        await update($, agents, () => rowsOf(list, before))
      } catch {}
    })
    return next(e)
  })

  on('command.run', { command: 'usage-bar' }, async ($, e) => {
    const wantsDetails = e.args.trim() === 'details'
    try {
      const u = await $.session.usage()
      await update($, usage, () => snapshotOf(u))
    } catch {}
    await update($, view, v => (wantsDetails ? { isHidden: false, isExpanded: !v.isExpanded } : { ...v, isHidden: !v.isHidden }))
    const v = await read($, view)
    await $.store.set('view', v)
    return { text: v.isHidden ? 'usage-bar hidden. /usage-bar shows it.' : v.isExpanded ? 'usage-bar: details shown.' : 'usage-bar shown.' }
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      before = new Set((await $.agent.list()).filter(a => !LIVE.has(a.status)).map(a => a.id))
    } catch {}
    isTurnRunning = true
    await update($, agents, list => list.filter(a => LIVE.has(a.status)))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const res = yield* next(e)
    if (e.agentId === undefined) {
      try {
        const u = await $.session.usage()
        await update($, usage, () => snapshotOf(u))
        await update($, now, () => Date.now())
      } catch {}
    }
    return res
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    if (e.agentId === undefined) {
      isTurnRunning = false
      try {
        const list = await $.agent.list()
        await update($, agents, () => rowsOf(list, before))
      } catch {}
    }
    return res
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const v = await read($, view)
    const u = await read($, usage)
    const list = await read($, agents)
    if (e.props.hasSurvey || v.isHidden || (u === null && list.length === 0)) return next(e)

    const below = await next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const t = (await read($, now)) || Date.now()
    const cells = (e.props.bodyColumns ?? 100) < 100 ? 5 : 10

    const usageRow = u && (
      <Box key="usage-row">
        <Text dimColor>ctx </Text>
        <Text color={pctColor(u.ctxPct)}>{bar(u.ctxPct, cells)}</Text>
        <Text> {u.ctxPct}% {tokens(u.ctxTokens)}/{tokens(u.ctxWindow)}</Text>
        {u.limits.map(l => (
          <Text key={'lim-' + l.kind}>
            <Text dimColor>   {limitName(l.kind)} </Text>
            <Text color={pctColor(l.pct)}>{bar(l.pct, cells / 2)}</Text>
            <Text> {Math.round(l.pct)}%</Text>
            <Text dimColor> ↻{until(l.resetsAt, t)}</Text>
          </Text>
        ))}
        {u.usd !== null && <Text dimColor>   {money(u.usd)}</Text>}
        <Text> </Text>
        <Button key="details" label={v.isExpanded ? 'less' : 'details'} plain onPress={async () => {
          await update($, view, x => ({ ...x, isExpanded: !x.isExpanded }))
          await $.store.set('view', await read($, view))
        }} />
        <Text> </Text>
        <Button key="hide" label="hide" plain onPress={async () => {
          await update($, view, x => ({ ...x, isHidden: true }))
          await $.store.set('view', await read($, view))
        }} />
      </Box>
    )

    const details = u && v.isExpanded && (
      <Box key="details-rows" flexDirection="column">
        <Text dimColor>
          {'  '}Context: {u.ctxTokens.toLocaleString()} of {u.ctxWindow.toLocaleString()} tokens used, {tokens(Math.max(0, u.ctxWindow - u.ctxTokens))} left.
        </Text>
        {u.limits.map(l => (
          <Text key={'det-' + l.kind} dimColor>
            {'  '}{limitLong(l.kind)}: {Math.round(l.pct)}% used, {Math.max(0, 100 - Math.round(l.pct))}% left, resets {until(l.resetsAt, t) || 'unknown'}.
          </Text>
        ))}
        {u.limits.length === 0 && <Text dimColor>{'  '}No plan limits reported yet (they arrive with the next reply, or the account has none).</Text>}
        {u.usd !== null && <Text dimColor>{'  '}Session cost as /cost totals it: {money(u.usd)} (API-equivalent on a subscription).</Text>}
      </Box>
    )

    const done = list.filter(a => !LIVE.has(a.status)).length
    const live = list.filter(a => LIVE.has(a.status))
    const agentRow = list.length > 0 && (
      <Box key="agents-row">
        <Text dimColor>agents </Text>
        <Text color={live.length ? 'yellow' : 'green'}>{bar(list.length ? (100 * done) / list.length : 0, cells)}</Text>
        <Text> {done}/{list.length} done</Text>
        {live.length > 0 && <Text dimColor wrap="truncate-end"> · running: {live.map(a => `${a.type}: ${a.desc}`).join(' · ')}</Text>}
        <Text> </Text>
        <Button key="panel" label="panel" plain onPress={async () => {
          try {
            await $.command.run({ command: 'agents-info', args: '' })
          } catch {
            $.ui.toast('usage-bar: the agents panel needs the savvy-progress mod.')
          }
        }} />
      </Box>
    )

    return (
      <Box flexDirection="column">
        {usageRow}
        {details}
        {agentRow}
        {below}
      </Box>
    )
  })
}
