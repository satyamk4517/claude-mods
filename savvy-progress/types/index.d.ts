export type PlanItem = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed'; active?: string }

export type Progress = {
  plan: PlanItem[]
  isRunning: boolean
  startedAt: number
  now: number
  steps: number
  tools: number
  edits: number
  alert: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'savvy-progress': { progress: Progress; isHidden: boolean }
  }
}
