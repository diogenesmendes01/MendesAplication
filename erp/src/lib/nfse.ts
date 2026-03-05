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
}

export interface EmitNfseResult {
  nfNumber: string;
}

export interface NfseProvider {
  emitNFSe(input: EmitNfseInput): Promise<EmitNfseResult>;
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

    console.log("========== NFS-e (MOCK) ==========");
    console.log(`NF Number:      ${nfNumber}`);
    console.log(`Company:        ${input.companyData.razaoSocial} (${input.companyData.cnpj})`);
    console.log(`Client:         ${input.clientData.name} (${input.clientData.cpfCnpj})`);
    console.log(`Service:        ${input.serviceDescription}`);
    console.log(`Value:          R$ ${input.value.toFixed(2)}`);
    console.log(`ISS Rate:       ${input.issRate.toFixed(2)}%`);
    console.log(`ISS Value:      R$ ${issValue.toFixed(2)}`);
    console.log("==================================");

    return { nfNumber };
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
