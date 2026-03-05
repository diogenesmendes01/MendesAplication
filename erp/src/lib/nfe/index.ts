/**
 * NF-e (Nota Fiscal Eletrônica) — Modelo 55
 * Integração direta com SEFAZ via SOAP + mTLS (certificado A1)
 *
 * Usado para venda de PRODUTOS (bens), ex: livros digitais (CodeWave).
 * Para venda de SERVIÇOS, usar NFS-e (/lib/nfse/).
 *
 * Fluxo:
 *  1. Montar XML NF-e 4.0
 *  2. Calcular e assinar (xmldsig enveloped, RSA-SHA1, C14N)
 *  3. Montar lote (enviNFe)
 *  4. POST SOAP para NFeAutorizacao4
 *  5. Polling em NFeRetAutorizacao4 até cStat=100 (autorizado)
 *  6. Retornar chave + protocolo
 */

export interface NfeProductItem {
  /** Código do produto no sistema */
  code: string;
  /** Descrição (max 120 chars) */
  description: string;
  /** NCM — livro digital: 49019900 */
  ncm: string;
  /** CFOP — ex: 6107 (venda interestadual não-contribuinte) */
  cfop: string;
  /** Unidade comercial — ex: "UN" */
  unit: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

export interface NfeClientData {
  name: string;
  cpfCnpj: string;
  /** IE do destinatário — "ISENTO" para não-contribuintes e PF */
  ie?: string;
  email?: string | null;
  /** Endereço completo */
  street: string;
  number: string;
  complement?: string;
  district: string;
  city: string;
  /** IBGE code do município — ex: 3550308 para São Paulo */
  cityCode: string;
  state: string;
  zipCode: string;
  /** Código país — 1058 = Brasil */
  countryCode?: string;
  phone?: string;
}

export interface NfeCompanyData {
  razaoSocial: string;
  cnpj: string;
  /** IE do emitente */
  ie: string;
  /** Regime tributário: 1=SN, 2=SN Excesso, 3=Normal */
  crt: 1 | 2 | 3;
  street: string;
  number: string;
  complement?: string;
  district: string;
  city: string;
  cityCode: string;
  state: string;
  zipCode: string;
  phone?: string;
}

export interface EmitNfeInput {
  companyData: NfeCompanyData;
  clientData: NfeClientData;
  items: NfeProductItem[];
  /** Série da NF-e */
  serie: string;
  /** Número da NF-e */
  nNumber: number;
  /** Informações adicionais ao fisco */
  infAdic?: string;
}

export interface EmitNfeResult {
  /** Chave de acesso 44 dígitos */
  chave: string;
  /** Protocolo de autorização */
  protocolo: string;
  /** Número da NF-e */
  numero: number;
}

export interface NfeProvider {
  emitNFe(input: EmitNfeInput): Promise<EmitNfeResult>;
}
