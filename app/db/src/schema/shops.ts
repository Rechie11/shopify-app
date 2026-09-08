import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  datetime,
  mysqlTable,
  smallint,
  varbinary,
  varchar,
} from 'drizzle-orm/mysql-core';

// Tenant root. Every other tenant table carries shop_id and leads its
// composite indexes with it - see SCHEMA.md §1.
export const shops = mysqlTable('shops', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  shopDomain: varchar('shop_domain', { length: 255 }).notNull().unique(),
  shopifyShopGid: varchar('shopify_shop_gid', { length: 255 }),

  // Ciphertext is bytes; VARBINARY avoids a collation being applied to it.
  accessTokenCiphertext: varbinary('access_token_ciphertext', { length: 512 }),
  accessTokenIv: varbinary('access_token_iv', { length: 12 }),
  accessTokenTag: varbinary('access_token_tag', { length: 16 }),
  keyVersion: smallint('key_version', { unsigned: true }).notNull().default(1),

  scopes: varchar('scopes', { length: 512 }),
  currency: char('currency', { length: 3 }),
  ianaTimezone: varchar('iana_timezone', { length: 64 }),

  marginFloorBps: smallint('margin_floor_bps', { unsigned: true }).notNull().default(3000),
  marginTargetBps: smallint('margin_target_bps', { unsigned: true }).notNull().default(5500),

  installedAt: datetime('installed_at', { fsp: 3 }),
  uninstalledAt: datetime('uninstalled_at', { fsp: 3 }),

  createdAt: datetime('created_at', { fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`),
  updatedAt: datetime('updated_at', { fsp: 3 })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
});
