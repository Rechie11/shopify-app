import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL ?? 'mysql://ember:ember@localhost:3306/ember_ash';

export default defineConfig({
  dialect: 'mysql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: {
    url: databaseUrl,
  },
});
