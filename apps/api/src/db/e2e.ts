/**
 * The database name in `databaseUrl`, if it's safe for the e2e reset to wipe it: the name must end
 * in `_e2e`. Anything else, the dev database included, is refused.
 */
export function e2eDatabaseName(databaseUrl: string): string {
  const name = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
  if (!/^.+_e2e$/.test(name)) {
    throw new Error(
      `Refusing to reset database "${name}": the e2e database's name must end in _e2e.`,
    );
  }
  return name;
}
