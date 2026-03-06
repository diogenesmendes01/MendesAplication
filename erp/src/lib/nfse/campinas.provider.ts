import { NfseCampinas } from "@4success/nfse-campinas";
import { StatusRps } from "@4success/nfse-campinas/dist/soap/notafiscalsoap/definitions/Rps";
import { TipoRps } from "@4success/nfse-campinas/dist/soap/notafiscalsoap/definitions/IdentificacaoRps";
import { ExigibilidadeISS } from "@4success/nfse-campinas/dist/soap/notafiscalsoap/definitions/Servico";
import { Binario } from "@4success/nfse-campinas/dist/soap/notafiscalsoap/definitions/Binario";
import type { EmitNfseInput, EmitNfseResult, NfseProvider } from "../nfse";

// Sistema migrado em 17/03/2025 para nova plataforma (novanfse.campinas.sp.gov.br)
// O antigo domínio issdigital.campinas.sp.gov.br agora retorna página de manutenção HTML.
const WSDL_HOMOLOG =
  "https://novanfse.campinas.sp.gov.br/notafiscal-abrasfv203-ws/NotaFiscalSoap?wsdl";
const WSDL_PROD =
  "https://novanfse.campinas.sp.gov.br/notafiscal-abrasfv203-ws/NotaFiscalSoap?wsdl";

// Código IBGE de Campinas-SP
const CODIGO_MUNICIPIO_CAMPINAS = 3509502;

// ---------------------------------------------------------------------------
// Config object — evita constructor com 7+ parâmetros posicionais
// ---------------------------------------------------------------------------

export interface CampinasNfseConfig {
  /** Inscrição Municipal do prestador */
  inscricaoMunicipal: string;
  /** Código de serviço LC116 (ex: "01.06") */
  itemListaServico: string;
  /** Código de tributação municipal (opcional) */
  codigoTributacao?: string;
  /**
   * CNAE do prestador — Campinas exige 9 dígitos na tag <CodigoCnae>.
   * Pode ser passado com ou sem formatação (ex: "6204-0/00-01" ou "620400001").
   * O constructor normaliza automaticamente removendo caracteres não numéricos.
   */
  codigoCnae?: string;
  /**
   * Optante pelo Simples Nacional.
   * Aplica-se ao schema ABRASF (Campinas).
   * São Paulo (TributacaoRPS) e Taboão (CONAM) não têm campo equivalente.
   */
  simplesNacional?: boolean;
}

export class CampinasNfseProvider implements NfseProvider {
  private campinas: NfseCampinas;
  private inscricaoMunicipal: string;
  private itemListaServico: string;
  private codigoTributacao?: string;
  private codigoCnae?: string;
  private simplesNacional: boolean;

  constructor(
    certBuffer: Buffer,
    certPassword: string,
    config: CampinasNfseConfig
  ) {
    const wsdl =
      process.env.NFSE_ENV === "production" ? WSDL_PROD : WSDL_HOMOLOG;
    this.campinas = new NfseCampinas(wsdl, certBuffer, certPassword);
    this.inscricaoMunicipal = config.inscricaoMunicipal;
    this.itemListaServico = config.itemListaServico;
    this.codigoTributacao = config.codigoTributacao;
    // Normaliza CNAE removendo caracteres não numéricos
    // (ex: "6204-0/00-01" → "620400001"). Campinas exige 9 dígitos.
    this.codigoCnae = config.codigoCnae?.replace(/\D/g, "") || undefined;
    this.simplesNacional = config.simplesNacional ?? false;
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
              ...(this.codigoCnae && { CodigoCnae: this.codigoCnae }),
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
            OptanteSimplesNacional: this.simplesNacional ? Binario.SIM : Binario.NAO,
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
