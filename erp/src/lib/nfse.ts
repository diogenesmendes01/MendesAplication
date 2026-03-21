import { logger } from "@/lib/logger";
// ---------------------------------------------------------------------------
// NFS-e — Interface e providers
// ---------------------------------------------------------------------------

export interface NfseCompanyData {
  razaoSocial: string;
  cnpj: string;
  inscricaoEstadual: string | null;
}

export interface NfseClientData {
  name: string;
  cpfCnpj: string;
  email: string | null;
  endereco: string | null;
}

export interface EmitNfseInput {
  companyData: NfseCompanyData;
  clientData: NfseClientData;
  serviceDescription: string;
  value: number;
  issRate: number;
  /**
   * Número RPS gerado atomicamente via banco (FiscalConfig.nfseNextNumber).
   * Quando fornecido, os providers devem usá-lo em vez de Date.now().
   * Evita colisão de numeração em emissões simultâneas.
   */
  rpsNumero?: string;
}

export interface EmitNfseResult {
  nfNumber: string;
}

export interface CancelNfseInput {
  /** Número da NFS-e emitida pela prefeitura */
  nfNumber: string;
  /** CNPJ do prestador */
  cnpj: string;
  /** Inscrição municipal do prestador */
  inscricaoMunicipal: string;
  /** Motivo do cancelamento (obrigatório pela maioria das prefeituras) */
  motivo: string;
}

export interface CancelNfseResult {
  success: true;
  protocol?: string;
}

export interface NfseProvider {
  emitNFSe(input: EmitNfseInput): Promise<EmitNfseResult>;
  /**
   * Cancela uma NFS-e já emitida junto à prefeitura.
   * Deve ser implementado por cada provider municipal.
   * Lança erro se o cancelamento não for aceito.
   */
  cancelNFSe(input: CancelNfseInput): Promise<CancelNfseResult>;
}

// ---------------------------------------------------------------------------
// Mock provider — usado em testes / desenvolvimento sem certificado
// ---------------------------------------------------------------------------

export class MockNfseProvider implements NfseProvider {
  async emitNFSe(input: EmitNfseInput): Promise<EmitNfseResult> {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    const nfNumber = `MOCK${timestamp}${random}`;

    const issValue = input.value * (input.issRate / 100);

    logger.info("========== NFS-e (MOCK) ==========");
    logger.info(`NF Number:      ${nfNumber}`);
    logger.info(`Company:        ${input.companyData.razaoSocial} (${input.companyData.cnpj})`);
    logger.info(`Client:         ${input.clientData.name} (${input.clientData.cpfCnpj})`);
    logger.info(`Service:        ${input.serviceDescription}`);
    logger.info(`Value:          R$ ${input.value.toFixed(2)}`);
    logger.info(`ISS Rate:       ${input.issRate.toFixed(2)}%`);
    logger.info(`ISS Value:      R$ ${issValue.toFixed(2)}`);
    logger.info("==================================");

    return { nfNumber };
  }

  async cancelNFSe(input: CancelNfseInput): Promise<CancelNfseResult> {
    logger.info(`[MockNfseProvider] cancelNFSe MOCK — NFS-e ${input.nfNumber} cancelada (simulação)`);
    return { success: true, protocol: `MOCK-CANCEL-${Date.now()}` };
  }
}

// ---------------------------------------------------------------------------
// Provider global legado (backward compat — usar factory por empresa)
// ---------------------------------------------------------------------------

let _globalProvider: NfseProvider = new MockNfseProvider();

/** @deprecated Prefira getNfseProviderForCompany(companyId) da factory */
export function setNfseProvider(p: NfseProvider) {
  _globalProvider = p;
}

/** @deprecated Prefira getNfseProviderForCompany(companyId) da factory */
export async function emitNFSe(input: EmitNfseInput): Promise<EmitNfseResult> {
  return _globalProvider.emitNFSe(input);
}

// ---------------------------------------------------------------------------
// Re-exports dos providers concretos
// ---------------------------------------------------------------------------

export { CampinasNfseProvider } from "./nfse/campinas.provider";
export { SaoPauloNfseProvider } from "./nfse/saopaulo.provider";
export { TaboaoDaSerraNfseProvider } from "./nfse/taboao.provider";
export { getNfseProviderForCompany } from "./nfse/factory";
