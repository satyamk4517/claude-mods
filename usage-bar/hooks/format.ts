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

// One ring gauge: track, coloured arc from 12 o'clock, percent in the middle.
const ring = (cx: number, pct: number, label: string, sub: string, tip: string) => {
  const r = 26
  const c = 2 * Math.PI * r
  const len = (Math.max(0, Math.min(100, pct)) / 100) * c
  return `<g><title>${esc(tip)}</title>
  <circle cx="${cx}" cy="40" r="${r}" fill="none" stroke-width="7" class="track"/>
  <circle cx="${cx}" cy="40" r="${r}" fill="none" stroke-width="7" stroke="${pctHex(pct)}" stroke-linecap="round"
    stroke-dasharray="${len.toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} 40)"/>
  <text x="${cx}" y="45" text-anchor="middle" class="fg big">${Math.round(pct)}%</text>
  <text x="${cx}" y="84" text-anchor="middle" class="fg lab">${esc(label)}</text>
  <text x="${cx}" y="99" text-anchor="middle" class="mute sm">${esc(sub)}</text></g>`
}

// The desktop card: three gauges, then cost and the agents.
export const svgCard = (u: Usage | null, agents: Agent[], now: number) => {
  const W = 760
  const H = 112
  const gauges: string[] = []
  if (u) {
    gauges.push(
      ring(52, u.ctxPct, 'Context', `${tokens(u.ctxTokens)} / ${tokens(u.ctxWindow)}`,
        `Context: ${u.ctxTokens.toLocaleString()} of ${u.ctxWindow.toLocaleString()} tokens, ${tokens(Math.max(0, u.ctxWindow - u.ctxTokens))} left`),
    )
    u.limits.slice(0, 2).forEach((l, i) => {
      const left = Math.max(0, 100 - Math.round(l.pct))
      const when = until(l.resetsAt, now)
      gauges.push(
        ring(52 + 118 * (i + 1), l.pct, limitName(l.kind), when ? `resets ${when}` : `${left}% left`,
          `${limitLong(l.kind)}: ${Math.round(l.pct)}% used, ${left}% left${when ? ', resets ' + when : ''}`),
      )
    })
  }
  const x0 = u ? 52 + 118 * (1 + Math.min(2, u.limits.length)) - 20 : 16
  const side: string[] = []
  if (u && u.usd !== null) {
    side.push(`<g><title>Session cost as /cost totals it (API-equivalent on a subscription)</title>
      <text x="${x0}" y="26" class="mute sm">SESSION</text>
      <text x="${x0}" y="50" class="fg cost">${money(u.usd)}</text></g>`)
  }
  if (agents.length) {
    const done = agents.filter(a => !isLive(a)).length
    const ax = x0 + (u && u.usd !== null ? 120 : 0)
    const bw = W - ax - 16
    side.push(`<text x="${ax}" y="26" class="mute sm">AGENTS  ${done}/${agents.length} done</text>
      <rect x="${ax}" y="33" width="${bw}" height="6" rx="3" class="trackfill"/>
      <rect x="${ax}" y="33" width="${((bw * done) / agents.length).toFixed(1)}" height="6" rx="3" fill="${done === agents.length ? HEX.green : HEX.yellow}"/>`)
    agents.slice(0, 4).forEach((a, i) => {
      const y = 56 + i * 15
      const live = isLive(a)
      side.push(`<g><title>${esc(`${a.type}: ${a.desc} (${a.status})`)}</title>
        <circle cx="${ax + 5}" cy="${y - 4}" r="4" fill="${live ? HEX.yellow : HEX.green}">${live ? '<animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite"/>' : ''}</circle>
        <text x="${ax + 15}" y="${y}" class="${live ? 'fg' : 'mute'} sm">${live ? '' : '✓ '}${esc(clip(`${a.type} · ${a.desc}`, 46))}</text></g>`)
    })
    if (agents.length > 4) side.push(`<text x="${ax + 15}" y="${56 + 4 * 15}" class="mute sm">+${agents.length - 4} more</text>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, system-ui, sans-serif">
<style>
  .panel{fill:#f6f8fa;stroke:#d0d7de} .fg{fill:#1f2328} .mute{fill:#656d76} .track{stroke:#d0d7de} .trackfill{fill:#d0d7de}
  .big{font-size:15px;font-weight:600} .lab{font-size:12px;font-weight:600} .sm{font-size:11px;letter-spacing:.2px} .cost{font-size:22px;font-weight:600}
  @media (prefers-color-scheme: dark){ .panel{fill:#161b22;stroke:#30363d} .fg{fill:#e6edf3} .mute{fill:#8b949e} .track{stroke:#30363d} .trackfill{fill:#30363d} }
</style>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="10" class="panel"/>
${gauges.join('\n')}
${side.join('\n')}
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
