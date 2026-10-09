import { expect, test } from 'claude-code/testing'

test('/cache-tax answers before any request', async $ => {
  const r = await $.command.run({ command: 'cache-tax', args: '' } as never)
  expect(r.text).toContain('no model requests yet')
})
