import { describe, it, expect } from 'vitest';
import { mapBlingContact, mapBlingProduct, mapBlingOrder } from '../mappers';
import type { BlingContact, BlingProduct, BlingOrder } from '../types';

describe('mapBlingContact', () => {
  it('mapeia contato PJ com CNPJ', () => {
    const input: BlingContact = {
      id: '123',
      tipo: 'J',
      situacao: 'A',
      nome: 'Empresa XPTO',
      cnpj: '12.345.678/0001-90',
      email: 'contato@xpto.com',
      endereco: {
        endereco: 'Rua Exemplo',
        numero: '100',
        bairro: 'Centro',
        cidade: 'Campinas',
        uf: 'SP',
        cep: '13010-000',
      },
    };

    const result = mapBlingContact(input);

    expect(result.blingId).toBe('123');
    expect(result.name).toBe('Empresa XPTO');
    expect(result.document).toBe('12.345.678/0001-90');
    expect(result.documentType).toBe('CNPJ');
    expect(result.status).toBe('ACTIVE');
    expect(result.addressCity).toBe('Campinas');
  });

  it('contato inativo → status INACTIVE', () => {
    const input: BlingContact = {
      id: '1',
      tipo: 'F',
      situacao: 'I',
      nome: 'João',
    };
    expect(mapBlingContact(input).status).toBe('INACTIVE');
  });
});

describe('mapBlingProduct', () => {
  it('mapeia produto com preço e estoque', () => {
    const input: BlingProduct = {
      id: '789',
      codigo: 'PROD-001',
      nome: 'Serviço Dev',
      tipo: 'S',
      situacao: 'A',
      preco: '350.00',
      estoque: { geral: 0 },
    };

    const result = mapBlingProduct(input);

    expect(result.blingId).toBe('789');
    expect(result.sku).toBe('PROD-001');
    expect(result.type).toBe('SERVICE');
    expect(result.price).toBe(350.0);
    expect(result.stockQuantity).toBe(0);
    expect(result.status).toBe('ACTIVE');
  });
});

describe('mapBlingOrder', () => {
  it('mapeia pedido com itens', () => {
    const input: BlingOrder = {
      id: '456',
      numero: '2026-0001',
      numeroPedidoIntegracao: 'PROP-123',
      situacao: { id: 3, nome: 'Faturado' },
      data: '2026-04-22T10:00:00-03:00',
      itens: {
        item: [
          {
            codigo: 'PROD-001',
            descricao: 'Serviço',
            quantidade: '1.0000',
            valorUnitario: '350.00',
            valorFrete: '0.00',
            desconto: '0.00',
            total: '350.00',
          },
        ],
      },
      totalVenda: '350.00',
      valorFrete: '0.00',
      desconto: '0.00',
      totalLiquido: '350.00',
    };

    const result = mapBlingOrder(input);

    expect(result.blingId).toBe('456');
    expect(result.status).toBe('INVOICED');
    expect(result.total).toBe(350);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].productSku).toBe('PROD-001');
    expect(result.integrationCode).toBe('PROP-123');
  });

  it('status desconhecido → "UNKNOWN"', () => {
    const input: BlingOrder = {
      id: '1',
      numero: '1',
      situacao: { id: 99, nome: 'Novo' },
      data: '2026-01-01',
      itens: { item: [] },
      totalVenda: '0',
      valorFrete: '0',
      desconto: '0',
      totalLiquido: '0',
    };
    expect(mapBlingOrder(input).status).toBe('UNKNOWN');
  });
});
