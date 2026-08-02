export function toIsoTimestamp(value: unknown, fieldName = "timestamp"): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new TypeError(`${fieldName} is not a valid timestamp.`);
  }
  return date.toISOString();
}

export function toNullableIsoTimestamp(value: unknown, fieldName = "timestamp"): string | null {
  return value === null || value === undefined ? null : toIsoTimestamp(value, fieldName);
}
