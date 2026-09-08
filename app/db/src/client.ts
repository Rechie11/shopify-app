import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema/index.js';

export function createDbClient(databaseUrl: string) {
  const pool = mysql.createPool(databaseUrl);
  return drizzle(pool, { schema, mode: 'default' });
}

export type Db = ReturnType<typeof createDbClient>;
