import { sql } from 'drizzle-orm';
import { bigint, char, datetime, mysqlTable, smallint, varchar } from 'drizzle-orm/mysql-core';

// Tenant root. Every other tenant table carries shop_id and leads its
// composite indexes with it - see SCHEMA.md §1.
export const shops = mysqlTable('shops', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  shopDomain: varchar('shop_domain', { length: 255 }).notNull().unique(),
  shopifyShopGid: varchar('shopify_shop_gid', { length: 255 }),

  // Stored as base64, not raw VARBINARY: this drizzle-orm version maps
  // VARBINARY reads through Buffer.toString() (UTF-8), which silently
  // corrupts arbitrary ciphertext bytes. Base64 round-trips exactly
  // through the ORM's string handling while keeping the same encrypted-
  // at-rest property.
  accessTokenCiphertext: varchar('access_token_ciphertext', { length: 700 }),
  accessTokenIv: varchar('access_token_iv', { length: 24 }),
  accessTokenTag: varchar('access_token_tag', { length: 32 }),
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
