/** The accent presets: a theme key that follows the person's Claude Code theme, or a fixed color. */
export const THEMES = {
  terminal: { accent: 'permission', about: "follows your Claude Code theme" },
  claude: { accent: 'claude', about: "Claude's orange, from your Claude Code theme" },
  nebula: { accent: '#b4befe', about: 'lavender' },
  ember: { accent: '#fab387', about: 'orange' },
  mint: { accent: '#94e2d5', about: 'teal' },
  rose: { accent: '#f5c2e7', about: 'pink' },
  gold: { accent: '#f9e2af', about: 'yellow' },
  mono: { accent: 'text', about: "your terminal's text color" },
} as const

export type ThemeName = keyof typeof THEMES

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[]

export const isThemeName = (value: unknown): value is ThemeName =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(THEMES, value)

/**
 * The color nebula-ui accents with. A live binding: every module that imports it reads the value the
 * render hooks last set from the person's theme, so set it before drawing.
 */
export let ACCENT: string = THEMES.terminal.accent

export const setAccent = (name: ThemeName) => {
  ACCENT = THEMES[name].accent
}

/** A share as a gauge's color: calm, getting full, nearly out. */
export const tone = (percent: number) => (percent < 60 ? 'success' : percent < 85 ? 'warning' : 'error')
