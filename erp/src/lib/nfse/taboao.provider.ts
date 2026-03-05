/**
 * Provider NFS-e — Prefeitura de Taboão da Serra (SP)
 * Sistema: CONAM
 * Autenticação: token1 (usuário) + token2 (senha do webservice)
 * IBGE: 3552809
 */

import axios from "axios";
import type { EmitNfseInput, EmitNfseResult, NfseProvider } from "../nfse";

const URL_HOMOLOG =
  "https://taboaodaserra.conam.com.br/ISSDig/WsNF.asmx";
const URL_PROD =
  "https://taboaodaserra.conam.com.br/ISSDig/WsNF.asmx";

function buildSoapEnvelope(
  token1: string,
  token2: string,
  xmlRps: string
): string {
  const xmlBase64 = Buffer.from(xmlRps, "utf-8").toString("base64");

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsdi="http://wsdi.issDig/">
  <soap:Body>
    <wsdi:RecepcionarLoteRps>
      <wsdi:token1>${token1}</wsdi:token1>
      <wsdi:token2>${token2}</wsdi:token2>
      <wsdi:lote>${xmlBase64}</wsdi:lote>
    </wsdi:RecepcionarLoteRps>
  </soap:Body>
</soap:Envelope>`;
}

function buildRpsXml(
  input: EmitNfseInput,
  inscricaoMunicipal: string,
  itemListaServico: string,
  rpsNumero: string
): string {
  const hoje = new Date();
  const dataEmissao = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const cpfCnpjTomador = input.clientData.cpfCnpj.replace(/\D/g, "");
  const isCnpjTomador = cpfCnpjTomador.length === 14;

  const tomadorDoc = isCnpjTomador
    ? `<CNPJ>${cpfCnpjTomador}</CNPJ>`
    : `<CPF>${cpfCnpjTomador}</CPF>`;

  return `<?xml version="1.0" encoding="utf-8"?>
<lote>
  <rps>
    <InscricaoPrestador>${inscricaoMunicipal}</InscricaoPrestador>
    <NumeroRPS>${rpsNumero}</NumeroRPS>
    <SerieRPS>A1</SerieRPS>
    <TipoRPS>RPS</TipoRPS>
    <DataEmissaoRPS>${dataEmissao}</DataEmissaoRPS>
    <SituacaoRPS>N</SituacaoRPS>
    <CodigoAtividade>${itemListaServico}</CodigoAtividade>
    <ValorServico>${input.value.toFixed(2)}</ValorServico>
    <ValorDeducao>0.00</ValorDeducao>
    <ValorBaseCalculo>${input.value.toFixed(2)}</ValorBaseCalculo>
    <AliquotaISS>${(input.issRate / 100).toFixed(4)}</AliquotaISS>
    <ValorISS>${(input.value * input.issRate / 100).toFixed(2)}</ValorISS>
    <ISSRetido>Nao</ISSRetido>
    <Discriminacao>${escapeXml(input.serviceDescription.substring(0, 2000))}</Discriminacao>
    <TomadorCPFCNPJ>
      ${tomadorDoc}
    </TomadorCPFCNPJ>
    <TomadorRazaoSocial>${escapeXml(input.clientData.name)}</TomadorRazaoSocial>
    ${input.clientData.email ? `<TomadorEmail>${input.clientData.email}</TomadorEmail>` : ""}
  </rps>
</lote>`;
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
  // CONAM retorna o protocolo do lote ou número da nota
  const match = responseXml.match(/<NumeroNota>(\d+)<\/NumeroNota>/);
  if (match) return match[1];

  const match2 = responseXml.match(/<Protocolo>(\d+)<\/Protocolo>/);
  if (match2) return `P${match2[1]}`; // protocolo enquanto aguarda processamento

  const match3 = responseXml.match(/<RecepcionarLoteRpsResult>([\s\S]*?)<\/RecepcionarLoteRpsResult>/);
  if (match3) {
    const inner = match3[1];
    // Verifica se é número ou protocolo
    const numMatch = inner.match(/(\d+)/);
    if (numMatch) return numMatch[1];
  }

  const errMatch = responseXml.match(/<Erro>([\s\S]*?)<\/Erro>/);
  if (errMatch) throw new Error(`Erro NFS-e Taboão da Serra: ${errMatch[1]}`);

  const errMatch2 = responseXml.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (errMatch2) throw new Error(`Erro SOAP Taboão da Serra: ${errMatch2[1]}`);

  throw new Error("Resposta inesperada da prefeitura de Taboão da Serra");
}

export class TaboaoDaSerraNfseProvider implements NfseProvider {
  private token1: string; // usuário
  private token2: string; // senha do webservice
  private inscricaoMunicipal: string;
  private itemListaServico: string;

  constructor(
    token1: string,
    token2: string,
    inscricaoMunicipal: string,
    itemListaServico: string
  ) {
    this.token1 = token1;
    this.token2 = token2;
    this.inscricaoMunicipal = inscricaoMunicipal;
    this.itemListaServico = itemListaServico;
  }

  async emitNFSe(input: EmitNfseInput): Promise<EmitNfseResult> {
    const rpsNumero = Date.now().toString();

    const xmlRps = buildRpsXml(
      input,
      this.inscricaoMunicipal,
      this.itemListaServico,
      rpsNumero
    );

    const soapBody = buildSoapEnvelope(this.token1, this.token2, xmlRps);

    const url =
      process.env.NFSE_ENV === "production" ? URL_PROD : URL_HOMOLOG;

    const response = await axios.post(url, soapBody, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "http://wsdi.issDig/RecepcionarLoteRps",
      },
      timeout: 30_000,
    });

    const nfNumber = parseSoapResponse(response.data as string);
    return { nfNumber };
  }
}
