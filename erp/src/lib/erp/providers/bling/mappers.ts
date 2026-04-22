import type { BlingContact, BlingProduct, BlingOrder } from './types';

// ── Contato ──────────────────────────────────────────────────────────────────

export interface MappedContact {
  name: string;
  email?: string;
  phone?: string;
  document?: string;
  documentType?: 'CPF' | 'CNPJ';
  ie?: string;
  addressStreet?: string;
  addressNumber?: string;
  addressComplement?: string;
  addressNeighborhood?: string;
  addressCity?: string;
  addressState?: string;
  addressZipCode?: string;
  status: 'ACTIVE' | 'INACTIVE';
  blingId: string;
}

export function mapBlingContact(c: BlingContact): MappedContact {
  return {
    blingId: c.id,
    name: c.nome,
    email: c.email,
    phone: c.telefone,
    document: c.cnpj ?? c.cpf,
    documentType: c.cnpj ? 'CNPJ' : c.cpf ? 'CPF' : undefined,
    ie: c.ie,
    addressStreet: c.endereco?.endereco,
    addressNumber: c.endereco?.numero,
    addressComplement: c.endereco?.complemento,
    addressNeighborhood: c.endereco?.bairro,
    addressCity: c.endereco?.cidade,
    addressState: c.endereco?.uf,
    addressZipCode: c.endereco?.cep,
    status: c.situacao === 'A' ? 'ACTIVE' : 'INACTIVE',
  };
}

// ── Produto ──────────────────────────────────────────────────────────────────

export interface MappedProduct {
  blingId: string;
  sku: string;
  name: string;
  type: 'PRODUCT' | 'SERVICE';
  price?: number;
  costPrice?: number;
  stockQuantity?: number;
  category?: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export function mapBlingProduct(p: BlingProduct): MappedProduct {
  return {
    blingId: p.id,
    sku: p.codigo,
    name: p.nome,
    type: p.tipo === 'S' ? 'SERVICE' : 'PRODUCT',
    price: p.preco ? parseFloat(p.preco) : undefined,
    costPrice: p.precoCusto ? parseFloat(p.precoCusto) : undefined,
    stockQuantity: p.estoque?.geral,
    category: p.categoria?.descricao,
    status: p.situacao === 'A' ? 'ACTIVE' : 'INACTIVE',
  };
}

// ── Pedido ────────────────────────────────────────────────────────────────────

export interface MappedOrderItem {
  productSku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  discount: number;
}

export interface MappedOrder {
  blingId: string;
  number: string;
  integrationCode?: string;
  status: string;
  customerId?: string;
  issueDate: Date;
  dueDate?: Date;
  subtotal: number;
  freight: number;
  discount: number;
  total: number;
  notes?: string;
  items: MappedOrderItem[];
}

const ORDER_STATUS_MAP: Record<number, string> = {
  1: 'DRAFT',
  2: 'PENDING_APPROVAL',
  3: 'INVOICED',
  4: 'NON_TAXABLE',
  5: 'CANCELLED',
};

export function mapBlingOrder(o: BlingOrder): MappedOrder {
  return {
    blingId: o.id,
    number: o.numero,
    integrationCode: o.numeroPedidoIntegracao,
    status: ORDER_STATUS_MAP[o.situacao.id] ?? 'UNKNOWN',
    customerId: o.cliente?.id,
    issueDate: new Date(o.data),
    dueDate: o.dataSaida ? new Date(o.dataSaida) : undefined,
    subtotal: parseFloat(o.totalVenda),
    freight: parseFloat(o.valorFrete),
    discount: parseFloat(o.desconto),
    total: parseFloat(o.totalLiquido),
    notes: o.obs,
    items: o.itens.item.map(item => ({
      productSku: item.codigo,
      description: item.descricao,
      quantity: parseFloat(item.quantidade),
      unitPrice: parseFloat(item.valorUnitario),
      total: parseFloat(item.total),
      discount: parseFloat(item.desconto),
    })),
  };
}
