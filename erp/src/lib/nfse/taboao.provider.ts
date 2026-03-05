/**
 * Provider NFS-e — Prefeitura de Taboão da Serra (SP)
 * Sistema: eTransparência (W5 Datacenters)
 * Autenticação: CodigoUsuario + CodigoContribuinte no body SOAP
 * IBGE: 3552809
 *
 * WSDL prod:  https://nfe.etransparencia.com.br/sp.taboaodaserra/webservice/aws_nfe.aspx?wsdl
 * WSDL homol: https://nfehomologacao.etransparencia.com.br/sp.taboaodaserra/webservice/aws_nfe.aspx?wsdl
 *
 * Método: PROCESSARPS — envia lote de RPS; retorna protocolo para consulta posterior.
 */

import axios from "axios";
import type { EmitNfseInput, EmitNfseResult, NfseProvider } from "../nfse";

const URL_PROD =
  "https://nfe.etransparencia.com.br/sp.taboaodaserra/webservice/aws_nfe.aspx";
const URL_HOMOLOG =
  "https://nfehomologacao.etransparencia.com.br/sp.taboaodaserra/webservice/aws_nfe.aspx";

const NS = "NFe";
const SOAP_ACTION = "NFeaction/AWS_NFE.PROCESSARPS";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function fmtDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function fmtBrl(n: number): string {
  return n.toFixed(2).replace(".", ",");
}

function buildSoapEnvelope(
  codigoUsuario: string,
  codigoContribuinte: string,
  input: EmitNfseInput,
  inscricaoMunicipal: string,
  itemListaServico: string,
  rpsNumero: string
): string {
  const hoje = new Date();
  const anoMes = hoje;
  const cpfCnpj = input.clientData.cpfCnpj.replace(/\D/g, "");
  const issValue = (input.value * input.issRate) / 100;
  const tipoTrib = "1"; // Simples Nacional

  // Cálculo de alíquota sem a letra de formato pt-BR para o XML
  const alqIss = input.issRate.toFixed(2).replace(".", ",");

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soap:Body>
    <ns0:ws_nfe.PROCESSARPS xmlns:ns0="${NS}">
      <ns0:Sdt_processarpsin>
        <ns0:Login>
          <ns0:CodigoUsuario>${escapeXml(codigoUsuario)}</ns0:CodigoUsuario>
          <ns0:CodigoContribuinte>${escapeXml(codigoContribuinte)}</ns0:CodigoContribuinte>
        </ns0:Login>
        <ns0:SDTRPS>
          <ns0:Ano>${anoMes.getFullYear()}</ns0:Ano>
          <ns0:Mes>${String(anoMes.getMonth() + 1).padStart(2, "0")}</ns0:Mes>
          <ns0:CPFCNPJ>${input.companyData.cnpj.replace(/\D/g, "")}</ns0:CPFCNPJ>
          <ns0:DTIni>01/${String(anoMes.getMonth() + 1).padStart(2, "0")}/${anoMes.getFullYear()}</ns0:DTIni>
          <ns0:DTFin>${fmtDate(new Date(anoMes.getFullYear(), anoMes.getMonth() + 1, 0))}</ns0:DTFin>
          <ns0:TipoTrib>${tipoTrib}</ns0:TipoTrib>
          <ns0:DtAdeSN/>
          <ns0:AlqIssSN_IP/>
          <ns0:Versao>2.00</ns0:Versao>
          <ns0:Reg20>
            <ns0:Reg20Item>
              <ns0:TipoNFS>RPS</ns0:TipoNFS>
              <ns0:NumRps>${rpsNumero.padStart(9, "0")}</ns0:NumRps>
              <ns0:SerRps>A</ns0:SerRps>
              <ns0:DtEmi>${fmtDate(hoje)}</ns0:DtEmi>
              <ns0:RetFonte>NAO</ns0:RetFonte>
              <ns0:CodSrv>${escapeXml(itemListaServico)}</ns0:CodSrv>
              <ns0:DiscrSrv>${escapeXml(input.serviceDescription.substring(0, 2000))}</ns0:DiscrSrv>
              <ns0:VlNFS>${fmtBrl(input.value)}</ns0:VlNFS>
              <ns0:VlDed>0,00</ns0:VlDed>
              <ns0:DiscrDed/>
              <ns0:VlBasCalc>${fmtBrl(input.value)}</ns0:VlBasCalc>
              <ns0:AlqIss>${alqIss}</ns0:AlqIss>
              <ns0:VlIss>${fmtBrl(issValue)}</ns0:VlIss>
              <ns0:VlIssRet>0,00</ns0:VlIssRet>
              <ns0:CpfCnpTom>${cpfCnpj}</ns0:CpfCnpTom>
              <ns0:RazSocTom>${escapeXml(input.clientData.name)}</ns0:RazSocTom>
              <ns0:TipoLogtom>RUA</ns0:TipoLogtom>
              <ns0:LogTom>${escapeXml(input.clientData.endereco ?? "")}</ns0:LogTom>
              <ns0:NumEndTom>S/N</ns0:NumEndTom>
              <ns0:ComplEndTom/>
              <ns0:BairroTom/>
              <ns0:MunTom/>
              <ns0:SiglaUFTom/>
              <ns0:CepTom/>
              <ns0:Telefone/>
              <ns0:InscricaoMunicipal/>
              <ns0:TipoLogLocPre/>
              <ns0:LogLocPre/>
              <ns0:NumEndLocPre/>
              <ns0:ComplEndLocPre/>
              <ns0:BairroLocPre/>
              <ns0:MunLocPre/>
              <ns0:SiglaUFLocpre/>
              <ns0:CepLocPre/>
              <ns0:Email1>${escapeXml(input.clientData.email ?? "")}</ns0:Email1>
              <ns0:Email2/>
              <ns0:Email3/>
              <ns0:Reg30/>
            </ns0:Reg20Item>
          </ns0:Reg20>
          <ns0:Reg90>
            <ns0:QtdRegNormal>1</ns0:QtdRegNormal>
            <ns0:ValorNFS>${fmtBrl(input.value)}</ns0:ValorNFS>
            <ns0:ValorISS>${fmtBrl(issValue)}</ns0:ValorISS>
            <ns0:ValorDed>0,00</ns0:ValorDed>
            <ns0:ValorIssRetTom>0,00</ns0:ValorIssRetTom>
            <ns0:QtdReg30>0</ns0:QtdReg30>
            <ns0:ValorTributos>0,00</ns0:ValorTributos>
          </ns0:Reg90>
        </ns0:SDTRPS>
      </ns0:Sdt_processarpsin>
    </ns0:ws_nfe.PROCESSARPS>
  </soap:Body>
</soap:Envelope>`;
}

function parseSoapResponse(xml: string): string {
  // Resposta de sucesso: contém Protocolo
  const mProtocolo = xml.match(/<ns0:Protocolo>([\s\S]*?)<\/ns0:Protocolo>/);
  if (mProtocolo) return `PROT-${mProtocolo[1].trim()}`;

  const mProtocolo2 = xml.match(/<Protocolo>([\s\S]*?)<\/Protocolo>/);
  if (mProtocolo2) return `PROT-${mProtocolo2[1].trim()}`;

  // Pode ter retornar número de nota direto em algumas versões
  const mNota = xml.match(/<NumeroNota>([\s\S]*?)<\/NumeroNota>/);
  if (mNota) return mNota[1].trim();

  // Erro SOAP
  const mFault = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (mFault) throw new Error(`Erro SOAP Taboão da Serra: ${mFault[1].trim()}`);

  // Erro da aplicação
  const mMsg = xml.match(/<ns0:Description>([\s\S]*?)<\/ns0:Description>/);
  const mType = xml.match(/<ns0:Type>(\d+)<\/ns0:Type>/);
  if (mMsg && mType && mType[1] === "1") throw new Error(`Erro NFS-e Taboão: ${mMsg[1].trim()}`);

  const mRetorno = xml.match(/<ns0:Retorno>([\s\S]*?)<\/ns0:Retorno>/);
  if (mRetorno && mRetorno[1].trim().toLowerCase() === "true") {
    // Processamento aceito — retorna primeiro protocolo disponível
    const mProt = xml.match(/PROT[- ]?(\d+)/i);
    if (mProt) return `PROT-${mProt[1]}`;
    return "ACEITO";
  }

  throw new Error("Resposta inesperada da prefeitura de Taboão da Serra");
}

export class TaboaoDaSerraNfseProvider implements NfseProvider {
  /** CodigoUsuario — obtido no perfil do portal eTransparência */
  private codigoUsuario: string;
  /** CodigoContribuinte — código do contribuinte autorizado na prefeitura */
  private codigoContribuinte: string;
  private inscricaoMunicipal: string;
  private itemListaServico: string;

  constructor(
    codigoUsuario: string,
    codigoContribuinte: string,
    inscricaoMunicipal: string,
    itemListaServico: string
  ) {
    this.codigoUsuario = codigoUsuario;
    this.codigoContribuinte = codigoContribuinte;
    this.inscricaoMunicipal = inscricaoMunicipal;
    this.itemListaServico = itemListaServico;
  }

  async emitNFSe(input: EmitNfseInput): Promise<EmitNfseResult> {
    const rpsNumero = String(Date.now()).slice(-9);

    const soapBody = buildSoapEnvelope(
      this.codigoUsuario,
      this.codigoContribuinte,
      input,
      this.inscricaoMunicipal,
      this.itemListaServico,
      rpsNumero
    );

    const url = process.env.NFSE_ENV === "production" ? URL_PROD : URL_HOMOLOG;

    const response = await axios.post(url, soapBody, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: SOAP_ACTION,
      },
      timeout: 30_000,
    });

    return { nfNumber: parseSoapResponse(response.data as string) };
  }
}
