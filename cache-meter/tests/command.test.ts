import { expect, test } from 'claude-code/testing'

test('/cache-meter answers before any request', async $ => {
  const r = await $.command.run({ command: 'cache-meter', args: '' } as never)
  expect(r.text).toContain('no model requests yet')
})
