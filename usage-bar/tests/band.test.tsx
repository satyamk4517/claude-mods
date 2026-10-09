import { expect, mock, test } from 'claude-code/testing'

import { bar, pctColor, smoothBar, svgCard, tokens, until } from '../hooks/format'

const BAND = { plugin: 'usage-bar', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns: 140 } } as const
const IN_2H10 = new Date(Date.now() + (2 * 60 + 10) * 60000 + 20000).toISOString()
const FAKE = {
  startedAt: 0,
  context: { tokens: 440_000, window: 1_000_000, percent: 44 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 23, resetsAt: IN_2H10 },
    { kind: 'seven_day', percentUsed: 87.5 },
  ],
  cost: { usd: 3.1 },
}

test('formatting helpers', () => {
  expect(bar(44, 10)).toBe('▰▰▰▰▱▱▱▱▱▱')
  expect(bar(130, 5)).toBe('▰▰▰▰▰')
  expect(tokens(440_000)).toBe('440k')
  expect(tokens(1_000_000)).toBe('1M')
  expect(pctColor(23)).toBe('green')
  expect(pctColor(87.5)).toBe('red')
  expect(until(IN_2H10, Date.now())).toBe('in 2h10m')
  expect(smoothBar(50, 4)).toEqual({ fill: '██', track: '░░' })
  expect(smoothBar(56.25, 2).fill).toBe('█▏')
  const svg = svgCard({ ctxTokens: 1, ctxWindow: 2, ctxPct: 50, limits: [], usd: 1 }, [{ id: 'a', desc: '<x>', type: 'Explore', status: 'running' }], Date.now())
  expect(svg).toContain('&lt;x&gt;')
  expect(svg).toContain('<animate')
})

test('the band draws usage and details, and keeps the band beneath it', async ($, on) => {
  mock.store(on)
  on('session.usage', () => ({ value: FAKE }) as never)
  // Stands in for whatever draws beneath (another mod's band, the engine's).
  on('ui.render', { component: 'AbovePrompt' }, ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>band beneath</Text>
  })
  await $.command.run({ command: 'usage-bar', args: 'details' } as never)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Svg' } as never)).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^5h/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /5-hour limit: 23% used, 77% left, resets in 2h10m/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /7-day limit: 88% used, 12% left/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /band beneath/ })).toBeDefined()
    await ui.unmount()
  }
})

test('hide leaves only the band beneath', async ($, on) => {
  mock.store(on)
  on('session.usage', () => ({ value: FAKE }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>band beneath</Text>
  })
  await $.command.run({ command: 'usage-bar', args: '' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /band beneath/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /usage/ })).toBeUndefined()
  await ui.unmount()
})

test('a limit at 90% or more turns into a red warning', async ($, on) => {
  mock.store(on)
  on('session.usage', () => ({ value: { ...FAKE, rateLimits: [{ kind: 'five_hour', percentUsed: 93, resetsAt: IN_2H10 }] } }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>band beneath</Text>
  })
  await $.command.run({ command: 'usage-bar', args: 'details' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Text', text: /⚠ 5h/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ctx/ })).toBeDefined()
    await ui.unmount()
  }
})
