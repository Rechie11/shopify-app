import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createDbClient } from './client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run migrations');
}

const db = createDbClient(databaseUrl);

await migrate(db, { migrationsFolder: './migrations' });
console.log('Migrations applied.');
process.exit(0);
