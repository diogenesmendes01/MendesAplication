export interface BlingApiResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    pageSize: number;
  };
}

export interface BlingContact {
  id: string;
  tipo: 'F' | 'J';
  situacao: 'A' | 'I';
  nome: string;
  email?: string;
  telefone?: string;
  cnpj?: string;
  cpf?: string;
  ie?: string;
  endereco?: BlingAddress;
}

export interface BlingAddress {
  endereco: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
}

export interface BlingProduct {
  id: string;
  codigo: string;
  nome: string;
  tipo: 'P' | 'S';
  situacao: 'A' | 'I';
  preco?: string;
  precoCusto?: string;
  estoque?: { geral: number; saldo?: number };
  categoria?: { id: string; descricao: string };
}

export interface BlingOrder {
  id: string;
  numero: string;
  numeroPedidoIntegracao?: string;
  situacao: { id: number; nome: string };
  cliente?: BlingContact;
  data: string;
  dataSaida?: string;
  itens: { item: BlingOrderItem[] };
  totalVenda: string;
  valorFrete: string;
  desconto: string;
  totalLiquido: string;
  obs?: string;
}

export interface BlingOrderItem {
  codigo: string;
  descricao: string;
  quantidade: string;
  valorUnitario: string;
  valorFrete: string;
  desconto: string;
  total: string;
}

export interface BlingAccountReceivable {
  id: string;
  documento: string;
  dataEmissao: string;
  dataVencimento: string;
  valorOriginal: string;
  valorFinal: string;
  valorRecebido?: string;
  situacao: 'A' | 'R' | 'C';
  cliente?: BlingContact;
  categoria?: { id: string; descricao: string };
}

// ── List params ─────────────────────────────────────────────────────────────

export interface BlingListParams {
  page?: number;
  pageSize?: number;
}

export interface BlingContactListParams extends BlingListParams {
  situacao?: 'A' | 'I';
  tipo?: 'F' | 'J';
}

export interface BlingProductListParams extends BlingListParams {
  situacao?: 'A' | 'I';
  tipo?: 'P' | 'S';
  dataInicial?: string;
  dataFinal?: string;
}

export interface BlingOrderListParams extends BlingListParams {
  situacao?: number;
  dataInicial?: string;
  dataFinal?: string;
  numeroPedidoIntegracao?: string;
}

export interface BlingAccountListParams extends BlingListParams {
  situacao?: 'A' | 'R' | 'C';
  dataInicial?: string;
  dataFinal?: string;
}
