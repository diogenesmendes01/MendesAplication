export interface BoletoClientData {
  name: string;
  cpfCnpj: string;
  email: string;
  endereco: string | null;
}

export interface BoletoCompanyData {
  razaoSocial: string;
  cnpj: string;
}

export interface GenerateBoletoInput {
  clientData: BoletoClientData;
  companyData: BoletoCompanyData;
  value: number;
  dueDate: Date;
  installmentNumber: number;
  totalInstallments: number;
  proposalId: string;
}

export interface GenerateBoletoResult {
  bankReference: string;
}

export interface BoletoProvider {
  generateBoleto(input: GenerateBoletoInput): Promise<GenerateBoletoResult>;
}

class MockBoletoProvider implements BoletoProvider {
  async generateBoleto(input: GenerateBoletoInput): Promise<GenerateBoletoResult> {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    const bankReference = `PIN${timestamp}${random}${input.installmentNumber}`;

    console.log("========== BOLETO (MOCK) ==========");
    console.log(`Bank Reference: ${bankReference}`);
    console.log(`Client:         ${input.clientData.name} (${input.clientData.cpfCnpj})`);
    console.log(`Company:        ${input.companyData.razaoSocial}`);
    console.log(`Value:          R$ ${input.value.toFixed(2)}`);
    console.log(`Due Date:       ${input.dueDate.toISOString().split("T")[0]}`);
    console.log(`Installment:    ${input.installmentNumber}/${input.totalInstallments}`);
    console.log("===================================");

    return { bankReference };
  }
}

let provider: BoletoProvider = new MockBoletoProvider();

export function setBoletoProvider(p: BoletoProvider) {
  provider = p;
}

export async function generateBoleto(
  input: GenerateBoletoInput
): Promise<GenerateBoletoResult> {
  return provider.generateBoleto(input);
}
