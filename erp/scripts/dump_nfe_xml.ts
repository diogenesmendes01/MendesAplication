import fs from "fs";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";

function escapeXml(s: string) {
  return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function pad(n: string|number, l: number) { return String(n).padStart(l,"0"); }
function digits(s: string) { return s.replace(/\D/g,""); }
function calcDV(c43: string) {
  const w=[2,3,4,5,6,7,8,9];
  let s=0; for(let i=0;i<43;i++) s+=parseInt(c43[i])*w[(42-i)%8];
  const r=s%11; return r<2?0:11-r;
}

const now = new Date("2026-03-05T15:10:00-03:00");
const aamm = "2603";
const cNF = pad(Math.floor(Math.random()*99999998)+1, 8);
const c43 = pad("35",2)+aamm+pad(digits("54988934000102"),14)+pad("55",2)+pad("1",3)+pad("5",9)+pad("1",1)+cNF;
const chave = c43 + calcDV(c43);
console.error("Chave:", chave, "len:", chave.length);

const xml = `<?xml version="1.0" encoding="UTF-8"?><NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe versao="4.00" Id="NFe${chave}"><ide><cUF>35</cUF><cNF>${cNF}</cNF><natOp>Venda de mercadoria</natOp><mod>55</mod><serie>001</serie><nNF>000000005</nNF><dhEmi>2026-03-05T15:10:00-03:00</dhEmi><tpNF>1</tpNF><idDest>1</idDest><cMunFG>3550308</cMunFG><tpImp>1</tpImp><tpEmis>1</tpEmis><cDV>${chave[43]}</cDV><tpAmb>2</tpAmb><finNFe>1</finNFe><indFinal>0</indFinal><indPres>9</indPres><procEmi>0</procEmi><verProc>MendesERP-1.0</verProc></ide><emit><CNPJ>54988934000102</CNPJ><xNome>CODEWAVE TECHNOLOGIES LTDA</xNome><enderEmit><xLgr>AVENIDA BRIG FARIA LIMA</xLgr><nro>1811</nro><xBairro>JARDIM PAULISTANO</xBairro><cMun>3550308</cMun><xMun>SAO PAULO</xMun><UF>SP</UF><CEP>01452001</CEP><cPais>1058</cPais><xPais>Brasil</xPais></enderEmit><IE>137250242116</IE><CRT>1</CRT></emit><dest><CNPJ>11222333000181</CNPJ><xNome>NF-E EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL</xNome><enderDest><xLgr>RUA DE TESTE</xLgr><nro>123</nro><xBairro>BAIRRO TESTE</xBairro><cMun>3550308</cMun><xMun>SAO PAULO</xMun><UF>SP</UF><CEP>01310100</CEP><cPais>1058</cPais><xPais>Brasil</xPais></enderDest><indIEDest>1</indIEDest><IE>ISENTO</IE></dest><det nItem="1"><prod><cProd>EBOOK-001</cProd><cEAN>SEM GTIN</cEAN><xProd>LIVRO DIGITAL - TESTE DE INTEGRACAO</xProd><NCM>49019900</NCM><CFOP>6101</CFOP><uCom>UN</uCom><qCom>1.0000</qCom><vUnCom>1.0000000000</vUnCom><vProd>1.00</vProd><cEANTrib>SEM GTIN</cEANTrib><uTrib>UN</uTrib><qTrib>1.0000</qTrib><vUnTrib>1.0000000000</vUnTrib><indTot>1</indTot></prod><imposto><vTotTrib>0.00</vTotTrib><ICMS><ICMSSN300><orig>0</orig><CSOSN>300</CSOSN></ICMSSN300></ICMS><PIS><PISNT><CST>07</CST></PISNT></PIS><COFINS><COFINSNT><CST>07</CST></COFINSNT></COFINS></imposto></det><total><ICMSTot><vBC>0.00</vBC><vICMS>0.00</vICMS><vICMSDeson>0.00</vICMSDeson><vFCP>0.00</vFCP><vBCST>0.00</vBCST><vST>0.00</vST><vFCPST>0.00</vFCPST><vFCPSTRet>0.00</vFCPSTRet><vProd>1.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>0.00</vDesc><vII>0.00</vII><vIPI>0.00</vIPI><vIPIDevol>0.00</vIPIDevol><vPIS>0.00</vPIS><vCOFINS>0.00</vCOFINS><vOutro>0.00</vOutro><vNF>1.00</vNF><vTotTrib>0.00</vTotTrib></ICMSTot></total><transp><modFrete>9</modFrete></transp><infAdic><infCpl>Simples Nacional. Livro digital - imunidade art. 150 VI d CF88 STF RE 330817.</infCpl></infAdic></infNFe></NFe>`;

const pfx = fs.readFileSync("/tmp/nfse-test/codewave/039 - CODEWAVE TECHNOLOGIES LTDA - 54.988.9340001-02 - 123456 - 24.04.2026.pfx");
const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(pfx.toString("binary"))), "123456");
const pk = forge.pki.privateKeyToPem(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag]![0]!.key!);
const cert = forge.pki.certificateToPem(p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag]![0]!.cert!);

const sig = new SignedXml({ privateKey: pk, publicCert: cert, signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1", canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#" });
sig.addReference({ xpath: `//*[@Id='NFe${chave}']`, uri: `#NFe${chave}`, transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature","http://www.w3.org/2001/10/xml-exc-c14n#"], digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1" });
sig.computeSignature(xml, { location: { reference: "//*[local-name()='infNFe']", action: "after" }, prefix: "" });
const signed = sig.getSignedXml();
console.log(signed.replace(/^<\?xml[^?]*\?>\s*/i,""));
