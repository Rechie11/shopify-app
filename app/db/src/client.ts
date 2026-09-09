import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import type { MySqlDatabase } from 'drizzle-orm/mysql-core';
import type { MySql2PreparedQueryHKT, MySql2QueryResultHKT } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema/index.js';

export function createDbClient(databaseUrl: string) {
  const pool = mysql.createPool(databaseUrl);
  return drizzle(pool, { schema, mode: 'default' });
}

export type Db = ReturnType<typeof createDbClient>;

// The top-level Db and a transaction handle from db.transaction(async (tx)
// => ...) are different concrete classes, but both extend MySqlDatabase.
// Repository/service functions should take DbOrTx, not Db, so the same
// function works identically whether called standalone or from inside a
// transaction - no unsafe casts needed at call sites.
export type DbOrTx = MySqlDatabase<
  MySql2QueryResultHKT,
  MySql2PreparedQueryHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
