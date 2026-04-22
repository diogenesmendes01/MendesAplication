import type { ErpProviderDefinition } from './types';

export const ERP_PROVIDER_REGISTRY: Record<string, ErpProviderDefinition> = {
  bling: {
    id: 'bling',
    name: 'Bling ERP',
    configSchema: [
      {
        key: 'clientId',
        label: 'Client ID',
        type: 'text',
        required: true,
        placeholder: 'Seu Client ID do Bling',
        group: 'credentials',
      },
      {
        key: 'clientSecret',
        label: 'Client Secret',
        type: 'password',
        required: true,
        placeholder: 'Seu Client Secret',
        group: 'credentials',
      },
      {
        key: 'accessToken',
        label: 'Access Token',
        type: 'password',
        required: true,
        helpText: 'Obtido via OAuth flow no Bling Dashboard',
        group: 'credentials',
      },
      {
        key: 'refreshToken',
        label: 'Refresh Token',
        type: 'password',
        required: true,
        group: 'credentials',
      },
      {
        key: 'storeId',
        label: 'ID da Loja',
        type: 'text',
        required: false,
        helpText: 'Deixe vazio para usar a loja principal',
        group: 'settings',
      },
    ],
  },
};

export type ErpProviderType = keyof typeof ERP_PROVIDER_REGISTRY;
export const ERP_PROVIDER_TYPES = Object.keys(ERP_PROVIDER_REGISTRY) as ErpProviderType[];

export function isErpProviderType(value: unknown): value is ErpProviderType {
  return typeof value === 'string' && value in ERP_PROVIDER_REGISTRY;
}
