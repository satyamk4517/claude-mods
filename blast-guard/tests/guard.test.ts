import { expect, test } from 'claude-code/testing'

const ran = { result: { stdout: 'ran', stderr: '', interrupted: false } }

test('a Python heredoc with a \\x escape is denied, plain \\n passes', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ran as never)

  const bad = await $.tool.call({ tool: 'Bash', command: "python - <<'EOF'\nprint('\\x01')\nEOF" } as never)
  expect(bad.deny).toContain('backslash escape')

  const ok = await $.tool.call({ tool: 'Bash', command: "python - <<'EOF'\nprint('a\\nb')\nEOF" } as never)
  expect(ok.deny).toBeUndefined()
})

test('a safe command runs without a question', async ($, on) => {
  on('tool.call', { tool: 'Bash' }, () => ran as never)
  const r = await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  expect(r.deny).toBeUndefined()
})

test('a risky command nobody can confirm is held, not run', async ($, on) => {
  let didRun = false
  on('tool.call', { tool: 'Bash' }, () => {
    didRun = true
    return ran as never
  })
  const r = await $.tool.call({ tool: 'Bash', command: 'git reset --hard HEAD~1' } as never)
  expect(r.deny).toBeDefined()
  expect(didRun).toBe(false)
})
