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
  if (value instanceof Error) return value.message || describeEmpty(value);
  if (typeof value === 'string') return value;
  return JSON.stringify(value) ?? typeof value;
}

/**
 * An error without a message, e.g. the AggregateError Node throws when connecting to every address
 * of a host (`::1` and `127.0.0.1` for localhost) fails: its code and the inner errors' messages.
 */
function describeEmpty(error: Error): string {
  const code = (error as { code?: unknown }).code;
  const inner = error instanceof AggregateError ? error.errors.map(describeValue).join('; ') : '';
  const parts = [typeof code === 'string' ? code : error.name, inner].filter((part) => part !== '');
  return parts.join(': ');
}
