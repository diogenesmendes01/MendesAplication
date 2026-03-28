// ============================================================
// CNPJ Lookup via External CNPJ Database
// ============================================================
// Queries a SEPARATE PostgreSQL instance (cnpj_db) to find a
// company's CNPJ by matching the email domain against the
// `estabelecimentos` table (trigram index on email column).
//
// ⚠️  This is NOT the main ERP database — uses raw pg Pool.
// ⚠️  Connection string must be set via CNPJ_DATABASE_URL env var.

import { Pool } from "pg";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Free email domains — skip CNPJ lookup for these
// ---------------------------------------------------------------------------

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.com.br",
  "outlook.com",
  "outlook.com.br",
  "live.com",
  "yahoo.com",
  "yahoo.com.br",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "protonmail.com",
  "proton.me",
  "mail.com",
  "zoho.com",
  "yandex.com",
  "uol.com.br",
  "bol.com.br",
  "terra.com.br",
  "ig.com.br",
  "globo.com",
  "r7.com",
  "msn.com",
]);

// ---------------------------------------------------------------------------
// Pool singleton (lazy init)
// ---------------------------------------------------------------------------

let pool: Pool | null = null;

function getPool(): Pool | null {
  if (pool) return pool;

  const connectionString = process.env.CNPJ_DATABASE_URL;
  if (!connectionString) {
    logger.warn("[cnpj-lookup] CNPJ_DATABASE_URL not set, CNPJ lookup disabled");
    return null;
  }

  pool = new Pool({
    connectionString,
    max: 3, // Low concurrency — this is a lookup-only connection
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 60_000, // 60s minimum as specified
  });

  pool.on("error", (err) => {
    logger.error({ err }, "[cnpj-lookup] Unexpected pool error");
  });

  return pool;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CnpjLookupResult {
  cnpj: string; // 14-digit numeric string
  razaoSocial: string;
  nomeFantasia: string | null;
}

/**
 * Extract the domain part from an email address.
 * Returns null if the email is invalid or empty.
 */
export function extractDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const trimmed = email.trim().toLowerCase();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex < 1) return null;
  const domain = trimmed.slice(atIndex + 1);
  if (!domain || !domain.includes(".")) return null;
  return domain;
}

/**
 * Check if a domain is a free/personal email provider.
 */
export function isFreeEmailDomain(domain: string): boolean {
  return FREE_EMAIL_DOMAINS.has(domain.toLowerCase());
}

/**
 * Look up a CNPJ by email domain in the external CNPJ database.
 *
 * Queries `estabelecimentos` JOIN `empresas` using the trigram index
 * on `email` column. Returns the first match or null.
 *
 * Only queries ONE domain at a time to avoid timeouts.
 */
export async function lookupCnpjByDomain(
  domain: string
): Promise<CnpjLookupResult | null> {
  const cnpjPool = getPool();
  if (!cnpjPool) return null;

  if (isFreeEmailDomain(domain)) {
    logger.debug(`[cnpj-lookup] Skipping free email domain: ${domain}`);
    return null;
  }

  try {
    const result = await cnpjPool.query<{
      cnpj_basico: string;
      cnpj_ordem: string;
      cnpj_dv: string;
      razao_social: string;
      nome_fantasia: string | null;
    }>(
      `SELECT
         e.cnpj_basico,
         e.cnpj_ordem,
         e.cnpj_dv,
         emp.razao_social,
         emp.nome_fantasia
       FROM estabelecimentos e
       JOIN empresas emp ON emp.cnpj_basico = e.cnpj_basico
       WHERE e.email ILIKE $1
       LIMIT 1`,
      [`%@${domain}`]
    );

    if (result.rows.length === 0) {
      logger.debug(`[cnpj-lookup] No CNPJ found for domain: ${domain}`);
      return null;
    }

    const row = result.rows[0];
    const cnpj = `${row.cnpj_basico}${row.cnpj_ordem}${row.cnpj_dv}`;

    logger.info(`[cnpj-lookup] Found CNPJ ${cnpj} for domain ${domain}`);

    return {
      cnpj,
      razaoSocial: row.razao_social,
      nomeFantasia: row.nome_fantasia,
    };
  } catch (err) {
    logger.error({ err, domain }, "[cnpj-lookup] Error querying CNPJ database");
    return null;
  }
}

/**
 * Attempt to find a CNPJ from the consumer's email.
 * Returns the 14-digit CNPJ string or null if not found / not applicable.
 */
export async function lookupCnpjByEmail(
  email: string | null | undefined
): Promise<CnpjLookupResult | null> {
  const domain = extractDomain(email);
  if (!domain) return null;
  if (isFreeEmailDomain(domain)) return null;
  return lookupCnpjByDomain(domain);
}

/**
 * Gracefully shut down the CNPJ database pool.
 * Call during app shutdown to avoid lingering connections.
 */
export async function closeCnpjPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
