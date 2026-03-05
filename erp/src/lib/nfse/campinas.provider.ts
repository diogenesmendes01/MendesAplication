import { NfseCampinas } from "@4success/nfse-campinas";
import { StatusRps } from "@4success/nfse-campinas/dist/soap/notafiscalsoap/definitions/Rps";
import { TipoRps } from "@4success/nfse-campinas/dist/soap/notafiscalsoap/definitions/IdentificacaoRps";
import { ExigibilidadeISS } from "@4success/nfse-campinas/dist/soap/notafiscalsoap/definitions/Servico";
import { Binario } from "@4success/nfse-campinas/dist/soap/notafiscalsoap/definitions/Binario";
import type { EmitNfseInput, EmitNfseResult, NfseProvider } from "../nfse";

const WSDL_HOMOLOG =
  "https://homol-rps.ima.sp.gov.br/notafiscal-abrasfv203-ws/NotaFiscalSoap?wsdl";
const WSDL_PROD =
  "https://rps.ima.sp.gov.br/notafiscal-abrasfv203-ws/NotaFiscalSoap?wsdl";

// Código IBGE de Campinas-SP
const CODIGO_MUNICIPIO_CAMPINAS = 3509502;

export class CampinasNfseProvider implements NfseProvider {
  private campinas: NfseCampinas;
  private inscricaoMunicipal: string;
  private itemListaServico: string;
  private codigoTributacao?: string;

  constructor(
    certBuffer: Buffer,
    certPassword: string,
    inscricaoMunicipal: string,
    itemListaServico: string,
    codigoTributacao?: string
  ) {
    const wsdl =
      process.env.NFSE_ENV === "production" ? WSDL_PROD : WSDL_HOMOLOG;
    this.campinas = new NfseCampinas(wsdl, certBuffer, certPassword);
    this.inscricaoMunicipal = inscricaoMunicipal;
    this.itemListaServico = itemListaServico;
    this.codigoTributacao = codigoTributacao;
  }

  async emitNFSe(input: EmitNfseInput): Promise<EmitNfseResult> {
    const hoje = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const rpsNumero = Date.now().toString();

    // Separar CPF e CNPJ do tomador
    const cpfCnpjTomadorRaw = input.clientData.cpfCnpj.replace(/\D/g, "");
    const isCnpjTomador = cpfCnpjTomadorRaw.length === 14;

    const [result] = await this.campinas.GerarNfse({
      GerarNfseEnvio: {
        Rps: {
          InfDeclaracaoPrestacaoServico: {
            Rps: {
              IdentificacaoRps: {
                Numero: rpsNumero,
                Serie: "A1",
                Tipo: TipoRps.RPS,
              },
              DataEmissao: hoje,
              Status: StatusRps.NORMAL,
            },
            Competencia: hoje,
            Servico: {
              Valores: {
                ValorServicos: input.value,
                Aliquota: input.issRate / 100,
                ValorIss: input.value * (input.issRate / 100),
              },
              IssRetido: Binario.NAO,
              ItemListaServico: this.itemListaServico,
              CodigoTributacaoMunicipio: this.codigoTributacao,
              Discriminacao: input.serviceDescription.substring(0, 2000),
              CodigoMunicipio: CODIGO_MUNICIPIO_CAMPINAS,
              ExigibilidadeISS: ExigibilidadeISS.EXIGIVEL,
            },
            Prestador: {
              CpfCnpj: {
                Cnpj: input.companyData.cnpj.replace(/\D/g, ""),
              },
              InscricaoMunicipal: this.inscricaoMunicipal,
            },
            Tomador: {
              IdentificacaoTomador: {
                CpfCnpj: isCnpjTomador
                  ? { Cnpj: cpfCnpjTomadorRaw }
                  : { Cpf: cpfCnpjTomadorRaw },
              },
              RazaoSocial: input.clientData.name.substring(0, 115),
            },
            OptanteSimplesNacional: Binario.NAO,
            IncentivoFiscal: Binario.NAO,
          },
        },
      },
    });

    const infNfse =
      result?.GerarNfseResposta?.ListaNfse?.CompNfse?.Nfse?.InfNfse;
    const erros = result?.GerarNfseResposta?.ListaMensagemRetorno;

    if (!infNfse?.Numero) {
      const mensagem = erros
        ? JSON.stringify(erros)
        : "Resposta inválida da prefeitura de Campinas";
      throw new Error(`Erro ao emitir NFS-e (Campinas): ${mensagem}`);
    }

    return {
      nfNumber: String(infNfse.Numero),
    };
  }
}
