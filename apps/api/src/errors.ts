/**
 * An error's message with its whole `cause` chain, for the CLIs and startup. Drizzle wraps driver
 * errors ("Failed query: …"), so without the chain a wrong password reads like a schema problem.
 * The Postgres driver's messages don't include the connection string.
 */
export function describeError(error: unknown): string {
  const lines: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    lines.push(describeValue(current));
    current = current instanceof Error ? current.cause : undefined;
  }
  return lines.join('\n  caused by: ');
}

function describeValue(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? typeof value;
}
