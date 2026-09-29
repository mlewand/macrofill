import { defineConfig } from 'drizzle-kit';

// `pnpm -F @macrofill/api db:generate` writes a new migration after a schema change.
// Applying migrations is a separate, explicit step: `pnpm db:migrate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  casing: 'snake_case',
});
