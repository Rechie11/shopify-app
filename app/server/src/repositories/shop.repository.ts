import { eq } from 'drizzle-orm';
import { shops } from '@ember-and-ash/db';
import type { DbOrTx } from '@ember-and-ash/db/client';
import type { EncryptedToken } from '../shopify/crypto.js';

export type Shop = typeof shops.$inferSelect;

export async function findShopByDomain(db: DbOrTx, shopDomain: string): Promise<Shop | undefined> {
  return db.query.shops.findFirst({ where: eq(shops.shopDomain, shopDomain) });
}

export async function createShop(db: DbOrTx, shopDomain: string): Promise<Shop> {
  const [result] = await db.insert(shops).values({ shopDomain }).$returningId();
  const created = await db.query.shops.findFirst({ where: eq(shops.id, result!.id) });
  if (!created) {
    throw new Error(`Failed to read back newly created shop ${shopDomain}`);
  }
  return created;
}

export async function findOrCreateShopByDomain(db: DbOrTx, shopDomain: string): Promise<Shop> {
  const existing = await findShopByDomain(db, shopDomain);
  if (existing) {
    return existing;
  }
  return createShop(db, shopDomain);
}

export async function saveShopAccessToken(
  db: DbOrTx,
  shopId: number,
  token: EncryptedToken,
  scopes: string,
): Promise<void> {
  await db
    .update(shops)
    .set({
      accessTokenCiphertext: token.ciphertext.toString('base64'),
      accessTokenIv: token.iv.toString('base64'),
      accessTokenTag: token.tag.toString('base64'),
      scopes,
      installedAt: new Date(),
    })
    .where(eq(shops.id, shopId));
}

export function readShopAccessToken(shop: Shop): EncryptedToken | undefined {
  if (!shop.accessTokenCiphertext || !shop.accessTokenIv || !shop.accessTokenTag) {
    return undefined;
  }
  return {
    ciphertext: Buffer.from(shop.accessTokenCiphertext, 'base64'),
    iv: Buffer.from(shop.accessTokenIv, 'base64'),
    tag: Buffer.from(shop.accessTokenTag, 'base64'),
  };
}
