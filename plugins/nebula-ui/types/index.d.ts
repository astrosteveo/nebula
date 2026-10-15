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

/** How wide code and output frames are drawn: the full width, their content's, or a number of columns. */
export type FrameWidth = 'fill' | 'fit' | number

/** A command nebula-ui started from a reply, and what became of it. */
export type Proc = {
  id: string
  command: string
  cwd: string
  startedAt: number
  endedAt: number | null
  /** `detached`: still running after a reload of the mod, its output no longer read. */
  status: 'running' | 'exited' | 'failed' | 'stopped' | 'detached'
  code: number | null
  /** The process group the command runs in (it is started with setsid), so a stop reaches its children. */
  pgid: number | null
  /** The last lines it printed, stdout and stderr together. */
  tail: string[]
  /** The code frame it was run from (`<message id>:<block>`), which draws its output; null from a dialog. */
  origin: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'nebula-ui': {
      disabled: Disabled
      /** Whether a tool row (by tool_use_id) or a group (`group:` + its requestId) is opened. */
      expanded: StateFamily<boolean>
      dash: Dash | null
      procs: Proc[]
      frameWidth: FrameWidth
      /** The accent preset (hooks/theme.ts THEMES). */
      theme: 'terminal' | 'claude' | 'nebula' | 'ember' | 'mint' | 'rose' | 'gold' | 'mono'
      /** The command the run dialog asks about, null while it is closed. */
      pending: { command: string; origin: string | null } | null
    }
  }
}
