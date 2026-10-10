import { neon } from '@neondatabase/serverless';
import { logger } from '../logger';

type NeonQuery = ReturnType<typeof neon<false, true>>;

let sql: NeonQuery | null = null;
let initializePromise: Promise<void> | null = null;

function getConnectionString() {
  const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (!connectionString) {
    throw new Error('Missing DATABASE_URL or POSTGRES_URL for Neon Postgres connection');
  }

  return connectionString;
}

function getSql() {
  if (!sql) {
    sql = neon<false, true>(getConnectionString(), { fullResults: true });
    logger.info('Neon HTTP query client created');
  }

  return sql;
}

export async function initializeDatabase() {
  if (initializePromise) return initializePromise;

  initializePromise = (async () => {
    const statements = [
      `
      CREATE TABLE IF NOT EXISTS customers (
        id BIGSERIAL PRIMARY KEY,
        "fullName" TEXT NOT NULL,
        "normalizedPhone" TEXT,
        email TEXT,
        "externalCustomerId" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE UNIQUE INDEX IF NOT EXISTS customers_normalized_phone_unique
        ON customers ("normalizedPhone")
        WHERE "normalizedPhone" IS NOT NULL`,

      `CREATE UNIQUE INDEX IF NOT EXISTS customers_external_customer_id_unique
        ON customers ("externalCustomerId")
        WHERE "externalCustomerId" IS NOT NULL`,

      `CREATE INDEX IF NOT EXISTS customers_name_lower_idx
        ON customers (LOWER("fullName"))`,

      `CREATE INDEX IF NOT EXISTS customers_email_lower_idx
        ON customers (LOWER(email))`,

      `CREATE TABLE IF NOT EXISTS consultations (
        id BIGSERIAL PRIMARY KEY,
        "customerId" BIGINT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
        summary TEXT NOT NULL,
        topic TEXT,
        "consultedAt" TIMESTAMPTZ NOT NULL,
        "revisionCount" INTEGER NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE INDEX IF NOT EXISTS consultations_customer_time_idx
        ON consultations ("customerId", "consultedAt" DESC)`,

      `CREATE INDEX IF NOT EXISTS consultations_consulted_at_idx
        ON consultations ("consultedAt" DESC)`,

      `CREATE TABLE IF NOT EXISTS consultation_handwritten_summary_images (
        id BIGSERIAL PRIMARY KEY,
        "consultationId" BIGINT NOT NULL UNIQUE REFERENCES consultations(id) ON DELETE RESTRICT,
        "fileName" TEXT NOT NULL,
        "mimeType" TEXT NOT NULL,
        "base64Data" TEXT NOT NULL,
        "byteSize" INTEGER NOT NULL CHECK ("byteSize" > 0),
        sha256 TEXT NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,

      `CREATE TABLE IF NOT EXISTS consultation_revisions (
        id BIGSERIAL PRIMARY KEY,
        "consultationId" BIGINT NOT NULL REFERENCES consultations(id) ON DELETE RESTRICT,
        "revisionNumber" INTEGER NOT NULL,
        summary TEXT NOT NULL,
        topic TEXT,
        "consultedAt" TIMESTAMPTZ NOT NULL,
        "changeNote" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT consultation_revisions_unique_number
          UNIQUE ("consultationId", "revisionNumber")
      )`,

      `CREATE INDEX IF NOT EXISTS consultation_revisions_timeline_idx
        ON consultation_revisions ("consultationId", "revisionNumber" ASC);
    `
    ];

    for (const statement of statements) {
      await getSql().query(statement);
    }

    logger.info('Neon schema initialized');
  })();

  initializePromise.catch((error) => {
    initializePromise = null;
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Database initialization failed');
  });

  return initializePromise;
}

export async function query<T = unknown>(text: string, values: unknown[] = []): Promise<T[]> {
  await initializeDatabase();
  const result = await getSql().query(text, values);
  return result.rows as T[];
}

export async function execute(text: string, values: unknown[] = []) {
  await initializeDatabase();
  return getSql().query(text, values);
}
