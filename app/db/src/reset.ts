import mysql from 'mysql2/promise';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import { createDbClient } from './client.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to reset the database');
}

const url = new URL(databaseUrl);
const dbName = url.pathname.replace(/^\//, '');
if (!dbName) {
  throw new Error(`DATABASE_URL is missing a database name: ${databaseUrl}`);
}

const rootConnection = await mysql.createConnection({
  host: url.hostname,
  port: url.port ? Number(url.port) : 3306,
  user: url.username,
  password: url.password,
});

await rootConnection.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
await rootConnection.query(`CREATE DATABASE \`${dbName}\``);
await rootConnection.end();

const db = createDbClient(databaseUrl);
await migrate(db, { migrationsFolder: './migrations' });

console.log(`Database "${dbName}" dropped, recreated, and migrated.`);
process.exit(0);
