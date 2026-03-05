/**
 * Provider NFS-e — Prefeitura de São Paulo
 * Sistema: Nota Fiscal Paulistana (nfe.prefeitura.sp.gov.br)
 * Layout: v2 (Reforma Tributária — vigente a partir de 01/01/2026)
 * Protocolo: HTTPS com mTLS (certificado A1 .pfx)
 */

import https from "https";
import crypto from "crypto";
import axios from "axios";
import type { EmitNfseInput, EmitNfseResult, NfseProvider } from "../nfse";

const URL_HOMOLOG = "https://nfe.prefeitura.sp.gov.br/ws/lotenfe.asmx";
const URL_PROD = "https://nfe.prefeitura.sp.gov.br/ws/lotenfe.asmx";

function buildSoapEnvelope(
  cnpj: string,
  inscricaoMunicipal: string,
  xmlRps: string,
  loteNumero: string
): string {
  const strXmlEnvio = Buffer.from(xmlRps).toString("base64");

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <EnvioLoteRPS xmlns="http://www.prefeitura.sp.gov.br/nfe">
      <VersaoSchema>2</VersaoSchema>
      <MensagemXML>${strXmlEnvio}</MensagemXML>
    </EnvioLoteRPS>
  </soap:Body>
</soap:Envelope>`;
}

function buildRpsXml(
  input: EmitNfseInput,
  inscricaoMunicipal: string,
  itemListaServico: string,
  codigoTributacao: string,
  rpsNumero: string,
  rpsSerieNumero: string
): string {
  const hoje = new Date();
  const dataEmissao = hoje.toISOString();
  const competencia = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
  const cpfCnpjTomador = input.clientData.cpfCnpj.replace(/\D/g, "");
  const isCnpjTomador = cpfCnpjTomador.length === 14;
  const valorIss = (input.value * input.issRate) / 100;

  const tomadorDoc = isCnpjTomador
    ? `<CNPJ>${cpfCnpjTomador}</CNPJ>`
    : `<CPF>${cpfCnpjTomador}</CPF>`;

  // Layout v2 — inclui campos IBS/CBS obrigatórios (Reforma Tributária 2026)
  return `<?xml version="1.0" encoding="utf-8"?>
<p1:LoteRPS xmlns:p1="http://www.prefeitura.sp.gov.br/nfe" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Cabecalho xmlns="http://www.prefeitura.sp.gov.br/nfe" Versao="2">
    <NumeroLote>${rpsNumero}</NumeroLote>
    <CNPJ>${input.companyData.cnpj.replace(/\D/g, "")}</CNPJ>
    <InscricaoPrestador>${inscricaoMunicipal}</InscricaoPrestador>
    <QtdRPS>1</QtdRPS>
    <ValorTotalServicos>${input.value.toFixed(2)}</ValorTotalServicos>
    <ValorTotalDeducoes>0.00</ValorTotalDeducoes>
  </Cabecalho>
  <RPS xmlns="http://www.prefeitura.sp.gov.br/nfe" Versao="2">
    <Assinatura></Assinatura>
    <ChaveRPS>
      <InscricaoPrestador>${inscricaoMunicipal}</InscricaoPrestador>
      <SerieRPS>${rpsSerieNumero}</SerieRPS>
      <NumeroRPS>${rpsNumero}</NumeroRPS>
    </ChaveRPS>
    <TipoRPS>RPS</TipoRPS>
    <DataEmissao>${dataEmissao}</DataEmissao>
    <StatusRPS>N</StatusRPS>
    <TributacaoRPS>T</TributacaoRPS>
    <ValorServicos>${input.value.toFixed(2)}</ValorServicos>
    <ValorDeducoes>0.00</ValorDeducoes>
    <ValorPIS>0.00</ValorPIS>
    <ValorCOFINS>0.00</ValorCOFINS>
    <ValorINSS>0.00</ValorINSS>
    <ValorIR>0.00</ValorIR>
    <ValorCSLL>0.00</ValorCSLL>
    <CodigoServico>${itemListaServico}</CodigoServico>
    <AliquotaServicos>${(input.issRate / 100).toFixed(4)}</AliquotaServicos>
    <ISSRetido>false</ISSRetido>
    <CPFCNPJTomador>
      ${tomadorDoc}
    </CPFCNPJTomador>
    <RazaoSocialTomador>${escapeXml(input.clientData.name)}</RazaoSocialTomador>
    <Discriminacao>${escapeXml(input.serviceDescription.substring(0, 4000))}</Discriminacao>
    <ValorISSRetido>0.00</ValorISSRetido>
    <CodigoNBS></CodigoNBS>
    <ValorIBS>0.00</ValorIBS>
    <ValorCBS>0.00</ValorCBS>
  </RPS>
</p1:LoteRPS>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseSoapResponse(responseXml: string): string {
  // Extrai número da NFS-e do XML de resposta
  const match = responseXml.match(/<NumeroNFe>(\d+)<\/NumeroNFe>/);
  if (match) return match[1];

  // Alternativa: busca por Numero no retorno
  const match2 = responseXml.match(/<NumeroNota>(\d+)<\/NumeroNota>/);
  if (match2) return match2[1];

  // Verifica se há erro na resposta
  const errMatch = responseXml.match(/<MensagemErro>([\s\S]*?)<\/MensagemErro>/);
  if (errMatch) throw new Error(`Erro NFS-e São Paulo: ${errMatch[1]}`);

  throw new Error("Resposta inesperada da prefeitura de São Paulo");
}

export class SaoPauloNfseProvider implements NfseProvider {
  private certBuffer: Buffer;
  private certPassword: string;
  private inscricaoMunicipal: string;
  private itemListaServico: string;
  private codigoTributacao: string;

  constructor(
    certBuffer: Buffer,
    certPassword: string,
    inscricaoMunicipal: string,
    itemListaServico: string,
    codigoTributacao = ""
  ) {
    this.certBuffer = certBuffer;
    this.certPassword = certPassword;
    this.inscricaoMunicipal = inscricaoMunicipal;
    this.itemListaServico = itemListaServico;
    this.codigoTributacao = codigoTributacao;
  }

  async emitNFSe(input: EmitNfseInput): Promise<EmitNfseResult> {
    const rpsNumero = Date.now().toString();
    const rpsSerieNumero = "A1";

    const xmlRps = buildRpsXml(
      input,
      this.inscricaoMunicipal,
      this.itemListaServico,
      this.codigoTributacao,
      rpsNumero,
      rpsSerieNumero
    );

    const soapBody = buildSoapEnvelope(
      input.companyData.cnpj.replace(/\D/g, ""),
      this.inscricaoMunicipal,
      xmlRps,
      rpsNumero
    );

    // Cria o agente HTTPS com o certificado A1 para mTLS
    const agent = new https.Agent({
      pfx: this.certBuffer,
      passphrase: this.certPassword,
      rejectUnauthorized: process.env.NFSE_ENV === "production",
    });

    const url =
      process.env.NFSE_ENV === "production" ? URL_PROD : URL_HOMOLOG;

    const response = await axios.post(url, soapBody, {
      httpsAgent: agent,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://www.prefeitura.sp.gov.br/nfe/ws/EnvioLoteRPS",
      },
      timeout: 30_000,
    });

    const nfNumber = parseSoapResponse(response.data as string);

    return { nfNumber };
  }
}
