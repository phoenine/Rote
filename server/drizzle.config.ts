import { defineConfig } from 'drizzle-kit';
import { migrationDatabaseUrl } from './database/connection';

export default defineConfig({
  schema: ['./drizzle/schema.ts', './drizzle/oauthMcpSchema.ts'],
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: migrationDatabaseUrl(process.env),
  },
});
