/**
 * Provider NF-e — SEFAZ-SP (São Paulo)
 * Modelo 55 | Versão 4.00
 *
 * Usado para: CodeWave Technologies (CNPJ 54988934000102)
 * Produto: Livros digitais (NCM 49019900, imunidade constitucional ICMS)
 * Regime: Simples Nacional (CRT=1)
 *
 * SEFAZ-SP endpoints:
 *   Homolog: https://homologacao.nfe.fazenda.sp.gov.br/ws/
 *   Prod:    https://nfe.fazenda.sp.gov.br/ws/
 *
 * Fluxo de autorização:
 *   1. Montar XML + calcular chave de acesso (44 dígitos)
 *   2. Assinar com xmldsig enveloped (RSA-SHA1, C14N exclusive)
 *   3. POST lote para NFeAutorizacao4
 *   4. Se cStat=103: polling em NFeRetAutorizacao4
 *   5. cStat=100 = autorizado; 101 = cancelado; 1xx = em processamento
 */

import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import axios from "axios";
import https from "https";
import type {
  EmitNfeInput,
  EmitNfeResult,
  NfeProvider,
} from "./index";

// ─── URLs ─────────────────────────────────────────────────────────────────────

const SEFAZ_HOMOLOG = "https://homologacao.nfe.fazenda.sp.gov.br/ws";
const SEFAZ_PROD = "https://nfe.fazenda.sp.gov.br/ws";

const WS = {
  autorizacao: "NFeAutorizacao4.asmx",
  retAutorizacao: "NFeRetAutorizacao4.asmx",
  statusServico: "NFeStatusServico4.asmx",
  consultaProtocolo: "NFeConsultaProtocolo4.asmx",
  cancelamento: "NFeRecepcaoEvento4.asmx",
} as const;

const NS_NFE = "http://www.portalfiscal.inf.br/nfe";
const NS_WS_AUTH = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4";
const NS_WS_RETAUTH = "http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function pad(n: number | string, length: number): string {
  return String(n).padStart(length, "0");
}

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

/** Calcula dígito verificador módulo 11 da chave de acesso */
function calcCDV(chave43: string): number {
  const weights = [2, 3, 4, 5, 6, 7, 8, 9];
  let sum = 0;
  for (let i = 0; i < 43; i++) {
    sum += parseInt(chave43[i]) * weights[(42 - i) % 8];
  }
  const rem = sum % 11;
  return rem < 2 ? 0 : 11 - rem;
}

/** Monta a chave de acesso 44 dígitos */
function buildChave(
  cUF: string,
  aamm: string,
  cnpj: string,
  mod: string,
  serie: string,
  nNF: string,
  tpEmis: string,
  cNF: string
): string {
  const chave43 =
    pad(cUF, 2) +
    aamm +
    pad(digits(cnpj), 14) +
    pad(mod, 2) +
    pad(serie, 3) +
    pad(nNF, 9) +
    pad(tpEmis, 1) +
    pad(cNF, 8);
  const cdv = calcCDV(chave43);
  return chave43 + cdv;
}

/** Formato AAMM para a chave */
function getAAMM(d: Date): string {
  return `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1, 2)}`;
}

/** Data/hora no formato NF-e: AAAA-MM-DDTHH:MM:SS-03:00 */
function nfeDatetime(d: Date): string {
  const off = -3; // BRT = UTC-3
  const local = new Date(d.getTime() + off * 60 * 60 * 1000);
  // Formato: "2026-03-05T15:19:19Z" → slice primeiros 19 chars + offset fixo BRT
  return local.toISOString().slice(0, 19) + "-03:00";
}

/** Data AAAA-MM-DD */
function nfeDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── XML NF-e 4.0 ─────────────────────────────────────────────────────────────

function buildNFeXml(input: EmitNfeInput, chave: string, tpAmb: "1" | "2"): string {
  const { companyData: emit, clientData: dest, items } = input;
  const now = new Date();

  // Totais
  const vProd = items.reduce((s, i) => s + i.totalPrice, 0);
  const vNF = vProd; // sem impostos adicionais para livros digitais (imunidade)

  // Tipo de emissão: 1=Normal
  const tpEmis = "1";
  // Tipo de NF: 1=Saída
  const tpNF = "1";
  // Tipo de ambiente: 1=Prod, 2=Homolog
  // Finalidade: 1=NF-e normal
  const finNFe = "1";
  // indFinal: 1=Consumidor final
  const indFinal = dest.ie === "ISENTO" || digits(dest.cpfCnpj).length <= 11 ? "1" : "0";
  // indPres: 9=Outros (venda digital)
  const indPres = "9";
  // tpImp: 1=DANFE retrato
  const tpImp = "1";
  // idDest: 1=interna (mesmo estado), 2=interestadual, 3=exterior
  const idDest = dest.state === emit.state ? "1" : dest.countryCode && dest.countryCode !== "1058" ? "3" : "2";

  // Destinatário: PF ou PJ
  const destIsPF = digits(dest.cpfCnpj).length === 11;
  const destIdDoc = destIsPF
    ? `<CPF>${pad(digits(dest.cpfCnpj), 11)}</CPF>`
    : `<CNPJ>${pad(digits(dest.cpfCnpj), 14)}</CNPJ>`;
  // indIEDest: 1=contribuinte, 2=contribuinte isento, 9=não contribuinte/PF
  const destIndIEDest = destIsPF || !dest.ie || dest.ie === "ISENTO"
    ? "9"
    : "1";
  // IE do dest: incluir apenas se contribuinte com IE válida
  const destIETag = destIndIEDest === "1" && dest.ie
    ? `<IE>${digits(dest.ie)}</IE>`
    : "";

  // Itens
  const detItems = items.map((item, idx) => {
    const nItem = idx + 1;
    // Para Simples Nacional: ICMS usa CSOSN (não CST)
    // CSOSN 300 = Imunidade constitucional (livros, CF/88 art. 150 VI d)
    // Tag correta para CSOSN 102/103/300/400 = ICMSSN102 (conforme schema NF-e 4.0)
    // PIS/COFINS: PISNT/COFINSNT CST 07 = Operação Isenta
    return `<det nItem="${nItem}"><prod><cProd>${escapeXml(item.code)}</cProd><cEAN>SEM GTIN</cEAN><xProd>${escapeXml(item.description.substring(0, 120))}</xProd><NCM>${escapeXml(item.ncm)}</NCM><CFOP>${escapeXml(item.cfop)}</CFOP><uCom>${escapeXml(item.unit)}</uCom><qCom>${item.quantity.toFixed(4)}</qCom><vUnCom>${item.unitPrice.toFixed(10)}</vUnCom><vProd>${item.totalPrice.toFixed(2)}</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>${escapeXml(item.unit)}</uTrib><qTrib>${item.quantity.toFixed(4)}</qTrib><vUnTrib>${item.unitPrice.toFixed(10)}</vUnTrib><indTot>1</indTot></prod><imposto><vTotTrib>0.00</vTotTrib><ICMS><ICMSSN102><orig>0</orig><CSOSN>300</CSOSN></ICMSSN102></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det>`;
  }).join("");

  const infAdic = input.infAdic
    ? `<infAdic><infCpl>${escapeXml(input.infAdic)}</infCpl></infAdic>`
    : `<infAdic><infCpl>Documento emitido por ME ou EPP optante pelo Simples Nacional. Nao gera direito a credito fiscal de ICMS, PIS ou COFINS. Livro digital - imunidade constitucional art. 150, VI, d, CF/88 (STF RE 330817).</infCpl></infAdic>`;

  return `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="${NS_NFE}"><infNFe versao="4.00" Id="NFe${chave}"><ide><cUF>35</cUF><cNF>${chave.slice(35, 43)}</cNF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>${input.serie}</serie><nNF>${input.nNumber}</nNF><dhEmi>${nfeDatetime(now)}</dhEmi><tpNF>${tpNF}</tpNF><idDest>${idDest}</idDest><cMunFG>${emit.cityCode}</cMunFG><tpImp>${tpImp}</tpImp><tpEmis>${tpEmis}</tpEmis><cDV>${chave[43]}</cDV><tpAmb>${tpAmb}</tpAmb><finNFe>${finNFe}</finNFe><indFinal>${indFinal}</indFinal><indPres>${indPres}</indPres><indIntermed>0</indIntermed><procEmi>0</procEmi><verProc>MendesERP-1.0</verProc></ide><emit><CNPJ>${pad(digits(emit.cnpj), 14)}</CNPJ><xNome>${escapeXml(emit.razaoSocial)}</xNome><enderEmit><xLgr>${escapeXml(emit.street)}</xLgr><nro>${escapeXml(emit.number)}</nro>${emit.complement ? `<xCpl>${escapeXml(emit.complement)}</xCpl>` : ""}<xBairro>${escapeXml(emit.district)}</xBairro><cMun>${emit.cityCode}</cMun><xMun>${escapeXml(emit.city)}</xMun><UF>${emit.state}</UF><CEP>${digits(emit.zipCode)}</CEP><cPais>1058</cPais><xPais>Brasil</xPais>${emit.phone ? `<fone>${digits(emit.phone)}</fone>` : ""}</enderEmit><IE>${digits(emit.ie)}</IE><CRT>${emit.crt}</CRT></emit><dest>${destIdDoc}<xNome>${escapeXml(dest.name)}</xNome><enderDest><xLgr>${escapeXml(dest.street)}</xLgr><nro>${escapeXml(dest.number)}</nro>${dest.complement ? `<xCpl>${escapeXml(dest.complement)}</xCpl>` : ""}<xBairro>${escapeXml(dest.district)}</xBairro><cMun>${dest.cityCode}</cMun><xMun>${escapeXml(dest.city)}</xMun><UF>${dest.state}</UF><CEP>${digits(dest.zipCode)}</CEP><cPais>${dest.countryCode ?? "1058"}</cPais><xPais>Brasil</xPais>${dest.phone ? `<fone>${digits(dest.phone)}</fone>` : ""}</enderDest><indIEDest>${destIndIEDest}</indIEDest>${destIETag}${dest.email ? `<email>${escapeXml(dest.email)}</email>` : ""}</dest>${detItems}<total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>${vProd.toFixed(2)}</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>${vNF.toFixed(2)}</vNF><vTotTrib>0.00</vTotTrib></ICMSTot></total><transp><modFrete>9</modFrete></transp><pag><detPag><tPag>99</tPag><xPag>Outros</xPag><vPag>${vNF.toFixed(2)}</vPag></detPag></pag>${infAdic}</infNFe></NFe>`;
}

// ─── Assinatura Digital ────────────────────────────────────────────────────────

function signNFe(xmlUnsigned: string, privateKeyPem: string, certPem: string): string {
  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certPem,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    // NF-e 4.0 exige C14N inclusivo (não exclusivo)
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });

  // Referência para o infNFe (Id="NFe{chave}")
  const match = xmlUnsigned.match(/Id="(NFe[0-9]{44})"/);
  if (!match) throw new Error("Não encontrou Id da NF-e no XML");
  const refId = match[1];

  sig.addReference({
    xpath: `//*[@Id='${refId}']`,
    uri: `#${refId}`,
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
  });

  sig.computeSignature(xmlUnsigned, {
    location: { reference: "//*[local-name()='infNFe']", action: "after" },
    prefix: "",
  });

  return sig.getSignedXml();
}

// ─── SOAP ──────────────────────────────────────────────────────────────────────

function buildLote(nfeSigned: string, idLote: string): string {
  // Remove XML declaration do NF-e antes de embedar no SOAP
  const nfeClean = nfeSigned.replace(/^<\?xml[^?]*\?>\s*/i, "");
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="${NS_WS_AUTH}"><enviNFe xmlns="${NS_NFE}" versao="4.00"><idLote>${idLote}</idLote><indSinc>1</indSinc>${nfeClean}</enviNFe></nfeDadosMsg></soap12:Body></soap12:Envelope>`;
}

function buildConsulta(recibo: string, tpAmb: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body><nfeDadosMsg xmlns="${NS_WS_RETAUTH}"><consReciNFe xmlns="${NS_NFE}" versao="4.00"><tpAmb>${tpAmb}</tpAmb><nRec>${recibo}</nRec></consReciNFe></nfeDadosMsg></soap12:Body></soap12:Envelope>`;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export class SefazSpNfeProvider implements NfeProvider {
  private pfxBuffer: Buffer;
  private pfxPassword: string;

  constructor(pfxBuffer: Buffer, pfxPassword: string) {
    this.pfxBuffer = pfxBuffer;
    this.pfxPassword = pfxPassword;
  }

  private getHttpsAgent(privateKeyPem: string, certPem: string): https.Agent {
    // Em produção, valida o certificado do servidor (ICP-Brasil).
    // Em homologação, SEFAZ pode usar certificado auto-assinado — desabilitar apenas com flag explícita.
    const isProd = process.env.NFE_ENV === "production";
    const rejectUnauthorized = isProd || process.env.NFE_TLS_VERIFY !== "false";
    return new https.Agent({
      key: privateKeyPem,
      cert: certPem,
      rejectUnauthorized,
    });
  }

  private extractPem(): { privateKey: string; cert: string } {
    const p12Der = forge.util.createBuffer(this.pfxBuffer.toString("binary"));
    const p12Asn1 = forge.asn1.fromDer(p12Der);
    const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, this.pfxPassword);

    const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });

    const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
    const certBag = certBags[forge.pki.oids.certBag]?.[0];

    if (!keyBag?.key || !certBag?.cert) {
      throw new Error("Certificado inválido: não encontrou chave ou certificado no PFX");
    }

    return {
      privateKey: forge.pki.privateKeyToPem(keyBag.key),
      cert: forge.pki.certificateToPem(certBag.cert),
    };
  }

  async emitNFe(input: EmitNfeInput): Promise<EmitNfeResult> {
    // NFE_ENV controla o ambiente; NFSE_ENV é mantido como fallback por compatibilidade
    const isProd = (process.env.NFE_ENV ?? process.env.NFSE_ENV) === "production";
    const tpAmb: "1" | "2" = isProd ? "1" : "2";
    const baseUrl = isProd ? SEFAZ_PROD : SEFAZ_HOMOLOG;

    const { privateKey, cert } = this.extractPem();
    const httpsAgent = this.getHttpsAgent(privateKey, cert);

    // 1. Montar chave de acesso
    const now = new Date();
    const cNF = pad(Math.floor(Math.random() * 99999998) + 1, 8);
    const chave = buildChave(
      "35",
      getAAMM(now),
      input.companyData.cnpj,
      "55",
      input.serie,
      String(input.nNumber),
      "1",
      cNF
    );

    // 2. Montar XML
    const xmlUnsigned = buildNFeXml(input, chave, tpAmb);

    // 3. Assinar
    if (process.env.NFE_DEBUG) {
      require("fs").writeFileSync("/tmp/nfe_debug_unsigned.xml", xmlUnsigned);
    }
    const xmlSigned = signNFe(xmlUnsigned, privateKey, cert);
    if (process.env.NFE_DEBUG) {
      require("fs").writeFileSync("/tmp/nfe_debug_signed.xml", xmlSigned);
    }

    // 4. Enviar lote (indSinc=1 = síncrono, espera resposta imediata)
    const idLote = pad(Date.now(), 15).slice(0, 15);
    const soapBody = buildLote(xmlSigned, idLote);

    const response = await axios.post(
      `${baseUrl}/${WS.autorizacao}`,
      soapBody,
      {
        headers: {
          "Content-Type": "application/soap+xml; charset=utf-8; action=\"http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote\"",
        },
        httpsAgent,
        // Aceita 500 pois SEFAZ retorna SOAP fault com HTTP 500 em rejeições fiscais.
        // Outros erros (4xx, etc.) são tratados abaixo antes do parse XML.
        validateStatus: (s) => s < 600,
        timeout: 30_000,
      }
    );

    if (response.status >= 400 && !String(response.data).includes("<soap")) {
      throw new Error(`Erro de transporte SEFAZ: HTTP ${response.status}`);
    }

    const resXml = (response.data as string)
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

    return this.parseAuthResponse(resXml, chave, input.nNumber, baseUrl, httpsAgent);
  }

  private async parseAuthResponse(
    xml: string,
    chave: string,
    numero: number,
    baseUrl: string,
    agent: https.Agent
  ): Promise<EmitNfeResult> {
    // SOAP fault
    const fault = xml.match(/<(?:\w+:)?faultstring>([^<]+)/);
    if (fault) throw new Error(`SEFAZ SOAP fault: ${fault[1]}`);

    // Status do lote
    const loteStat = xml.match(/<cStat>(\d+)/)?.[1];
    const loteMotivo = xml.match(/<xMotivo>([^<]+)/)?.[1] ?? "";

    // 104 = Lote processado (síncrono) — verificar protNFe individual
    if (loteStat === "104" || loteStat === "100") {
      // Extrair infProt da NF-e individual
      const infProt = xml.match(/<infProt>([\s\S]*?)<\/infProt>/)?.[1] ?? "";
      const nfeStat = infProt.match(/<cStat>(\d+)/)?.[1];
      const nfeMotivo = infProt.match(/<xMotivo>([^<]+)/)?.[1] ?? "";
      const nProt = infProt.match(/<nProt>([^<]+)/)?.[1] ?? "";

      if (nfeStat === "100") {
        return { chave, protocolo: nProt, numero };
      }

      throw new Error(`SEFAZ rejeitou NF-e: cStat=${nfeStat} | ${nfeMotivo}`);
    }

    // 103 = Lote recebido, aguardar processamento (assíncrono)
    if (loteStat === "103") {
      const nRec = xml.match(/<nRec>([^<]+)/)?.[1];
      if (!nRec) throw new Error("SEFAZ retornou 103 mas sem nRec");
      return this.pollAutorizacao(nRec, chave, numero, baseUrl, agent);
    }

    // 225, 999 etc = Rejeição direta do lote
    throw new Error(`SEFAZ rejeitou lote: cStat=${loteStat} | ${loteMotivo}`);
  }

  private async pollAutorizacao(
    nRec: string,
    chave: string,
    numero: number,
    baseUrl: string,
    agent: https.Agent,
    attempts = 5
  ): Promise<EmitNfeResult> {
    const tpAmb = (process.env.NFE_ENV ?? process.env.NFSE_ENV) === "production" ? "1" : "2";

    for (let i = 0; i < attempts; i++) {
      await new Promise((r) => setTimeout(r, 3000 + i * 2000));

      const soapBody = buildConsulta(nRec, tpAmb);
      const response = await axios.post(
        `${baseUrl}/${WS.retAutorizacao}`,
        soapBody,
        {
          headers: {
            "Content-Type": "application/soap+xml; charset=utf-8; action=\"http://www.portalfiscal.inf.br/nfe/wsdl/NFeRetAutorizacao4/nfeRetAutorizacaoLote\"",
          },
          httpsAgent: agent,
          validateStatus: (s) => s < 600,
          timeout: 15_000,
        }
      );

      if (response.status >= 400 && !String(response.data).includes("<soap")) {
        throw new Error(`Erro de transporte SEFAZ (poll): HTTP ${response.status}`);
      }

      const resXml = (response.data as string)
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

      const cStat = resXml.match(/<cStat>(\d+)/)?.[1];
      const xMotivo = resXml.match(/<xMotivo>([^<]+)/)?.[1] ?? "";

      // 104 = Lote processado (assíncrono) — extrair infProt individual
      if (cStat === "104" || cStat === "100") {
        const infProt = resXml.match(/<infProt>([\s\S]*?)<\/infProt>/)?.[1] ?? "";
        const nfeStat = infProt.match(/<cStat>(\d+)/)?.[1] ?? cStat;
        const nfeMotivo = infProt.match(/<xMotivo>([^<]+)/)?.[1] ?? xMotivo;
        const nProt = infProt.match(/<nProt>([^<]+)/)?.[1] ?? "";

        if (nfeStat === "100") {
          return { chave, protocolo: nProt, numero };
        }
        throw new Error(`SEFAZ rejeitou NF-e (poll): cStat=${nfeStat} | ${nfeMotivo}`);
      }

      if (cStat === "105") continue; // em processamento, tentar novamente

      throw new Error(`SEFAZ retornou cStat=${cStat} | ${xMotivo}`);
    }

    throw new Error("SEFAZ: timeout aguardando autorização do lote");
  }
}
