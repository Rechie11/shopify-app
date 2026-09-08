# Day 0 Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Ember & Ash monorepo skeleton — npm workspaces, Docker MySQL, Drizzle schema/migrations, a Fastify server that boots behind a zod-validated environment and a migration gate, and a Vite/React admin shell — so that everything short of an actual Shopify Partner account and dev store install is working and verified.

**Architecture:** Three npm workspaces under `app/` (`db`, `server`, `web`) plus root tooling config, exactly matching the layout in `ARCHITECTURE.md` §3. `app/db` owns the Drizzle schema and committed SQL migrations and is consumed by `app/server` as a workspace dependency. `app/server` is the Fastify composition root: it validates `process.env` with zod, runs pending migrations as a startup gate, then exposes `/healthz` and `/readyz`. `app/web` is an empty-but-real Vite + React shell wired to load Shopify App Bridge and Polaris from Shopify's CDN, ready for the admin UI work in later days. The `theme/` directory and the actual `shopify app dev` install flow are out of scope for this plan — they need a Shopify Partner account and dev store the user doesn't have yet.

**Tech Stack:** Node.js ≥22, TypeScript (strict, ESM), npm workspaces, Fastify 5, zod, Drizzle ORM (`drizzle-orm/mysql2`) + `drizzle-kit`, MySQL 8 via Docker Compose, Vite 6 + React 19, vitest, ESLint 9 (flat config) + Prettier.

**Spec:** `README.md`, `ARCHITECTURE.md` (§3 repo layout, §5.3 token storage, §11 observability/migration gate, §13 environments), `SCHEMA.md` (§1 conventions, §3.1–3.2 `shops`/`sessions`), `BUILD_PLAN.md` (Day 0 checklist) — all at the repo root.

## Global Constraints

- Node.js 22 LTS or newer — every `package.json` declares `"engines": { "node": ">=22" }`.
- TypeScript `strict: true` everywhere, every workspace `tsconfig.json` extends the root `tsconfig.base.json`.
- ESM throughout — every Node workspace `package.json` sets `"type": "module"`; no CommonJS.
- Every environment variable is validated with zod at boot; the process refuses to start on a missing or malformed value rather than failing later with a confusing error (README §"Configure the environment").
- Admin API version is pinned to the single constant `2026-07` everywhere it appears — never `unstable`, never unversioned (ARCHITECTURE §8).
- Drizzle: generated SQL migrations are committed and reviewed; `drizzle-kit push` is never run against a database that holds data (SCHEMA §5.2).
- Migrations run as an explicit startup gate — the server refuses to serve traffic if the database is behind (ARCHITECTURE §11).
- Timestamps are `DATETIME(3)` in UTC; `created_at`/`updated_at` on every table (SCHEMA §1).

---

### Task 1: Git repository and baseline ignores

**Files:**
- Create: `.gitignore`
- Modify: none (existing docs at repo root are untouched, just added to the first commit)

**Interfaces:**
- Produces: an initialized git repository at `C:\Users\Wacky\Documents\Shopify` with an initial commit containing the existing planning docs.

- [ ] **Step 1: Initialize the repository**

Run: `git init` (from the repo root)
Expected: `Initialized empty Git repository in .../\.git/`

- [ ] **Step 2: Write `.gitignore`**

```gitignore
# dependencies
node_modules/

# build output
dist/
build/

# env
.env
.env.local

# logs
*.log
npm-debug.log*

# editors / OS
.DS_Store
Thumbs.db
.vscode/*
!.vscode/extensions.json

# test / coverage
coverage/

# misc
*.tsbuildinfo
```

- [ ] **Step 3: Stage and commit the existing docs plus the ignore file**

```bash
git add .gitignore README.md APP_DECISIONS.md ARCHITECTURE.md SCHEMA.md THEME_SPEC.md BUILD_PLAN.md
git commit -m "chore: initialize repository with planning docs"
```

Expected: `git log --oneline` shows one commit; `git status` is clean except for the untouched `Claude outputs/` folder (leave it — it is the user's own backup copy, not part of the repo layout in `ARCHITECTURE.md`).

---

### Task 2: Root workspace configuration

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.env.example`

**Interfaces:**
- Produces: the npm workspaces root (`app/db`, `app/server`, `app/web`), shared TypeScript strict config, shared lint/format config, and the documented environment variable list.

- [ ] **Step 1: Write the root `package.json`**

```json
{
  "name": "ember-and-ash",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "workspaces": [
    "app/db",
    "app/server",
    "app/web"
  ],
  "scripts": {
    "dev": "shopify app dev",
    "dev:server": "npm run dev --workspace=app/server",
    "dev:web": "npm run dev --workspace=app/web",
    "build": "npm run build --workspace=app/db && npm run build --workspace=app/web && npm run build --workspace=app/server",
    "db:generate": "npm run db:generate --workspace=app/db",
    "db:migrate": "npm run db:migrate --workspace=app/db",
    "db:studio": "npm run db:studio --workspace=app/db",
    "test": "npm run test --workspaces --if-present",
    "lint": "eslint .",
    "format": "prettier --check .",
    "typecheck": "npm run typecheck --workspaces --if-present"
  },
  "devDependencies": {
    "@eslint/js": "^9.13.0",
    "eslint": "^9.13.0",
    "eslint-config-prettier": "^9.1.0",
    "prettier": "^3.3.3",
    "typescript": "^5.6.3",
    "typescript-eslint": "^8.11.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "declaration": false,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Write `eslint.config.js`**

```js
// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/migrations/**', 'app/web/vite.config.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
);
```

- [ ] **Step 4: Write `.prettierrc.json`**

```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100
}
```

- [ ] **Step 5: Write `.env.example`**

```bash
NODE_ENV=development
PORT=3000
DATABASE_URL=mysql://ember:ember@localhost:3306/ember_ash
SHOPIFY_API_KEY=
SHOPIFY_API_SECRET=
SHOPIFY_SCOPES=read_products,read_inventory,read_orders,write_discounts,write_products
SHOPIFY_APP_URL=
SHOPIFY_API_VERSION=2026-07
APP_ENCRYPTION_KEY=
LOG_LEVEL=info
SCORE_MARGIN_FLOOR_BPS=3000
SCORE_MARGIN_TARGET_BPS=5500
```

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.base.json eslint.config.js .prettierrc.json .env.example
git commit -m "chore: add root workspace, TypeScript, and lint configuration"
```

Note: do not run `npm install` yet — the `workspaces` array references `app/db`, `app/server`, `app/web`, which do not exist until Tasks 4, 6, and 8. Running it now would just warn and skip them.

---

### Task 3: Docker Compose MySQL service

**Files:**
- Create: `docker-compose.yml`

**Interfaces:**
- Produces: a MySQL 8 instance reachable at `mysql://ember:ember@localhost:3306/ember_ash`, matching `DATABASE_URL` in `.env.example`.

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  mysql:
    image: mysql:8.0
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: ember_ash
      MYSQL_USER: ember
      MYSQL_PASSWORD: ember
      MYSQL_ROOT_PASSWORD: root
    ports:
      - '3306:3306'
    volumes:
      - mysql_data:/var/lib/mysql
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost', '-u', 'ember', '-pember']
      interval: 5s
      timeout: 5s
      retries: 10

volumes:
  mysql_data:
```

- [ ] **Step 2: Start it and wait for healthy**

Run: `docker compose up -d`
Then: `docker compose ps`
Expected: the `mysql` service shows `(healthy)` within about 30 seconds. If it stays `(starting)`, run `docker compose logs mysql` and check for a port conflict on 3306.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add Docker Compose MySQL 8 service"
```

Leave the container running — Tasks 5 and 7 need it.

---

### Task 4: Database package — schema, client, migration runtime

**Files:**
- Create: `app/db/package.json`
- Create: `app/db/tsconfig.json`
- Create: `app/db/drizzle.config.ts`
- Create: `app/db/src/schema/shops.ts`
- Create: `app/db/src/schema/sessions.ts`
- Create: `app/db/src/schema/index.ts`
- Create: `app/db/src/client.ts`
- Create: `app/db/src/migrate-runtime.ts`
- Create: `app/db/src/index.ts`

**Interfaces:**
- Consumes: nothing (first workspace built).
- Produces (the `@ember-and-ash/db` package, consumed by Task 6/7):
  - `schema.shops`, `schema.sessions` — Drizzle table objects.
  - `type Database` — the drizzle-orm mysql2 database instance type.
  - `createDb(databaseUrl: string): { db: Database; pool: mysql.Pool }`.
  - `runMigrations(db: Database): Promise<void>`.

- [ ] **Step 1: Write `app/db/package.json`**

```json
{
  "name": "@ember-and-ash/db",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:studio": "drizzle-kit studio",
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "drizzle-orm": "^0.36.1",
    "mysql2": "^3.11.4"
  },
  "devDependencies": {
    "drizzle-kit": "^0.28.0",
    "typescript": "^5.6.3"
  }
}
```

- [ ] **Step 2: Write `app/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write the `shops` schema — `app/db/src/schema/shops.ts`**

```ts
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

export const shops = mysqlTable('shops', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  shopDomain: varchar('shop_domain', { length: 255 }).notNull().unique(),
  shopifyShopGid: varchar('shopify_shop_gid', { length: 255 }),
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
```

- [ ] **Step 4: Write the `sessions` schema — `app/db/src/schema/sessions.ts`**

```ts
import { relations, sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  datetime,
  index,
  mysqlTable,
  varbinary,
  varchar,
} from 'drizzle-orm/mysql-core';
import { shops } from './shops.js';

export const sessions = mysqlTable(
  'sessions',
  {
    id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
    shopId: bigint('shop_id', { mode: 'number', unsigned: true })
      .notNull()
      .references(() => shops.id, { onDelete: 'cascade' }),
    sessionId: varchar('session_id', { length: 255 }).notNull().unique(),
    isOnline: boolean('is_online').notNull().default(false),
    staffUserId: bigint('staff_user_id', { mode: 'number', unsigned: true }),
    staffEmailHash: varbinary('staff_email_hash', { length: 32 }),
    expiresAt: datetime('expires_at', { fsp: 3 }).notNull(),
    createdAt: datetime('created_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3)`),
    updatedAt: datetime('updated_at', { fsp: 3 })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)`),
  },
  (t) => ({
    shopExpiry: index('ix_sessions_shop_expiry').on(t.shopId, t.expiresAt),
  }),
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  shop: one(shops, { fields: [sessions.shopId], references: [shops.id] }),
}));
```

- [ ] **Step 5: Write the barrel — `app/db/src/schema/index.ts`**

```ts
export * from './shops.js';
export * from './sessions.js';
```

- [ ] **Step 6: Write the client factory — `app/db/src/client.ts`**

```ts
import { drizzle } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import * as schema from './schema/index.js';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(databaseUrl: string): { db: Database; pool: mysql.Pool } {
  const pool = mysql.createPool(databaseUrl);
  const db = drizzle(pool, { schema, mode: 'default' });
  return { db, pool };
}
```

- [ ] **Step 7: Write the migration runtime gate — `app/db/src/migrate-runtime.ts`**

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import type { Database } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(__dirname, '../migrations');

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}
```

- [ ] **Step 8: Write the package entry — `app/db/src/index.ts`**

```ts
export * from './client.js';
export * from './migrate-runtime.js';
export * as schema from './schema/index.js';
```

- [ ] **Step 9: Write `app/db/drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/index.ts',
  out: './migrations',
  dialect: 'mysql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'mysql://ember:ember@localhost:3306/ember_ash',
  },
});
```

- [ ] **Step 10: Install dependencies, typecheck, and build**

Run: `npm install` (from the repo root)
Then: `npm run typecheck --workspace=app/db`
Then: `npm run build --workspace=app/db`
Expected: all three succeed with no errors, and `app/db/dist/index.js` plus `app/db/dist/index.d.ts` now exist. `package.json` points `main`/`types` at `dist/`, not `src/`, so downstream workspaces (Task 6 onward) resolve the built output — re-run this build step any time `app/db/src` changes.

- [ ] **Step 11: Commit**

```bash
git add app/db package.json package-lock.json
git commit -m "feat(db): add Drizzle schema for shops and sessions"
```

Note: `app/db/dist` is gitignored (Task 1) — it is a build artifact, not committed.

---

### Task 5: Generate and apply the first migration

**Files:**
- Create: `app/db/migrations/0000_*.sql` (name chosen by `drizzle-kit generate`)
- Create: `app/db/migrations/meta/` (drizzle-kit's own bookkeeping)

**Interfaces:**
- Consumes: `app/db/drizzle.config.ts` and `app/db/src/schema/index.ts` from Task 4.
- Produces: a committed SQL migration that Task 7's `runMigrations()` gate applies at server boot.

- [ ] **Step 1: Generate the migration**

Run: `DATABASE_URL="mysql://ember:ember@localhost:3306/ember_ash" npm run db:generate --workspace=app/db`
Expected: a new file `app/db/migrations/0000_<generated-name>.sql` appears, containing `CREATE TABLE shops (...)` and `CREATE TABLE sessions (...)` statements.

- [ ] **Step 2: Read the generated SQL and confirm it matches the schema**

Open the generated file and confirm both tables are present with the columns from Task 4, and that `sessions` has a foreign key to `shops(id)` with `ON DELETE CASCADE`. If drizzle-kit named the FK constraint or ordered columns differently, that is fine — do not hand-edit the file (SCHEMA §5.2: generated SQL is committed, never hand-edited). If a column is missing, fix the schema file from Task 4 and regenerate.

- [ ] **Step 3: Apply the migration**

Run: `DATABASE_URL="mysql://ember:ember@localhost:3306/ember_ash" npm run db:migrate --workspace=app/db`
Expected: exits 0. Verify with:
`docker compose exec mysql mysql -uember -pember ember_ash -e "SHOW TABLES;"`
Expected output includes `shops`, `sessions`, and drizzle's own `__drizzle_migrations` tracking table.

- [ ] **Step 4: Commit**

```bash
git add app/db/migrations
git commit -m "feat(db): generate initial migration for shops and sessions"
```

---

### Task 6: Server environment validation

**Files:**
- Create: `app/server/package.json`
- Create: `app/server/tsconfig.json`
- Create: `app/server/src/config/env.ts`
- Create: `app/server/vitest.config.ts`
- Test: `app/server/test/config/env.test.ts`

**Interfaces:**
- Produces (consumed by Task 7): `loadEnv(source?: NodeJS.ProcessEnv): Env` and `type Env` from `app/server/src/config/env.ts`.

- [ ] **Step 1: Write `app/server/package.json`**

```json
{
  "name": "@ember-and-ash/server",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ember-and-ash/db": "*",
    "dotenv": "^16.4.5",
    "fastify": "^5.1.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.19.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 2: Write `app/server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `app/server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Install dependencies**

Run: `npm install` (from the repo root)
Expected: `app/server/node_modules` links `@ember-and-ash/db` to the local workspace.

- [ ] **Step 5: Write the failing test — `app/server/test/config/env.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const validEnv = {
  DATABASE_URL: 'mysql://ember:ember@localhost:3306/ember_ash',
  SHOPIFY_API_KEY: 'test-api-key',
  SHOPIFY_API_SECRET: 'test-api-secret',
  SHOPIFY_APP_URL: 'https://example.trycloudflare.com',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

describe('loadEnv', () => {
  it('parses a complete, valid environment and applies documented defaults', () => {
    const env = loadEnv(validEnv);

    expect(env.DATABASE_URL).toBe(validEnv.DATABASE_URL);
    expect(env.SHOPIFY_API_VERSION).toBe('2026-07');
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.SCORE_MARGIN_FLOOR_BPS).toBe(3000);
    expect(env.SCORE_MARGIN_TARGET_BPS).toBe(5500);
  });

  it('throws when a required variable is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = validEnv;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws when APP_ENCRYPTION_KEY does not decode to 32 bytes', () => {
    expect(() => loadEnv({ ...validEnv, APP_ENCRYPTION_KEY: 'dG9vLXNob3J0' })).toThrow(
      /APP_ENCRYPTION_KEY/,
    );
  });

  it('throws when SHOPIFY_APP_URL is not a valid URL', () => {
    expect(() => loadEnv({ ...validEnv, SHOPIFY_APP_URL: 'not-a-url' })).toThrow(
      /SHOPIFY_APP_URL/,
    );
  });
});
```

- [ ] **Step 6: Run the test to confirm it fails**

Run: `npm run test --workspace=app/server`
Expected: FAIL — `Cannot find module '../../src/config/env.js'` (the file doesn't exist yet).

- [ ] **Step 7: Implement `app/server/src/config/env.ts`**

```ts
import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SHOPIFY_API_KEY: z.string().min(1, 'SHOPIFY_API_KEY is required'),
  SHOPIFY_API_SECRET: z.string().min(1, 'SHOPIFY_API_SECRET is required'),
  SHOPIFY_SCOPES: z
    .string()
    .min(1)
    .default('read_products,read_inventory,read_orders,write_discounts,write_products'),
  SHOPIFY_APP_URL: z.string().url('SHOPIFY_APP_URL must be a valid URL'),
  SHOPIFY_API_VERSION: z.string().min(1).default('2026-07'),
  APP_ENCRYPTION_KEY: z
    .string()
    .min(1, 'APP_ENCRYPTION_KEY is required')
    .refine((value) => Buffer.from(value, 'base64').length === 32, {
      message: 'APP_ENCRYPTION_KEY must decode to exactly 32 bytes of base64',
    }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SCORE_MARGIN_FLOOR_BPS: z.coerce.number().int().min(0).max(10000).default(3000),
  SCORE_MARGIN_TARGET_BPS: z.coerce.number().int().min(0).max(10000).default(5500),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
```

- [ ] **Step 8: Run the test to confirm it passes**

Run: `npm run test --workspace=app/server`
Expected: PASS — all 4 tests green.

- [ ] **Step 9: Commit**

```bash
git add app/server package.json package-lock.json
git commit -m "feat(server): add zod-validated environment loading"
```

---

### Task 7: Server boot, migration gate, and health routes

**Files:**
- Create: `app/server/src/http/routes/health.ts`
- Create: `app/server/src/index.ts`
- Test: `app/server/test/http/health.test.ts`

**Interfaces:**
- Consumes: `loadEnv`/`Env` (Task 6), `createDb`/`runMigrations`/`Database` (Task 4).
- Produces: `healthRoutes(app: FastifyInstance, opts: { pool: mysql.Pool }): Promise<void>` and `buildServer(): Promise<{ app: FastifyInstance; env: Env; pool: mysql.Pool }>`.

- [ ] **Step 1: Write the failing test — `app/server/test/http/health.test.ts`**

```ts
import { describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { healthRoutes } from '../../src/http/routes/health.js';

function buildAppWithPool(pool: { query: ReturnType<typeof vi.fn> }) {
  const app = Fastify();
  return app.register(healthRoutes, { pool: pool as never }).then(() => app);
}

describe('health routes', () => {
  it('GET /healthz returns ok without touching the database', async () => {
    const pool = { query: vi.fn() };
    const app = await buildAppWithPool(pool);

    const response = await app.inject({ method: 'GET', url: '/healthz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('GET /readyz returns ready when the database responds', async () => {
    const pool = { query: vi.fn().mockResolvedValue([[{ '1': 1 }]]) };
    const app = await buildAppWithPool(pool);

    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
  });

  it('GET /readyz returns 503 when the database is unreachable', async () => {
    const pool = { query: vi.fn().mockRejectedValue(new Error('connection refused')) };
    const app = await buildAppWithPool(pool);

    const response = await app.inject({ method: 'GET', url: '/readyz' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm run test --workspace=app/server`
Expected: FAIL — `Cannot find module '../../src/http/routes/health.js'`.

- [ ] **Step 3: Implement `app/server/src/http/routes/health.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import type { Pool } from 'mysql2/promise';

export async function healthRoutes(app: FastifyInstance, opts: { pool: Pool }): Promise<void> {
  app.get('/healthz', async () => ({ status: 'ok' }));

  app.get('/readyz', async (_request, reply) => {
    try {
      await opts.pool.query('SELECT 1');
      return { status: 'ready' };
    } catch (error) {
      app.log.error({ err: error }, 'readyz check failed: database unreachable');
      return reply.code(503).send({ status: 'not_ready' });
    }
  });
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm run test --workspace=app/server`
Expected: PASS — all 3 tests green.

- [ ] **Step 5: Write the composition root — `app/server/src/index.ts`**

```ts
import { createDb, runMigrations } from '@ember-and-ash/db';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Pool } from 'mysql2/promise';
import { loadEnv, type Env } from './config/env.js';
import { healthRoutes } from './http/routes/health.js';

export async function buildServer(): Promise<{ app: FastifyInstance; env: Env; pool: Pool }> {
  const env = loadEnv();
  const { db, pool } = createDb(env.DATABASE_URL);

  await runMigrations(db);

  const app = Fastify({ logger: { level: env.LOG_LEVEL } });
  await app.register(healthRoutes, { pool });

  return { app, env, pool };
}

async function main(): Promise<void> {
  const { app, env, pool } = await buildServer();
  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
  } catch (error) {
    app.log.error(error);
    await pool.end();
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
```

- [ ] **Step 6: Manual boot check against the real database**

Copy `.env.example` to `.env` at the repo root, then fill in placeholder-but-valid values so zod accepts them (real Shopify credentials come in Task 9/later days):

```bash
SHOPIFY_API_KEY=dev-placeholder-key
SHOPIFY_API_SECRET=dev-placeholder-secret
SHOPIFY_APP_URL=https://localhost.trycloudflare.com
APP_ENCRYPTION_KEY=<output of the command below>
```

Generate the encryption key: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`

Confirm `docker compose ps` shows `mysql` healthy, then run: `npm run dev:server`
Expected: the log shows the Fastify server listening on port 3000, with no migration errors.

In a second terminal:
```bash
curl -s http://localhost:3000/healthz
curl -s http://localhost:3000/readyz
```
Expected: `{"status":"ok"}` and `{"status":"ready"}`. Stop the server with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git add app/server
git commit -m "feat(server): boot Fastify behind a migration gate with health routes"
```

Note: do not commit `.env` — it is gitignored by Task 1.

---

### Task 8: Web — Vite + React admin shell

**Files:**
- Create: `app/web/package.json`
- Create: `app/web/tsconfig.json`
- Create: `app/web/vite.config.ts`
- Create: `app/web/index.html`
- Create: `app/web/src/main.tsx`

**Interfaces:**
- Produces: a Vite dev server at `http://localhost:5173` serving a React root, with Shopify App Bridge and Polaris loaded from `cdn.shopify.com` (ARCHITECTURE §3), ready for App Bridge wiring in a later day.

- [ ] **Step 1: Write `app/web/package.json`**

```json
{
  "name": "@ember-and-ash/web",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.3.3",
    "typescript": "^5.6.3",
    "vite": "^6.0.0"
  }
}
```

- [ ] **Step 2: Write `app/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `app/web/vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
});
```

- [ ] **Step 4: Write `app/web/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Bundle Studio</title>
    <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
    <script src="https://cdn.shopify.com/shopifycloud/polaris.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Write `app/web/src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  return <div>Bundle Studio</div>;
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Install and typecheck**

Run: `npm install` (from the repo root)
Then: `npm run typecheck --workspace=app/web`
Expected: no errors.

- [ ] **Step 7: Manual verification**

Run: `npm run dev:web`
Expected: Vite prints a local URL (`http://localhost:5173/`). Open it in a browser (or `curl -s http://localhost:5173/ | grep 'id="root"'`) and confirm the page renders the text "Bundle Studio" with no console errors about App Bridge or Polaris failing to load. Stop the dev server with Ctrl+C.

- [ ] **Step 8: Commit**

```bash
git add app/web
git commit -m "feat(web): add Vite + React admin shell loading App Bridge and Polaris"
```

---

### Task 9: Shopify app configuration

**Files:**
- Create: `shopify.app.toml`

**Interfaces:**
- Produces: the app config template that `shopify app dev` reads and updates in place once the user has a Partner account and runs the CLI (out of scope for this plan).

- [ ] **Step 1: Write `shopify.app.toml`**

```toml
name = "Bundle Studio"
client_id = ""
application_url = "https://replace-with-tunnel-url.example.com/"
embedded = true

[build]
automatically_update_urls_on_dev = true

[access_scopes]
scopes = "read_products,read_inventory,read_orders,write_discounts,write_products"

[auth]
redirect_urls = ["https://replace-with-tunnel-url.example.com/auth/callback"]

[app_proxy]
url = "https://replace-with-tunnel-url.example.com/proxy"
subpath = "flights"
prefix = "apps"

[webhooks]
api_version = "2026-07"
```

- [ ] **Step 2: Note the manual follow-up (do not attempt automatically)**

This file is a template. `client_id` and every `https://replace-with-tunnel-url.example.com` placeholder are filled in automatically the first time the user runs `shopify app dev` after creating a Shopify Partner account, a development store, and logging in via the Shopify CLI (`npm install -g @shopify/cli`, then `npm run dev`). That step needs interactive browser login and is explicitly out of scope for this plan per the user's earlier answer (no Partner account yet).

- [ ] **Step 3: Commit**

```bash
git add shopify.app.toml
git commit -m "chore: add Shopify app configuration template"
```

---

### Task 10: Root script wiring and full Day 0 verification pass

**Files:**
- Modify: none (verification only — every file needed already exists from Tasks 1–9)

**Interfaces:**
- Consumes: every workspace built in Tasks 1–9.
- Produces: a verified, reproducible Day 0 state matching the `BUILD_PLAN.md` Day 0 end-of-day check (minus the actual Shopify admin install, which needs the Partner account).

- [ ] **Step 1: Clean reinstall**

Run: `rm -rf node_modules app/db/node_modules app/db/dist app/server/node_modules app/web/node_modules`
Then: `npm install` (from the repo root)
Then: `npm run build --workspace=app/db`
Expected: install exits 0, no `EUNSUPPORTEDPROTOCOL` or workspace-linking errors — `app/server/node_modules/@ember-and-ash/db` should be a symlink into `app/db`. The build recreates `app/db/dist`, which `app/server` and its tests resolve `@ember-and-ash/db` against.

- [ ] **Step 2: Database from a clean container**

Run: `docker compose down -v && docker compose up -d`
Wait for `docker compose ps` to show `mysql` healthy, then:
`DATABASE_URL="mysql://ember:ember@localhost:3306/ember_ash" npm run db:migrate`
Expected: exits 0. Re-run `SHOW TABLES;` (Task 5 Step 3 command) and confirm `shops`, `sessions`, `__drizzle_migrations` exist.

- [ ] **Step 3: Lint and typecheck across every workspace**

Run: `npm run lint`
Expected: no errors (warnings are acceptable at this stage; fix any errors before continuing).

Run: `npm run typecheck`
Expected: exits 0 across `app/db`, `app/server`, `app/web`.

- [ ] **Step 4: Full test suite**

Run: `npm test`
Expected: all vitest suites in `app/server` pass (7 tests total: 4 env + 3 health).

- [ ] **Step 5: Server boots and passes health checks**

With `.env` present at the repo root (from Task 7 Step 6) and `mysql` healthy, run: `npm run dev:server`
In a second terminal: `curl -s http://localhost:3000/healthz && curl -s http://localhost:3000/readyz`
Expected: `{"status":"ok"}` then `{"status":"ready"}`. Stop the server.

- [ ] **Step 6: Web dev server serves the admin shell**

Run: `npm run dev:web`
Confirm `http://localhost:5173/` renders "Bundle Studio" (Task 8 Step 7). Stop the dev server.

- [ ] **Step 7: Record what is still open**

Confirm the following are true and, if so, this plan is complete:
- `npm run dev:server` and `npm run dev:web` both work independently.
- `npm run dev` (the `shopify app dev` wrapper) is wired but **not yet run** — it needs a Shopify Partner account, a development store, and `shopify` CLI login, none of which exist yet per the user's answer at the start of this plan.
- `theme/` does not exist yet — it is Day 4 per `BUILD_PLAN.md`.
- `app/db` only has `shops` and `sessions` — `bundles`, `bundle_items`, scoring, etc. are Day 2/3.

- [ ] **Step 8: Final commit**

```bash
git status
git add -A
git commit -m "chore: verify Day 0 foundations end to end" --allow-empty
```

Expected: `git log --oneline` shows the full Task 1–10 history; working tree is clean.
