export type UsageSnapshot = {
  ctxTokens: number
  ctxWindow: number
  ctxPct: number
  limits: { kind: string; pct: number; resetsAt?: string }[]
  usd: number | null
}

export type AgentRow = { id: string; desc: string; type: string; status: string }

export type View = { isExpanded: boolean; isHidden: boolean }

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { usage: UsageSnapshot | null; agents: AgentRow[]; view: View; now: number }
  }
}
