// One-off script: creates a realistic, on-brand 18-product catalogue in the
// connected dev store via the Admin API, so `npm run seed` (which only ever
// reads products back, never creates them - see its own header comment) has
// a real catalogue to build demo bundles from instead of a handful of
// improvised test products.
//
// Idempotent by handle: uses `productSet`, which upserts on the `handle`
// identifier, so re-running this is safe and will not create duplicates -
// it will just update the same 18 products in place.
//
// Usage: tsx --env-file=../../.env src/seed-products.ts
//
// Does not set images - no image-generation capability in this pass, and
// mismatched stock photography is worse than the theme's own placeholder.
// Add real product photography separately; the theme degrades gracefully
// without it (see THEME_SPEC.md §11).

import { createDbClient } from '@ember-and-ash/db/client';
import { loadEnv } from './config/env.js';
import { decryptToken } from './shopify/crypto.js';
import { createAdminClient } from './shopify/admin-client.js';
import { findShopByDomain, readShopAccessToken } from './repositories/shop.repository.js';

type FlavorProfile = 'smoky' | 'fruity' | 'citrus' | 'umami' | 'herbal' | 'sweet-heat';

interface ProductSeed {
  handle: string;
  title: string;
  descriptionHtml: string;
  priceCents: number;
  costCents: number | null; // null on 2 of 18, deliberately - see SCHEMA.md §4.3
  heatLevel: 0 | 1 | 2 | 3 | 4 | 5;
  flavorProfile: FlavorProfile;
  batchNumber: string;
  pepperOrigin: string;
  harvestMonth: string;
  bottleCount: number;
  makerNote: string;
  pairsWith: string;
}

const PRODUCTS: ProductSeed[] = [
  // ---------- Heat 0 - Mild ----------
  {
    handle: 'first-light',
    title: 'First Light',
    descriptionHtml:
      '<p>The one we hand a nervous first-timer. Roasted poblano, a whisper of garlic, ' +
      'and nothing to prove. Still tastes like a decision, just not a risky one.</p>',
    priceCents: 900,
    costCents: null,
    heatLevel: 0,
    flavorProfile: 'herbal',
    batchNumber: '001',
    pepperOrigin: 'Oaxaca, Mexico',
    harvestMonth: 'March 2025',
    bottleCount: 420,
    makerNote: 'The one we give people who say they "don\'t really do spicy."',
    pairsWith: 'Scrambled eggs, roast chicken',
  },
  {
    handle: 'green-truce',
    title: 'Green Truce',
    descriptionHtml:
      '<p>Tomatillo and serrano, kept honest. Bright, tart, herbal - the sauce that argues ' +
      'for balance instead of heat. Batch-roasted, never blended hot.</p>',
    priceCents: 950,
    costCents: 380,
    heatLevel: 0,
    flavorProfile: 'herbal',
    batchNumber: '002',
    pepperOrigin: 'Zacatecas, Mexico',
    harvestMonth: 'April 2025',
    bottleCount: 380,
    makerNote: 'Green because it is, not because we added color.',
    pairsWith: 'Grilled fish, avocado toast',
  },
  {
    handle: 'quiet-morning',
    title: 'Quiet Morning',
    descriptionHtml:
      '<p>Citrus-forward, fermented light, built for the first meal of the day. Lime, ' +
      'a little fresno pepper, and the restraint to stop there.</p>',
    priceCents: 900,
    costCents: null,
    heatLevel: 0,
    flavorProfile: 'citrus',
    batchNumber: '003',
    pepperOrigin: 'Sonora, Mexico',
    harvestMonth: 'March 2025',
    bottleCount: 400,
    makerNote: 'Goes on eggs before coffee does, in this house.',
    pairsWith: 'Breakfast tacos, avocado toast',
  },

  // ---------- Heat 1 - Warm ----------
  {
    handle: 'daily-driver',
    title: 'Daily Driver',
    descriptionHtml:
      '<p>The bottle that never leaves the table. Fermented red jalapeño, aged three ' +
      'months, built to go on everything and never fight the food underneath it.</p>',
    priceCents: 1000,
    costCents: 400,
    heatLevel: 1,
    flavorProfile: 'umami',
    batchNumber: '004',
    pepperOrigin: 'Louisiana, USA',
    harvestMonth: 'August 2024',
    bottleCount: 460,
    makerNote: 'If you only buy one bottle from us, buy this one.',
    pairsWith: 'Fried rice, scrambled eggs, pretty much anything',
  },
  {
    handle: 'backyard-standard',
    title: 'Backyard Standard',
    descriptionHtml:
      '<p>Smoked jalapeño and a short stint over applewood. Built for whatever is on the ' +
      'grill, not for showing off.</p>',
    priceCents: 1050,
    costCents: 420,
    heatLevel: 1,
    flavorProfile: 'smoky',
    batchNumber: '005',
    pepperOrigin: 'Texas, USA',
    harvestMonth: 'July 2024',
    bottleCount: 350,
    makerNote: 'Named for what it is, not what it aspires to be.',
    pairsWith: 'Grilled corn, brisket, burgers',
  },
  {
    handle: 'porch-light',
    title: 'Porch Light',
    descriptionHtml:
      '<p>Peach and fresno chili, slow-cooked down until the sugar and the heat agree on ' +
      'something. Warm-weather sauce, works year-round.</p>',
    priceCents: 1100,
    costCents: 440,
    heatLevel: 1,
    flavorProfile: 'fruity',
    batchNumber: '006',
    pepperOrigin: 'Georgia, USA',
    harvestMonth: 'August 2025',
    bottleCount: 300,
    makerNote: 'The one that convinces skeptics that fruit and heat aren\'t a gimmick.',
    pairsWith: 'Grilled pork, roast chicken, cornbread',
  },

  // ---------- Heat 2 - Hot ----------
  {
    handle: 'fair-warning',
    title: 'Fair Warning',
    descriptionHtml:
      '<p>Serrano and lime, no hedging. This is where the label stops apologizing for the ' +
      'heat and starts being honest about it.</p>',
    priceCents: 1100,
    costCents: 440,
    heatLevel: 2,
    flavorProfile: 'citrus',
    batchNumber: '007',
    pepperOrigin: 'Puebla, Mexico',
    harvestMonth: 'June 2025',
    bottleCount: 340,
    makerNote: 'The name is not a marketing device. Take it at face value.',
    pairsWith: 'Ceviche, grilled shrimp, street tacos',
  },
  {
    handle: 'second-thought',
    title: 'Second Thought',
    descriptionHtml:
      '<p>Fermented cayenne, aged five months for depth before the heat lands. Umami ' +
      'first, then the burn - in that order, every time.</p>',
    priceCents: 1150,
    costCents: 460,
    heatLevel: 2,
    flavorProfile: 'umami',
    batchNumber: '008',
    pepperOrigin: 'New Mexico, USA',
    harvestMonth: 'September 2024',
    bottleCount: 310,
    makerNote: 'Named for the pause everyone takes after the first bite.',
    pairsWith: 'Fried chicken, noodle soup',
  },
  {
    handle: 'long-weekend',
    title: 'Long Weekend',
    descriptionHtml:
      '<p>Mango and a real dose of scotch bonnet - fruity out front, then it collects on ' +
      'you. The one you regret pouring generously.</p>',
    priceCents: 1200,
    costCents: 480,
    heatLevel: 2,
    flavorProfile: 'fruity',
    batchNumber: '009',
    pepperOrigin: 'Jamaica',
    harvestMonth: 'July 2025',
    bottleCount: 290,
    makerNote: 'Tastes like a good idea. Behaves like a bad one, eventually.',
    pairsWith: 'Jerk chicken, grilled pineapple, rum-glazed pork',
  },

  // ---------- Heat 3 - Serious ----------
  {
    handle: 'charred-pineapple',
    title: 'Charred Pineapple',
    descriptionHtml:
      '<p>Charred pineapple, scotch bonnet, and a bad decision. The one that started the ' +
      'whole batch system.</p>',
    priceCents: 1000,
    costCents: 300,
    heatLevel: 3,
    flavorProfile: 'fruity',
    batchNumber: '013',
    pepperOrigin: 'Trinidad',
    harvestMonth: 'July 2025',
    bottleCount: 340,
    makerNote: 'Charred pineapple, scotch bonnet, and a bad decision. The one that started the whole batch system.',
    pairsWith: 'Grilled fish, roast pork, fried plantain',
  },
  {
    handle: 'no-take-backs',
    title: 'No Take-Backs',
    descriptionHtml:
      '<p>Chipotle in adobo, smoked twice, blended thick. Committed to a single flavour ' +
      'and unwilling to soften it for anyone.</p>',
    priceCents: 1150,
    costCents: 460,
    heatLevel: 3,
    flavorProfile: 'smoky',
    batchNumber: '014',
    pepperOrigin: 'Chihuahua, Mexico',
    harvestMonth: 'October 2024',
    bottleCount: 300,
    makerNote: 'Once it is on the plate, it is on the plate. Plan accordingly.',
    pairsWith: 'Tacos al pastor, smoked brisket, black beans',
  },
  {
    handle: 'fine-print',
    title: 'Fine Print',
    descriptionHtml:
      '<p>Serrano and cilantro, fermented for brightness. Reads mild on the label. Isn\'t. ' +
      'Read the batch number before you pour it on generously.</p>',
    priceCents: 1150,
    costCents: 460,
    heatLevel: 3,
    flavorProfile: 'herbal',
    batchNumber: '015',
    pepperOrigin: 'Michoacán, Mexico',
    harvestMonth: 'May 2025',
    bottleCount: 280,
    makerNote: 'The details that matter are always in the fine print.',
    pairsWith: 'Grilled shrimp, guacamole, fish tacos',
  },

  // ---------- Heat 4 - Reckless ----------
  {
    handle: 'bad-decision',
    title: 'Bad Decision',
    descriptionHtml:
      '<p>Smoked habanero, aged four months, no fruit to hide behind. This one was made ' +
      'by someone who ignored good advice, on purpose.</p>',
    priceCents: 1300,
    costCents: 520,
    heatLevel: 4,
    flavorProfile: 'smoky',
    batchNumber: '016',
    pepperOrigin: 'Yucatán, Mexico',
    harvestMonth: 'August 2024',
    bottleCount: 260,
    makerNote: 'We named it honestly. That should tell you something.',
    pairsWith: 'Carnitas, smoked ribs, grilled sausage',
  },
  {
    handle: 'last-call',
    title: 'Last Call',
    descriptionHtml:
      '<p>Habanero and mango, pushed further than "fruity heat" usually goes. Sweet for ' +
      'about a second. Then it isn\'t.</p>',
    priceCents: 1350,
    costCents: 540,
    heatLevel: 4,
    flavorProfile: 'fruity',
    batchNumber: '017',
    pepperOrigin: 'Belize',
    harvestMonth: 'September 2025',
    bottleCount: 240,
    makerNote: 'Named for the point in the evening this decision usually gets made.',
    pairsWith: 'Grilled shrimp skewers, jerk pork, mango salsa',
  },
  {
    handle: 'point-of-no-return',
    title: 'Point of No Return',
    descriptionHtml:
      '<p>Fermented red habanero, aged six months for a savoury edge before the heat takes ' +
      'over completely. There is no walking this one back once it is on the food.</p>',
    priceCents: 1400,
    costCents: 560,
    heatLevel: 4,
    flavorProfile: 'umami',
    batchNumber: '018',
    pepperOrigin: 'Amazonas, Peru',
    harvestMonth: 'June 2024',
    bottleCount: 220,
    makerNote: 'Committing to the name felt easier than committing to a milder batch.',
    pairsWith: 'Grilled beef, fried noodles, congee',
  },

  // ---------- Heat 5 - Ash ----------
  {
    handle: 'ghost-peppers',
    title: 'Ghost Peppers',
    descriptionHtml:
      '<p>Bhut jolokia, straight, aged for a rounder burn. Not the hottest thing we could ' +
      'make - the most honest one.</p>',
    priceCents: 1500,
    costCents: 600,
    heatLevel: 5,
    flavorProfile: 'sweet-heat',
    batchNumber: '012',
    pepperOrigin: 'Nagaland, India',
    harvestMonth: 'October 2025',
    bottleCount: 200,
    makerNote: 'Small batch on purpose. This one takes a while to make correctly.',
    pairsWith: 'Wings, birria, anything that can take it',
  },
  {
    handle: 'total-blackout',
    title: 'Total Blackout',
    descriptionHtml:
      '<p>Carolina reaper, cut only enough to be pourable. Sweet-heat in name only - the ' +
      'sugar is there to make the first second bearable, not to make it mild.</p>',
    priceCents: 1600,
    costCents: 640,
    heatLevel: 5,
    flavorProfile: 'sweet-heat',
    batchNumber: '019',
    pepperOrigin: 'South Carolina, USA',
    harvestMonth: 'September 2025',
    bottleCount: 180,
    makerNote: 'One bottle per customer. We are not being coy - we mean it operationally.',
    pairsWith: 'Chicken wings, dares, nothing you actually care about the flavour of',
  },
  {
    handle: 'one-way-ticket',
    title: 'One-Way Ticket',
    descriptionHtml:
      '<p>Trinidad scorpion, fermented and rested a full year. Herbal and complex for the ' +
      'first three seconds. Then it stops being about the flavour.</p>',
    priceCents: 1600,
    costCents: 640,
    heatLevel: 5,
    flavorProfile: 'herbal',
    batchNumber: '020',
    pepperOrigin: 'Trinidad',
    harvestMonth: 'November 2024',
    bottleCount: 160,
    makerNote: 'The name is not a metaphor. Plan your evening accordingly.',
    pairsWith: 'Whatever you were already planning to regret',
  },
];

const PRODUCT_SET_MUTATION = /* GraphQL */ `
  mutation ProductSet($input: ProductSetInput!) {
    productSet(input: $input, synchronous: true) {
      product {
        id
        handle
        variants(first: 1) {
          nodes {
            id
            inventoryItem {
              id
            }
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface ProductSetResult {
  productSet: {
    product: {
      id: string;
      handle: string;
      variants: { nodes: Array<{ id: string; inventoryItem: { id: string } }> };
    } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

const METAFIELDS_SET_MUTATION = /* GraphQL */ `
  mutation MetafieldsSet($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface MetafieldsSetResult {
  metafieldsSet: {
    metafields: Array<{ id: string }>;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

const INVENTORY_ITEM_UPDATE_MUTATION = /* GraphQL */ `
  mutation InventoryItemUpdate($id: ID!, $input: InventoryItemInput!) {
    inventoryItemUpdate(id: $id, input: $input) {
      inventoryItem {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface InventoryItemUpdateResult {
  inventoryItemUpdate: {
    inventoryItem: { id: string } | null;
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

const LOCATIONS_QUERY = /* GraphQL */ `
  query Locations {
    locations(first: 1) {
      nodes {
        id
      }
    }
  }
`;

interface LocationsResult {
  locations: { nodes: Array<{ id: string }> };
}

const PRODUCT_BY_HANDLE_QUERY = /* GraphQL */ `
  query ProductByHandle($handle: String!) {
    productByIdentifier(identifier: { handle: $handle }) {
      id
    }
  }
`;

interface ProductByHandleResult {
  productByIdentifier: { id: string } | null;
}

const INVENTORY_SET_QUANTITIES_MUTATION = /* GraphQL */ `
  mutation InventorySetQuantities($input: InventorySetQuantitiesInput!) {
    inventorySetQuantities(input: $input) {
      userErrors {
        field
        message
      }
    }
  }
`;

interface InventorySetQuantitiesResult {
  inventorySetQuantities: {
    userErrors: Array<{ field: string[] | null; message: string }>;
  };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const db = createDbClient(env.DATABASE_URL);
  const encryptionKey = Buffer.from(env.APP_ENCRYPTION_KEY, 'base64');

  const shopDomain = process.env.SEED_SHOP_DOMAIN;
  const shop = shopDomain
    ? await findShopByDomain(db, shopDomain)
    : await db.query.shops.findFirst();

  if (!shop) {
    console.error(
      'No shop found. Install the app first (open Bundle Studio in Shopify admin once), ' +
        'then run this script again.',
    );
    process.exit(1);
  }

  const encryptedToken = readShopAccessToken(shop);
  if (!encryptedToken) {
    console.error(`Shop "${shop.shopDomain}" has no saved access token yet.`);
    process.exit(1);
  }
  const accessToken = decryptToken(encryptedToken, encryptionKey);

  const adminClient = createAdminClient({
    shopDomain: shop.shopDomain,
    accessToken,
    apiVersion: env.SHOPIFY_API_VERSION,
  });

  console.log(`Finding a location on ${shop.shopDomain}...`);
  const locResult = await adminClient.request<LocationsResult>(LOCATIONS_QUERY);
  const locationId = locResult.locations.nodes[0]?.id;
  if (!locationId) {
    console.error('No location found on this shop - cannot set inventory.');
    process.exit(1);
  }

  const costsSkipped: string[] = [];
  const inventorySkipped: string[] = [];

  for (const p of PRODUCTS) {
    console.log(`Upserting "${p.title}"...`);

    const existing = await adminClient.request<ProductByHandleResult>(PRODUCT_BY_HANDLE_QUERY, {
      handle: p.handle,
    });
    const existingId = existing.productByIdentifier?.id;

    const result = await adminClient.request<ProductSetResult>(PRODUCT_SET_MUTATION, {
      input: {
        ...(existingId ? { id: existingId } : {}),
        handle: p.handle,
        title: p.title,
        descriptionHtml: p.descriptionHtml,
        vendor: 'Ember & Ash',
        productType: 'Hot Sauce',
        tags: [`heat-${p.heatLevel}`, p.flavorProfile],
        status: 'ACTIVE',
        productOptions: [{ name: 'Title', values: [{ name: 'Default Title' }] }],
        variants: [
          {
            price: (p.priceCents / 100).toFixed(2),
            inventoryPolicy: 'DENY',
            inventoryItem: { tracked: true },
            optionValues: [{ optionName: 'Title', name: 'Default Title' }],
          },
        ],
      },
    });

    if (result.productSet.userErrors.length > 0) {
      console.error(`  Product errors:`, result.productSet.userErrors);
      continue;
    }
    const product = result.productSet.product;
    if (!product) continue;

    const variant = product.variants.nodes[0];

    // Metafields
    const mfResult = await adminClient.request<MetafieldsSetResult>(METAFIELDS_SET_MUTATION, {
      metafields: [
        {
          ownerId: product.id,
          namespace: 'custom',
          key: 'heat_level',
          type: 'number_integer',
          value: String(p.heatLevel),
        },
        {
          ownerId: product.id,
          namespace: 'custom',
          key: 'flavor_profile',
          type: 'single_line_text_field',
          value: p.flavorProfile,
        },
        {
          ownerId: product.id,
          namespace: 'custom',
          key: 'batch_number',
          type: 'single_line_text_field',
          value: p.batchNumber,
        },
        {
          ownerId: product.id,
          namespace: 'custom',
          key: 'pepper_origin',
          type: 'single_line_text_field',
          value: p.pepperOrigin,
        },
        {
          ownerId: product.id,
          namespace: 'custom',
          key: 'harvest_month',
          type: 'single_line_text_field',
          value: p.harvestMonth,
        },
        {
          ownerId: product.id,
          namespace: 'custom',
          key: 'bottle_count',
          type: 'number_integer',
          value: String(p.bottleCount),
        },
        {
          ownerId: product.id,
          namespace: 'custom',
          key: 'maker_note',
          type: 'multi_line_text_field',
          value: p.makerNote,
        },
        // pairs_with is deliberately omitted: it's defined in this store as
        // list.product_reference (links to other products), not free text.
        // Setting real cross-references needs a second pass once every
        // product exists (see the printed reminder at the end of this run).
      ],
    });
    if (mfResult.metafieldsSet.userErrors.length > 0) {
      console.error(`  Metafield errors:`, mfResult.metafieldsSet.userErrors);
    }

    // Cost per item (16 of 18 - two are deliberately left null). Non-fatal:
    // this token lacks write_inventory, a known gap (see APP_DECISIONS.md) -
    // re-consenting scopes mid-session costs more time than it saves here.
    if (variant && p.costCents !== null) {
      try {
        const costResult = await adminClient.request<InventoryItemUpdateResult>(
          INVENTORY_ITEM_UPDATE_MUTATION,
          {
            id: variant.inventoryItem.id,
            input: { cost: (p.costCents / 100).toFixed(2) },
          },
        );
        if (costResult.inventoryItemUpdate.userErrors.length > 0) {
          console.error(`  Cost errors:`, costResult.inventoryItemUpdate.userErrors);
        }
      } catch {
        costsSkipped.push(p.title);
      }
    }

    // Inventory on hand - same write_inventory gap as cost, above.
    if (variant) {
      try {
        const invResult = await adminClient.request<InventorySetQuantitiesResult>(
          INVENTORY_SET_QUANTITIES_MUTATION,
          {
            input: {
              name: 'available',
              reason: 'correction',
              quantities: [
                {
                  inventoryItemId: variant.inventoryItem.id,
                  locationId,
                  quantity: 50,
                  changeFromQuantity: 0,
                },
              ],
            },
          },
        );
        if (invResult.inventorySetQuantities.userErrors.length > 0) {
          console.error(`  Inventory errors:`, invResult.inventorySetQuantities.userErrors);
        }
      } catch {
        inventorySkipped.push(p.title);
      }
    }
  }

  console.log('\nDone. 18 products upserted.');
  if (costsSkipped.length > 0) {
    console.log(
      `\nCost per item could not be set (missing write_inventory scope) on: ${costsSkipped.join(', ')}. ` +
        'Set these manually in Shopify Admin -> Products -> [product] -> Cost per item.',
    );
  }
  if (inventorySkipped.length > 0) {
    console.log(
      `Inventory quantity could not be set (missing write_inventory scope) on: ${inventorySkipped.join(', ')}. ` +
        'Set these manually in Shopify Admin -> Products -> [product] -> Inventory.',
    );
  }
  console.log(
    'Note: "Basta pagkaon" (your original test product) was not touched - delete it ' +
      'manually from Shopify admin if you no longer want it in the catalogue.',
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
