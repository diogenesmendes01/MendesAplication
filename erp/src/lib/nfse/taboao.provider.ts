/**
 * Provider NFS-e — Prefeitura de Taboão da Serra (SP)
 * Sistema: eTransparência (W5 Datacenters) — Layout v4.00 (Reforma Tributária)
 * Autenticação: CodigoUsuario + CodigoContribuinte no body SOAP + mTLS opcional
 * IBGE: 3552809
 *
 * WSDL prod:  https://nfe.etransparencia.com.br/sp.taboaodaserra/webservice/aws_nfe.aspx?wsdl
 * WSDL homol: https://nfehomo.etransparencia.com.br/sp.taboaodaserra/webservice/aws_nfe.aspx?wsdl
 *
 * Método: PROCESSARPS — envia lote de RPS; retorna protocolo para consulta posterior.
 *
 * Campos obrigatórios v4.00 (Reforma Tributária / LC 214/2025):
 *  - Reg40Item: Srv_CTN (Código de Tributação Nacional) e Srv_NBS (Nomenclatura Brasileira de Serviços)
 *  - Reg60_RTC: Finalidade, IndConsFin, IndDest, IndOpeOne, IndCodOpe, gIBSCBS, gTribReg, gDif
 *  - Reg90: QtdReg40 deve refletir o número de Reg40Item enviados
 *  - Endereço completo do tomador é obrigatório
 */

import axios from "axios";
import type { EmitNfseInput, EmitNfseResult, NfseProvider } from "../nfse";

const URL_PROD =
  "https://nfe.etransparencia.com.br/sp.taboaodaserra/webservice/aws_nfe.aspx";
const URL_HOMOLOG =
  "https://nfehomo.etransparencia.com.br/sp.taboaodaserra/webservice/aws_nfe.aspx";

const NS = "NFe";
const SOAP_ACTION = "NFeaction/AWS_NFE.PROCESSARPS";

/** Campos adicionais obrigatórios por serviço (Srv_CTN e Srv_NBS) */
export interface TaboaoServiceConfig {
  /** Código de Tributação Nacional (ex: "01.07.01.000") */
  codCTN: string;
  /** Nomenclatura Brasileira de Serviços (ex: "1.1501.30.00") */
  codNBS: string;
  /** CClassTrib IBS/CBS (padrão "000001" para regime normal) */
  cClassTrib?: string;
  /** IndCodOpe — geralmente igual ao CTN */
  indCodOpe?: string;
}

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

function splitAddress(endereco: string | undefined): {
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
} {
  // Tenta extrair partes de um endereço livre
  // Formato esperado: "Rua X, 123, Bairro, Cidade/UF, CEP"
  if (!endereco) {
    return {
      logradouro: "NAO INFORMADO",
      numero: "S/N",
      complemento: "",
      bairro: "NAO INFORMADO",
      municipio: "NAO INFORMADO",
      uf: "SP",
      cep: "",
    };
  }
  const parts = endereco.split(",").map((p) => p.trim());
  return {
    logradouro: parts[0] ?? "NAO INFORMADO",
    numero: parts[1] ?? "S/N",
    complemento: parts[2] ?? "",
    bairro: parts[3] ?? "NAO INFORMADO",
    municipio: parts[4]?.split("/")[0]?.trim() ?? "NAO INFORMADO",
    uf: parts[4]?.split("/")[1]?.trim() ?? "SP",
    cep: (parts[5] ?? "").replace(/\D/g, ""),
  };
}

function buildSoapEnvelope(
  codigoUsuario: string,
  codigoContribuinte: string,
  input: EmitNfseInput,
  inscricaoMunicipal: string,
  itemListaServico: string,
  svcConfig: TaboaoServiceConfig,
  rpsNumero: string
): string {
  const hoje = new Date();
  const cpfCnpj = input.clientData.cpfCnpj.replace(/\D/g, "");
  const issValue = (input.value * input.issRate) / 100;
  const alqIss = input.issRate.toFixed(2).replace(".", ",");
  const cClassTrib = svcConfig.cClassTrib ?? "000001";
  const indCodOpe = svcConfig.indCodOpe ?? svcConfig.codCTN;

  const addr = splitAddress(input.clientData.endereco ?? undefined);

  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns0:ws_nfe.PROCESSARPS xmlns:ns0="${NS}">
      <ns0:Sdt_processarpsin>
        <ns0:Login>
          <ns0:CodigoUsuario>${escapeXml(codigoUsuario)}</ns0:CodigoUsuario>
          <ns0:CodigoContribuinte>${escapeXml(codigoContribuinte)}</ns0:CodigoContribuinte>
        </ns0:Login>
        <ns0:SDTRPS>
          <ns0:Ano>${hoje.getFullYear()}</ns0:Ano>
          <ns0:Mes>${String(hoje.getMonth() + 1).padStart(2, "0")}</ns0:Mes>
          <ns0:CPFCNPJ>${input.companyData.cnpj.replace(/\D/g, "")}</ns0:CPFCNPJ>
          <ns0:DTIni>01/${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}</ns0:DTIni>
          <ns0:DTFin>${fmtDate(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0))}</ns0:DTFin>
          <ns0:TipoTrib>1</ns0:TipoTrib>
          <ns0:DtAdeSN/>
          <ns0:AlqIssSN_IP/>
          <ns0:Versao>4.00</ns0:Versao>
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
              <ns0:LogTom>${escapeXml(addr.logradouro)}</ns0:LogTom>
              <ns0:NumEndTom>${escapeXml(addr.numero)}</ns0:NumEndTom>
              <ns0:ComplEndTom>${escapeXml(addr.complemento)}</ns0:ComplEndTom>
              <ns0:BairroTom>${escapeXml(addr.bairro)}</ns0:BairroTom>
              <ns0:MunTom>${escapeXml(addr.municipio)}</ns0:MunTom>
              <ns0:SiglaUFTom>${escapeXml(addr.uf)}</ns0:SiglaUFTom>
              <ns0:CepTom>${addr.cep}</ns0:CepTom>
              <ns0:Telefone/>
              <ns0:InscricaoMunicipal/>
              <ns0:TipoLogLocPre/>
              <ns0:LogLocPre/>
              <ns0:NumEndLocPre/>
              <ns0:ComplEndLocPre/>
              <ns0:BairroLocPre/>
              <ns0:MunLocPre/>
              <ns0:SiglaUFLocpre>SP</ns0:SiglaUFLocpre>
              <ns0:CepLocPre/>
              <ns0:Email1>${escapeXml(input.clientData.email ?? "")}</ns0:Email1>
              <ns0:Email2/><ns0:Email3/>
              <ns0:MoedaTrnExt/><ns0:ValTrnExt/>
              <ns0:Reg30/>
              <ns0:Reg40>
                <ns0:Reg40Item>
                  <ns0:SiglaCpoAdc>Srv_CTN</ns0:SiglaCpoAdc>
                  <ns0:ConteudoCpoAdc>${escapeXml(svcConfig.codCTN)}</ns0:ConteudoCpoAdc>
                </ns0:Reg40Item>
                <ns0:Reg40Item>
                  <ns0:SiglaCpoAdc>Srv_NBS</ns0:SiglaCpoAdc>
                  <ns0:ConteudoCpoAdc>${escapeXml(svcConfig.codNBS)}</ns0:ConteudoCpoAdc>
                </ns0:Reg40Item>
              </ns0:Reg40>
              <ns0:Reg50/>
              <ns0:Reg60_RTC>
                <ns0:Finalidade>0</ns0:Finalidade>
                <ns0:IndConsFin>NAO</ns0:IndConsFin>
                <ns0:IndDest>NAO</ns0:IndDest>
                <ns0:IndOpeOne>NAO</ns0:IndOpeOne>
                <ns0:IndCodOpe>${escapeXml(indCodOpe)}</ns0:IndCodOpe>
                <ns0:VlReeRepRes>0,00</ns0:VlReeRepRes>
                <ns0:gIBSCBS>
                  <ns0:CST>000</ns0:CST>
                  <ns0:CClassTrib>${cClassTrib}</ns0:CClassTrib>
                </ns0:gIBSCBS>
                <ns0:gTribReg>
                  <ns0:CST>000</ns0:CST>
                  <ns0:CClassTrib>${cClassTrib}</ns0:CClassTrib>
                </ns0:gTribReg>
                <ns0:gDif>
                  <ns0:PDifUF>0,00</ns0:PDifUF>
                  <ns0:PDifMun>0,00</ns0:PDifMun>
                </ns0:gDif>
              </ns0:Reg60_RTC>
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
            <ns0:QtdReg40>2</ns0:QtdReg40>
          </ns0:Reg90>
        </ns0:SDTRPS>
      </ns0:Sdt_processarpsin>
    </ns0:ws_nfe.PROCESSARPS>
  </soap:Body>
</soap:Envelope>`;
}

function parseSoapResponse(xml: string): string {
  // Desescapar entidades HTML que o servidor às vezes retorna
  const unescaped = xml
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

  // Verificar retorno
  const mRetorno = unescaped.match(/<Retorno>([\s\S]*?)<\/Retorno>/);
  if (mRetorno && mRetorno[1].trim().toLowerCase() !== "true") {
    // Coletar todos os erros
    const erros: string[] = [];
    const rErro = /<Description>([\s\S]*?)<\/Description>/g;
    let m: RegExpExecArray | null;
    while ((m = rErro.exec(unescaped)) !== null) {
      erros.push(m[1].trim());
    }
    throw new Error(
      `NFS-e Taboão rejeitada: ${erros.join(" | ") || "Erro desconhecido"}`
    );
  }

  // Extrair protocolo
  const mProt = unescaped.match(/<Protocolo>([\s\S]*?)<\/Protocolo>/);
  if (mProt && mProt[1].trim()) {
    return `PROT-${mProt[1].trim()}`;
  }

  // Erro SOAP fault
  const mFault = unescaped.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (mFault) throw new Error(`Erro SOAP Taboão da Serra: ${mFault[1].trim()}`);

  throw new Error("Resposta inesperada da prefeitura de Taboão da Serra");
}

export class TaboaoDaSerraNfseProvider implements NfseProvider {
  private codigoUsuario: string;
  private codigoContribuinte: string;
  private inscricaoMunicipal: string;
  private itemListaServico: string;
  private svcConfig: TaboaoServiceConfig;

  constructor(
    codigoUsuario: string,
    codigoContribuinte: string,
    inscricaoMunicipal: string,
    itemListaServico: string,
    svcConfig: TaboaoServiceConfig
  ) {
    this.codigoUsuario = codigoUsuario;
    this.codigoContribuinte = codigoContribuinte;
    this.inscricaoMunicipal = inscricaoMunicipal;
    this.itemListaServico = itemListaServico;
    this.svcConfig = svcConfig;
  }

  async emitNFSe(input: EmitNfseInput): Promise<EmitNfseResult> {
    // Usar o rpsNumero fornecido (gerado atomicamente via banco) para evitar
    // colisões em emissões simultâneas. Date.now() como fallback apenas para
    // compatibilidade com chamadas legadas que não passam o campo.
    // TODO: remover fallback quando todos os callers passarem rpsNumero.
    const rpsNumero = input.rpsNumero ?? String(Date.now()).slice(-9);

    const soapBody = buildSoapEnvelope(
      this.codigoUsuario,
      this.codigoContribuinte,
      input,
      this.inscricaoMunicipal,
      this.itemListaServico,
      this.svcConfig,
      rpsNumero
    );

    const url = process.env.NFSE_ENV === "production" ? URL_PROD : URL_HOMOLOG;

    const response = await axios.post(url, soapBody, {
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: SOAP_ACTION,
      },
      validateStatus: () => true,
      timeout: 30_000,
    });

    return { nfNumber: parseSoapResponse(response.data as string) };
  }
}
