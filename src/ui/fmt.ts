export const fmt = (n: number): string => n.toLocaleString('en-US')

/** Signed chips: +240 / −120 / 0. */
export const signed = (n: number): string => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(-n)}` : '0')

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function list(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
