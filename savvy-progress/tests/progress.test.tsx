import { expect, test } from 'claude-code/testing'

const BAND = { plugin: 'savvy-progress', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true } } as const
const TODOS = [
  { content: 'Read the data', status: 'completed', activeForm: 'Reading the data' },
  { content: 'Fit the model', status: 'in_progress', activeForm: 'Fitting the model' },
  { content: 'Write the report', status: 'pending', activeForm: 'Writing the report' },
]

test('one failure is quiet, a second at the same command raises the stall alarm', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true, result: undefined, text: 'boom' }) as never)
  await $.tool.call({ tool: 'Bash', command: 'python train.py' } as never)
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /failed attempts/ })).toBeUndefined()
  await ui.unmount()

  await $.tool.call({ tool: 'Bash', command: 'python train.py' } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Text', text: /2 failed attempts at Bash/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a todo list draws as a progress bar with the current step', async ($, on) => {
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: TODOS } }) as never)
  await $.tool.call({ tool: 'TodoWrite', todos: TODOS } as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface } as never)
    expect(await ui.find({ type: 'Text', text: /▰{3}▱{7} 1\/3 · now: Fitting the model/ })).toBeDefined()
    await ui.unmount()
  }
})

test('nothing has happened: the band stays out of the way', async ($, on) => {
  // Stands in for the engine's own band, which the mod hands the draw to.
  on('ui.render', { component: 'AbovePrompt' }, ($e, e) => {
    const { Text } = $e.ui.resolve(e)
    return <Text>engine band</Text>
  })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' } as never)
  expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'hide' } as never)).toBeUndefined()
  await ui.unmount()
})
