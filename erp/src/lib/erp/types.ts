export interface ErpProviderDefinition {
  id: string;
  name: string;
  logo?: string;
  configSchema: ConfigField[];
}

export interface ConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number' | 'boolean' | 'select';
  required: boolean;
  placeholder?: string;
  helpText?: string;
  options?: { value: string; label: string }[];
  group?: 'credentials' | 'settings';
}

export interface BlingCredentials {
  accessToken: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  expiresAt?: number;
}

export interface ErpSyncResult {
  provider: string;
  resource: string;
  direction: 'push' | 'pull';
  synced: number;
  errors: number;
  details?: string[];
}

export interface ErpSyncOptions {
  resources?: ('products' | 'orders' | 'contacts' | 'invoices' | 'finances')[];
  since?: Date;
  fullSync?: boolean;
}
