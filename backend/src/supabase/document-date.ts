export function documentDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (value !== null && typeof value === 'object' && 'toDate' in value) {
    const toDate = value.toDate;
    if (typeof toDate === 'function') {
      const parsed: unknown = toDate.call(value);
      if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
  }
  throw new Error('Document contains an invalid timestamp.');
}
