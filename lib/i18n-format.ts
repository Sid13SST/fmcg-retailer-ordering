/** Tiny, dependency-free string interpolation, safe to ship to the browser. */
export function fmt(template: string, vars: Record<string, string | number> = {}): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in vars ? String(vars[key]) : match));
}

/** Pick singular/plural template by count. */
export function plural(n: number, one: string, many: string): string {
  return fmt(n === 1 ? one : many, { n });
}
