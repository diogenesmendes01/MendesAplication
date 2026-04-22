import type { BlingCredentials } from './types';
import { BlingApiClient } from './providers/bling/client';

export function createErpClient(
  provider: string,
  credentials: BlingCredentials,
  sandbox = false
): BlingApiClient {
  if (provider === 'bling') {
    return new BlingApiClient(credentials, sandbox);
  }
  throw new Error(`Unknown ERP provider: ${provider}`);
}
