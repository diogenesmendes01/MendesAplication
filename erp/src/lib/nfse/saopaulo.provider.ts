/**
 * Provider NFS-e — Prefeitura de São Paulo
 * Sistema: Nota Fiscal Paulistana (nfe.prefeitura.sp.gov.br)
 * Layout: v2 (Reforma Tributária — vigente a partir de 01/01/2026)
 * Protocolo: HTTPS com mTLS (certificado A1 .pfx) + assinatura SHA-1/RSA no RPS
 */

import https from "https";
import axios from "axios";
import forge from "node-forge";
import type { EmitNfseInput, EmitNfseResult, NfseProvider } from "../nfse";

const URL_HOMOLOG = "https://nfeh.prefeitura.sp.gov.br/ws/lotenfe.asmx";
const URL_PROD    = "https://nfe.prefeitura.sp.gov.br/ws/lotenfe.asmx";

// ---------------------------------------------------------------------------
// Assinatura digital SHA-1/RSA — obrigatória pela Nota Fiscal Paulistana
// ---------------------------------------------------------------------------

/**
 * Extrai chave privada e certificado do .pfx usando node-forge,
 * e assina a string de dados do RPS com SHA-1/RSA.
 * Retorna a assinatura em base64.
 */
function assinarRps(
  dadosAssinatura: string,
  pfxBuffer: Buffer,
  pfxPassword: string
): string {
  const p12Der = forge.util.createBuffer(pfxBuffer.toString("binary"));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, pfxPassword);

  // Extrai chave privada
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag =
    keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];

  if (!keyBag?.key) {
    throw new Error("Não foi possível extrair a chave privada do certificado .pfx");
  }

  const privateKey = keyBag.key as forge.pki.rsa.PrivateKey;

  // Assina com SHA-1/RSA (padrão SP NFS-e)
  const md = forge.md.sha1.create();
  md.update(dadosAssinatura, "utf8");
  const signature = privateKey.sign(md);

  return forge.util.encode64(signature);
}

/**
 * Monta a string canônica dos campos do RPS para assinatura.
 * Formato definido pela Secretaria Municipal da Fazenda de SP.
 */
function buildDadosAssinatura(params: {
  inscricaoMunicipal: string;
  serie: string;
  numero: string;
  dataEmissao: string; // YYYYMMDD
  tributacao: string;  // "T"
  situacao: string;    // "N"
  issRetido: string;   // "N" | "S"
  cpfCnpjTomador: string;
  valorServicos: string;
  valorDeducoes: string;
  codigoServico: string;
  aliquota: string;
}): string {
  return [
    params.inscricaoMunicipal.padStart(8, "0"),
    params.serie.padEnd(5),
    params.numero.padStart(12, "0"),
    params.dataEmissao,
    params.tributacao,
    params.situacao,
    params.issRetido,
    params.cpfCnpjTomador.replace(/\D/g, "").padStart(14, "0"),
    params.valorServicos.replace(".", "").padStart(15, "0"),
    params.valorDeducoes.replace(".", "").padStart(15, "0"),
    params.codigoServico.padStart(5, "0"),
    params.aliquota.replace(".", "").padStart(4, "0"),
  ].join("");
}

// ---------------------------------------------------------------------------
// Construção do XML
// ---------------------------------------------------------------------------

function buildRpsXml(
  input: EmitNfseInput,
  inscricaoMunicipal: string,
  itemListaServico: string,
  codigoTributacao: string,
  rpsNumero: string,
  rpsSerieNumero: string,
  assinatura: string
): string {
  const hoje = new Date();
  const dataEmissao = hoje.toISOString();
  const cpfCnpjTomador = input.clientData.cpfCnpj.replace(/\D/g, "");
  const isCnpjTomador = cpfCnpjTomador.length === 14;
  const valorServicos = input.value.toFixed(2);
  const aliquota = (input.issRate / 100).toFixed(4);

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
    <ValorTotalServicos>${valorServicos}</ValorTotalServicos>
    <ValorTotalDeducoes>0.00</ValorTotalDeducoes>
  </Cabecalho>
  <RPS xmlns="http://www.prefeitura.sp.gov.br/nfe" Versao="2">
    <Assinatura>${assinatura}</Assinatura>
    <ChaveRPS>
      <InscricaoPrestador>${inscricaoMunicipal}</InscricaoPrestador>
      <SerieRPS>${rpsSerieNumero}</SerieRPS>
      <NumeroRPS>${rpsNumero}</NumeroRPS>
    </ChaveRPS>
    <TipoRPS>RPS</TipoRPS>
    <DataEmissao>${dataEmissao}</DataEmissao>
    <StatusRPS>N</StatusRPS>
    <TributacaoRPS>T</TributacaoRPS>
    <ValorServicos>${valorServicos}</ValorServicos>
    <ValorDeducoes>0.00</ValorDeducoes>
    <ValorPIS>0.00</ValorPIS>
    <ValorCOFINS>0.00</ValorCOFINS>
    <ValorINSS>0.00</ValorINSS>
    <ValorIR>0.00</ValorIR>
    <ValorCSLL>0.00</ValorCSLL>
    <CodigoServico>${itemListaServico}</CodigoServico>
    <AliquotaServicos>${aliquota}</AliquotaServicos>
    <ISSRetido>false</ISSRetido>
    <CPFCNPJTomador>
      ${tomadorDoc}
    </CPFCNPJTomador>
    <RazaoSocialTomador>${escapeXml(input.clientData.name)}</RazaoSocialTomador>
    <Discriminacao>${escapeXml(input.serviceDescription.substring(0, 2000))}</Discriminacao>
    ${codigoTributacao ? `<CodigoTributacaoMunicipio>${codigoTributacao}</CodigoTributacaoMunicipio>` : ""}
    <ValorISSRetido>0.00</ValorISSRetido>
    <CodigoNBS></CodigoNBS>
    <ValorIBS>0.00</ValorIBS>
    <ValorCBS>0.00</ValorCBS>
  </RPS>
</p1:LoteRPS>`;
}

function buildSoapEnvelope(xmlRps: string): string {
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

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseSoapResponse(responseXml: string): string {
  const match = responseXml.match(/<NumeroNFe>(\d+)<\/NumeroNFe>/);
  if (match) return match[1];

  const match2 = responseXml.match(/<NumeroNota>(\d+)<\/NumeroNota>/);
  if (match2) return match2[1];

  const errMatch = responseXml.match(/<MensagemErro>([\s\S]*?)<\/MensagemErro>/);
  if (errMatch) throw new Error(`Erro NFS-e São Paulo: ${errMatch[1]}`);

  const faultMatch = responseXml.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (faultMatch) throw new Error(`Erro SOAP São Paulo: ${faultMatch[1]}`);

  throw new Error("Resposta inesperada da prefeitura de São Paulo");
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

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
    const hoje = new Date();
    const dataEmissaoStr =
      `${hoje.getFullYear()}` +
      `${String(hoje.getMonth() + 1).padStart(2, "0")}` +
      `${String(hoje.getDate()).padStart(2, "0")}`;

    const cpfCnpjTomador = input.clientData.cpfCnpj.replace(/\D/g, "");

    // Monta e assina os dados do RPS antes de gerar o XML
    const dadosAssinatura = buildDadosAssinatura({
      inscricaoMunicipal: this.inscricaoMunicipal,
      serie: rpsSerieNumero,
      numero: rpsNumero,
      dataEmissao: dataEmissaoStr,
      tributacao: "T",
      situacao: "N",
      issRetido: "N",
      cpfCnpjTomador,
      valorServicos: input.value.toFixed(2),
      valorDeducoes: "0.00",
      codigoServico: this.itemListaServico,
      aliquota: (input.issRate / 100).toFixed(4),
    });

    const assinatura = assinarRps(
      dadosAssinatura,
      this.certBuffer,
      this.certPassword
    );

    const xmlRps = buildRpsXml(
      input,
      this.inscricaoMunicipal,
      this.itemListaServico,
      this.codigoTributacao,
      rpsNumero,
      rpsSerieNumero,
      assinatura
    );

    const soapBody = buildSoapEnvelope(xmlRps);

    // mTLS — apresenta o certificado A1 na camada TLS
    const agent = new https.Agent({
      pfx: this.certBuffer,
      passphrase: this.certPassword,
      rejectUnauthorized: process.env.NFSE_ENV === "production",
    });

    const url = process.env.NFSE_ENV === "production" ? URL_PROD : URL_HOMOLOG;

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
