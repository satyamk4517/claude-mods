// Pure helpers for the band: no engine calls, so tests can import them.

export type Limit = { kind: string; pct: number; resetsAt?: string }

export const pctColor = (pct: number) => (pct >= 85 ? 'red' : pct >= 60 ? 'yellow' : 'green')

export const bar = (pct: number, cells: number) => {
  const filled = Math.max(0, Math.min(cells, Math.round((cells * pct) / 100)))
  return '▰'.repeat(filled) + '▱'.repeat(cells - filled)
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
  kind === 'five_hour' ? '5h' : kind === 'seven_day' ? '7d' : kind === 'spend_limit' ? 'spend' : kind.replace(/_/g, ' ')

export const limitLong = (kind: string) =>
  kind === 'five_hour' ? '5-hour limit' : kind === 'seven_day' ? '7-day limit' : kind === 'spend_limit' ? 'Spend limit' : kind

export const money = (usd: number) => '$' + usd.toFixed(2)
