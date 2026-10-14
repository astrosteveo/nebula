/** The theme key nebula-ui accents with: follows the person's theme. */
export const ACCENT = 'permission'

/** A share as a gauge's color: calm, getting full, nearly out. */
export const tone = (percent: number) => (percent < 60 ? 'success' : percent < 85 ? 'warning' : 'error')
