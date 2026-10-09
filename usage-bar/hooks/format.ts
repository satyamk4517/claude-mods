// Pure helpers for the band: no engine calls, so tests can import them.

export type Limit = { kind: string; pct: number; resetsAt?: string }
export type Usage = { ctxTokens: number; ctxWindow: number; ctxPct: number; limits: Limit[]; usd: number | null }
export type Agent = { id: string; desc: string; type: string; status: string }

const LIVE = new Set(['pending', 'running', 'waiting'])
export const isLive = (a: Agent) => LIVE.has(a.status)

export const pctColor = (pct: number) => (pct >= 85 ? 'red' : pct >= 60 ? 'yellow' : 'green')
const HEX = { green: '#3fb950', yellow: '#d29922', red: '#f85149' } as const
export const pctHex = (pct: number) => HEX[pctColor(pct)]

export const bar = (pct: number, cells: number) => {
  const filled = Math.max(0, Math.min(cells, Math.round((cells * pct) / 100)))
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
}

// A bar at eighth-of-a-cell resolution, padded with a light track.
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']
export const smoothBar = (pct: number, cells: number) => {
  const eighths = Math.max(0, Math.min(cells * 8, Math.round((cells * 8 * pct) / 100)))
  const full = Math.floor(eighths / 8)
  const part = EIGHTHS[eighths % 8] ?? ''
  const used = full + (part ? 1 : 0)
  return { fill: '█'.repeat(full) + part, track: '░'.repeat(Math.max(0, cells - used)) }
}

export const tokens = (n: number) =>
  n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

// "in 2h10m", "in 3d4h", "now": relative, so no time zone is assumed.
export const until = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'now'
  const m = Math.round(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `in ${d}d${h}h` : h > 0 ? `in ${h}h${String(m % 60).padStart(2, '0')}m` : `in ${m}m`
}

export const limitName = (kind: string) =>
  kind === 'five_hour' ? '5-hour' : kind === 'seven_day' ? '7-day' : kind === 'spend_limit' ? 'Spend' : kind.replace(/_/g, ' ')

export const limitLong = (kind: string) =>
  kind === 'five_hour' ? '5-hour limit' : kind === 'seven_day' ? '7-day limit' : kind === 'spend_limit' ? 'Spend limit' : kind

export const money = (usd: number) => '$' + usd.toFixed(2)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// The desktop strip: one 30px row of labelled mini bars, cost and agent dots.
export const svgCard = (u: Usage | null, agents: Agent[], now: number) => {
  const H = 30
  const parts: string[] = []
  let x = 10
  const seg = (label: string, pct: number, tail: string, tip: string) => {
    const bw = 64
    const fill = (Math.max(0, Math.min(100, pct)) / 100) * bw
    parts.push(`<g><title>${esc(tip)}</title>
  <text x="${x}" y="19" class="mute sm">${esc(label)}</text>
  <rect x="${x + 44}" y="11" width="${bw}" height="8" rx="4" class="trackfill"/>
  <rect x="${x + 44}" y="11" width="${fill.toFixed(1)}" height="8" rx="4" fill="${pctHex(pct)}"/>
  <text x="${x + 50 + bw}" y="19" class="fg b">${Math.round(pct)}%</text>
  ${tail ? `<text x="${x + 84 + bw}" y="19" class="mute sm">${esc(tail)}</text>` : ''}</g>`)
    x += 84 + bw + (tail ? tail.length * 6 + 14 : 4)
  }
  if (u) {
    seg('ctx', u.ctxPct, tokens(u.ctxTokens), `Context: ${u.ctxTokens.toLocaleString()} of ${u.ctxWindow.toLocaleString()} tokens, ${tokens(Math.max(0, u.ctxWindow - u.ctxTokens))} left`)
    for (const l of u.limits.slice(0, 2)) {
      const left = Math.max(0, 100 - Math.round(l.pct))
      const when = until(l.resetsAt, now)
      seg(l.kind === 'five_hour' ? '5h' : l.kind === 'seven_day' ? '7d' : limitName(l.kind), l.pct, when ? '↻' + when.replace('in ', '') : '',
        `${limitLong(l.kind)}: ${Math.round(l.pct)}% used, ${left}% left${when ? ', resets ' + when : ''}`)
    }
    if (u.usd !== null) {
      parts.push(`<g><title>Session cost as /cost totals it (API-equivalent on a subscription)</title><text x="${x}" y="19" class="fg b">${money(u.usd)}</text></g>`)
      x += 58
    }
  }
  if (agents.length) {
    const done = agents.filter(a => !isLive(a)).length
    parts.push(`<text x="${x}" y="19" class="mute sm">agents ${done}/${agents.length}</text>`)
    x += 66
    agents.slice(0, 8).forEach(a => {
      const live = isLive(a)
      parts.push(`<g><title>${esc(`${a.type}: ${a.desc} (${a.status})`)}</title><circle cx="${x}" cy="15" r="4" fill="${live ? HEX.yellow : HEX.green}">${live ? '<animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite"/>' : ''}</circle></g>`)
      x += 12
    })
    x += 6
  }
  const W = Math.max(120, Math.ceil(x))
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, system-ui, sans-serif">
<style>
  .panel{fill:#f6f8fa;stroke:#d0d7de} .fg{fill:#1f2328} .mute{fill:#656d76} .trackfill{fill:#d0d7de}
  .b{font-size:12px;font-weight:600} .sm{font-size:11px}
  @media (prefers-color-scheme: dark){ .panel{fill:#161b22;stroke:#30363d} .fg{fill:#e6edf3} .mute{fill:#8b949e} .trackfill{fill:#30363d} }
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="8" class="panel"/>
${parts.join('\n')}
</svg>`
}

export const cardAlt = (u: Usage | null, agents: Agent[], now: number) =>
  [
    u ? `Context ${u.ctxPct}% (${tokens(u.ctxTokens)} of ${tokens(u.ctxWindow)})` : '',
    ...(u ? u.limits.map(l => `${limitLong(l.kind)} ${Math.round(l.pct)}% used${l.resetsAt ? ', resets ' + until(l.resetsAt, now) : ''}`) : []),
    u && u.usd !== null ? `session ${money(u.usd)}` : '',
    agents.length ? `agents ${agents.filter(a => !isLive(a)).length}/${agents.length} done` : '',
  ]
    .filter(Boolean)
    .join('; ')
