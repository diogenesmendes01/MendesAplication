import { describe, it, expect } from 'vitest';
import { ERP_PROVIDER_REGISTRY, isErpProviderType, ERP_PROVIDER_TYPES } from '../registry';

describe('ERP_PROVIDER_REGISTRY', () => {
  it('deve conter o provider bling', () => {
    expect(ERP_PROVIDER_REGISTRY).toHaveProperty('bling');
  });

  it('bling deve ter todos os campos de credentials obrigatórios', () => {
    const bling = ERP_PROVIDER_REGISTRY.bling;
    const requiredKeys = ['clientId', 'clientSecret', 'accessToken', 'refreshToken'];
    const schemaKeys = bling.configSchema
      .filter(f => f.required)
      .map(f => f.key);
    for (const key of requiredKeys) {
      expect(schemaKeys).toContain(key);
    }
  });

  it('storeId deve ser opcional', () => {
    const storeIdField = ERP_PROVIDER_REGISTRY.bling.configSchema.find(f => f.key === 'storeId');
    expect(storeIdField?.required).toBe(false);
  });
});

describe('isErpProviderType', () => {
  it('retorna true para "bling"', () => {
    expect(isErpProviderType('bling')).toBe(true);
  });

  it('retorna false para valores inválidos', () => {
    expect(isErpProviderType('pagarme')).toBe(false);
    expect(isErpProviderType(null)).toBe(false);
    expect(isErpProviderType(123)).toBe(false);
  });
});

describe('ERP_PROVIDER_TYPES', () => {
  it('deve conter "bling"', () => {
    expect(ERP_PROVIDER_TYPES).toContain('bling');
  });
});
