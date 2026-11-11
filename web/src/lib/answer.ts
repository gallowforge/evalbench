/**
 * The fields of an answer that is one flat JSON object, in the order the model wrote them.
 * Null for anything else: prose, a list, a nested object, or JSON that does not parse.
 */
export function fields(text: string): [string, string][] | null {
  const t = (text ?? '').trim();
  if (!t.startsWith('{') || !t.endsWith('}')) return null;
  let value: unknown;
  try {
    value = JSON.parse(t);
  } catch {
    return null;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0 || entries.length > 8) return null;
  if (entries.some(([, v]) => v !== null && typeof v === 'object')) return null;
  return entries.map(([k, v]) => [k, v === null ? 'null' : String(v)]);
}
