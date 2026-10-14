/** The restyled parts the person switched off, by render component name. */
export type Disabled = string[]

/** The figures the dashboard band draws, gathered outside the drawing. */
export type Dash = {
  model: string
  context: { percent: number | null; tokens: number | null; window: number }
  limits: { kind: string; percent: number; resetsAt: string | null }[]
  cost: number | null
  startedAt: number
  /** When the figures were gathered, in `$.clock.now()`'s milliseconds. */
  now: number
  /** Null outside a git repository. */
  git: { branch: string; ahead: number; behind: number; changed: number } | null
}

declare module 'claude-code' {
  interface PluginState {
    'nebula-ui': {
      disabled: Disabled
      /** Whether a tool row (by tool_use_id) or a group (`group:` + its requestId) is opened. */
      expanded: StateFamily<boolean>
      dash: Dash | null
    }
  }
}
