import type { ModelUsage, Register } from 'claude-code'

// USD per million tokens (input, output), API list prices as of 2026-09-29.
// Models not listed get token counts only, never a guessed price.
const PRICES: { match: RegExp; input: number; output: number }[] = [
  { match: /opus/i, input: 4, output: 20 },
  { match: /sonnet/i, input: 2, output: 10 },
]
// Prompt-cache multipliers on the input price: a 1-hour write costs 2x,
// a read 0.1x. Assumes the session's requests use the 1-hour cache TTL.
const WRITE_X = 2
const READ_X = 0.1
const TTL_MS = 60 * 60 * 1000
// A step counts as a rebuild when it read back less than half of what the
// loop had cached and wrote at least this much afresh.
const MIN_REBUILD = 2000

type Loop = { model: string; effort?: string | number; at: number; cached: number }
type Rebuild = { at: number; loop: string; tokens: number; cost: number | null; why: string }

const priceOf = (model: string) => PRICES.find(p => p.match.test(model)) ?? null

const costOf = (model: string, u: ModelUsage) => {
  const p = priceOf(model)
  if (!p) return null
  return (
    (u.input_tokens * p.input +
      u.cache_creation_input_tokens * p.input * WRITE_X +
      u.cache_read_input_tokens * p.input * READ_X +
      u.output_tokens * p.output) /
    1e6
  )
}

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))
const usd = (n: number | null) => (n === null ? 'n/a' : 'USD ' + n.toFixed(2))
const hhmm = (ms: number) => new Date(ms).toTimeString().slice(0, 5)

export const register: Register = on => {
  const loops = new Map<string, Loop>()
  const rebuilds: Rebuild[] = []
  const total = { steps: 0, input: 0, read: 0, write: 0, output: 0, cost: 0, unpriced: 0 }
  let mainContext = 0
  let mainAt = 0

  const hitRate = () => {
    const all = total.input + total.read + total.write
    return all === 0 ? 0 : Math.round((100 * total.read) / all)
  }
  const tax = () => rebuilds.reduce((s, r) => s + (r.cost ?? 0), 0)

  // The status line's text at time `now`; undefined before the first request.
  const statusText = (now: number) => {
    if (total.steps === 0) return undefined
    const left = Math.max(0, TTL_MS - (now - mainAt))
    const ttl = left === 0 ? 'cache cold' : `TTL ${Math.ceil(left / 60000)}m`
    const rb = rebuilds.length ? ` · tax ${usd(tax())} (${rebuilds.length} rebuild${rebuilds.length > 1 ? 's' : ''})` : ''
    return `cache ${hitRate()}% · ctx ${k(mainContext)} · ${ttl}${rb}`
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'cache-meter', description: 'Prompt-cache spend for this session: hit rate, cost, and every rebuild with what coincided with it.' })
    $.clock.every(60_000, () => $.ui.status(statusText(Date.now())))
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const res = yield* next(e)
    const u = res.usage
    if (!u) return res

    const key = e.agentId ?? 'main'
    const now = await $.clock.now()
    const prev = loops.get(key)
    const cost = costOf(u.model, u)

    total.steps += 1
    total.input += u.input_tokens
    total.read += u.cache_read_input_tokens
    total.write += u.cache_creation_input_tokens
    total.output += u.output_tokens
    if (cost === null) total.unpriced += 1
    else total.cost += cost

    if (prev && u.cache_read_input_tokens < prev.cached / 2 && u.cache_creation_input_tokens >= MIN_REBUILD) {
      const why: string[] = []
      if (prev.model !== e.model) why.push(`model ${prev.model} → ${e.model}`)
      if (prev.effort !== e.effort) why.push(`effort ${prev.effort ?? 'default'} → ${e.effort ?? 'default'}`)
      if (now - prev.at > TTL_MS) why.push(`idle ${Math.round((now - prev.at) / 60000)}m, past the 1h TTL`)
      if (why.length === 0) why.push('prompt prefix changed (CLAUDE.md/memory edit, tools or MCP change, or compaction)')
      const p = priceOf(u.model)
      const rebuild: Rebuild = {
        at: now,
        loop: key === 'main' ? 'main' : `agent ${key.slice(0, 8)}`,
        tokens: u.cache_creation_input_tokens,
        // The tax is the rewrite premium over reading the same tokens back.
        cost: p ? (u.cache_creation_input_tokens * p.input * (WRITE_X - READ_X)) / 1e6 : null,
        why: why.join('; '),
      }
      rebuilds.push(rebuild)
      $.ui.toast(`Cache rebuilt: ${k(rebuild.tokens)} tokens, tax ${usd(rebuild.cost)}. Coincided with: ${rebuild.why}`, { timeoutMs: 8000 })
    }

    loops.set(key, {
      model: e.model,
      effort: e.effort,
      at: now,
      cached: u.cache_read_input_tokens + u.cache_creation_input_tokens,
    })
    if (key === 'main') {
      mainContext = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
      mainAt = now
    }
    $.ui.status(statusText(now))
    return res
  })

  on('command.run', { command: 'cache-meter' }, async () => {
    if (total.steps === 0) return { text: 'cache-meter: no model requests yet this session.' }
    const lines = [
      `Requests: ${total.steps} · cache hit ${hitRate()}% · context now ${k(mainContext)}`,
      `Tokens: ${k(total.read)} read from cache, ${k(total.write)} written, ${k(total.input)} uncached, ${k(total.output)} output`,
      `Estimated spend: ${usd(total.cost)}${total.unpriced ? ` (+${total.unpriced} requests on unpriced models)` : ''} · rebuild tax ${usd(tax())}`,
    ]
    if (rebuilds.length) {
      lines.push('Rebuilds:')
      for (const r of rebuilds) lines.push(`  ${hhmm(r.at)}  ${r.loop}  ${k(r.tokens)} tokens  ${usd(r.cost)}  ${r.why}`)
    } else {
      lines.push('No cache rebuilds so far.')
    }
    lines.push('Prices assume API list rates and a 1h cache (write 2x, read 0.1x); on a subscription read them as relative weight, not a bill.')
    return { text: lines.join('\n') }
  })
}
