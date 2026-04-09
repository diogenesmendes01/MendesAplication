/**
 * Vitest global test setup.
 * Sets required environment variables that modules read at import time.
 * These are test-only values and do NOT represent real credentials.
 */

// JWT secrets — required by src/lib/auth.ts at module load time
process.env.JWT_SECRET ??=
  "test-jwt-secret-min-32-chars-xxxxxxxxxx";
process.env.REFRESH_SECRET ??=
  "test-refresh-secret-min-32-chars-xxxxxxx";

// Encryption key — required by src/lib/encryption.ts
process.env.ENCRYPTION_KEY ??=
  "0000000000000000000000000000000000000000000000000000000000000000"; // 64 hex chars = 32 bytes

// Other common env vars that may be required at module load time
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.NEXTAUTH_SECRET ??= "test-nextauth-secret-32-chars-xxx";
process.env.NEXTAUTH_URL ??= "http://localhost:3000";
