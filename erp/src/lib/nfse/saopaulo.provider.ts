/**
 * Provider NFS-e — Prefeitura de São Paulo
 * Sistema: Nota Fiscal Paulistana (nfews.prefeitura.sp.gov.br)
 * Layout: v1 (compatível com novo endpoint que suporta v1 e v2)
 * Protocolo: HTTPS com mTLS (certificado A1 .pfx) + assinatura SHA-1/RSA por RPS
 *
 * Referência: Manual de Utilização do Webservice de NFS-e (jan/2026)
 * WSDL: https://nfews.prefeitura.sp.gov.br/lotenfe.asmx?wsdl
 *
 * SOAP:
 *  - Body element: EnvioLoteRPSRequest (não EnvioLoteRPS)
 *  - MensagemXML: XML como string (CDATA ou escapado) — NÃO base64
 *  - Raiz do XML: PedidoEnvioLoteRPS
 *  - Cabecalho: CPFCNPJRemetente, transacao, dtInicio, dtFim, QtdRPS,
 *               ValorTotalServicos, ValorTotalDeducoes
 */

import https from "https";
import axios from "axios";
import forge from "node-forge";
import { SignedXml } from "xml-crypto";
import type { EmitNfseInput, EmitNfseResult, NfseProvider } from "../nfse";

// nfews suporta v1 e v2; nfe (legado) só v1
// Nota: a Prefeitura de SP unificou o endpoint NFS-e em nfews.prefeitura.sp.gov.br
// para ambos os ambientes (homologação e produção). O endpoint legado nfe.prefeitura.sp.gov.br
// está descontinuado. Mantemos as constantes separadas para clareza e fácil atualização futura.
const URL_HOMOLOG = "https://nfews.prefeitura.sp.gov.br/lotenfe.asmx";
const URL_PROD    = "https://nfews.prefeitura.sp.gov.br/lotenfe.asmx";

// ---------------------------------------------------------------------------
// Assinatura digital SHA-1/RSA por RPS
// ---------------------------------------------------------------------------

/**
 * Extrai chave privada do .pfx e assina com SHA-1/RSA.
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

  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag =
    keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];

  if (!keyBag?.key) {
    throw new Error("Não foi possível extrair a chave privada do certificado .pfx");
  }

  const privateKey = keyBag.key as forge.pki.rsa.PrivateKey;
  const md = forge.md.sha1.create();
  md.update(dadosAssinatura, "utf8");
  return forge.util.encode64(privateKey.sign(md));
}

/**
 * String canônica para assinatura do RPS (v1).
 * Formato definido pela Secretaria Municipal da Fazenda de SP.
 * Campos concatenados sem separador:
 *   InscricaoMunicipal(8) + SerieRPS(5) + NumeroRPS(12) + DataEmissao(8:AAAAMMDD)
 *   + Tributacao(1) + Situacao(1) + ISSRetido(1) + CPFCNPJTomador(14)
 *   + ValorServicos(15) + ValorDeducoes(15) + CodigoServico(5) + Aliquota(4)
 */
function buildDadosAssinatura(params: {
  inscricaoMunicipal: string;
  serie: string;
  numero: string;
  dataEmissao: string; // AAAAMMDD
  tributacao: string;  // "T"
  situacao: string;    // "N"
  issRetido: string;   // "N" | "S"
  cpfCnpjTomador: string;
  valorServicos: string;  // "1.00"
  valorDeducoes: string;  // "0.00"
  codigoServico: string;  // "01700" (5 dígitos)
  aliquota: string;       // "0.0200" → "0200" padded
}): string {
  // Valor sem ponto decimal, 15 dígitos (ex: "1.00" → "000000000000100")
  const valorToNum = (v: string) =>
    v.replace(".", "").replace(",", "").padStart(15, "0");

  // Alíquota sem ponto, 4 dígitos (ex: "0.0200" → "0200")
  const alqToNum = (a: string) => {
    const n = parseFloat(a);
    return String(Math.round(n * 10000)).padStart(4, "0");
  };

  return [
    params.inscricaoMunicipal.padStart(8, "0"),
    params.serie.padEnd(5, " "),
    params.numero.padStart(12, "0"),
    params.dataEmissao,
    params.tributacao,
    params.situacao,
    params.issRetido,
    params.cpfCnpjTomador.replace(/\D/g, "").padStart(14, "0"),
    valorToNum(params.valorServicos),
    valorToNum(params.valorDeducoes),
    params.codigoServico.padStart(5, "0"),
    alqToNum(params.aliquota),
  ].join("");
}

// ---------------------------------------------------------------------------
// Construção do XML interno (PedidoEnvioLoteRPS)
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildPedidoXml(
  input: EmitNfseInput,
  inscricaoMunicipal: string,
  itemListaServico: string,
  rpsNumero: string,
  rpsSerieNumero: string,
  assinatura: string,
  dtInicio: string, // AAAA-MM-DD
  dtFim: string,
  tributacaoRps = "T" // "T"=tributado no município; usa codigoTributacao quando fornecido
): string {
  const params = { tributacaoRps };
  const hoje = new Date();
  const dataEmissao = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const valorServicos = input.value.toFixed(2);
  const aliquota = (input.issRate / 100).toFixed(4);

  const cpfCnpjTomador = input.clientData.cpfCnpj.replace(/\D/g, "");
  const isCnpjTomador = cpfCnpjTomador.length === 14;
  const tomadorDoc = isCnpjTomador
    ? `<CNPJ>${cpfCnpjTomador}</CNPJ>`
    : `<CPF>${cpfCnpjTomador}</CPF>`;

  const prestadorCnpj = input.companyData.cnpj.replace(/\D/g, "");

  // Código de serviço precisa ter 5 dígitos
  const codigoServico = itemListaServico.replace(".", "").padStart(5, "0");

  // Namespace apenas no elemento raiz via prefixo (ns:).
  // Elementos filhos NÃO herdam o namespace (XSD usa elementFormDefault="unqualified").
  const NS = "http://www.prefeitura.sp.gov.br/nfe";

  return `<?xml version="1.0" encoding="utf-8"?>
<ns1:PedidoEnvioLoteRPS xmlns:ns1="${NS}">
  <Cabecalho Versao="1">
    <CPFCNPJRemetente>
      <CNPJ>${prestadorCnpj}</CNPJ>
    </CPFCNPJRemetente>
    <transacao>true</transacao>
    <dtInicio>${dtInicio}</dtInicio>
    <dtFim>${dtFim}</dtFim>
    <QtdRPS>1</QtdRPS>
    <ValorTotalServicos>${valorServicos}</ValorTotalServicos>
    <ValorTotalDeducoes>0.00</ValorTotalDeducoes>
  </Cabecalho>
  <RPS>
    <Assinatura>${assinatura}</Assinatura>
    <ChaveRPS>
      <InscricaoPrestador>${inscricaoMunicipal}</InscricaoPrestador>
      <SerieRPS>${rpsSerieNumero}</SerieRPS>
      <NumeroRPS>${rpsNumero}</NumeroRPS>
    </ChaveRPS>
    <TipoRPS>RPS</TipoRPS>
    <DataEmissao>${dataEmissao}</DataEmissao>
    <StatusRPS>N</StatusRPS>
    <TributacaoRPS>${params.tributacaoRps}</TributacaoRPS>
    <ValorServicos>${valorServicos}</ValorServicos>
    <ValorDeducoes>0.00</ValorDeducoes>
    <ValorPIS>0.00</ValorPIS>
    <ValorCOFINS>0.00</ValorCOFINS>
    <ValorINSS>0.00</ValorINSS>
    <ValorIR>0.00</ValorIR>
    <ValorCSLL>0.00</ValorCSLL>
    <CodigoServico>${codigoServico}</CodigoServico>
    <AliquotaServicos>${aliquota}</AliquotaServicos>
    <ISSRetido>false</ISSRetido>
    <CPFCNPJTomador>
      ${tomadorDoc}
    </CPFCNPJTomador>
    <RazaoSocialTomador>${escapeXml(input.clientData.name)}</RazaoSocialTomador>
    ${input.clientData.endereco ? `<EnderecoTomador><Logradouro>${escapeXml(input.clientData.endereco)}</Logradouro><NumeroEndereco>S/N</NumeroEndereco><Cidade>3550308</Cidade><UF>SP</UF><CEP>01310100</CEP></EnderecoTomador>` : ""}
    ${input.clientData.email ? `<EmailTomador>${escapeXml(input.clientData.email)}</EmailTomador>` : ""}
    <Discriminacao>${escapeXml(input.serviceDescription.substring(0, 2000))}</Discriminacao>
  </RPS>
</ns1:PedidoEnvioLoteRPS>`;
}

// ---------------------------------------------------------------------------
// Assinatura XML Digital do documento (W3C xmldsig enveloped)
// ---------------------------------------------------------------------------

/**
 * Extrai chave privada (PEM) e certificado (PEM) do .pfx via node-forge.
 */
function extractPemFromPfx(
  pfxBuffer: Buffer,
  pfxPassword: string
): { privateKeyPem: string; certPem: string } {
  const p12Der = forge.util.createBuffer(pfxBuffer.toString("binary"));
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, pfxPassword);

  // Chave privada
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const keyBag =
    keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0] ??
    p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag]?.[0];
  if (!keyBag?.key) throw new Error("Chave privada não encontrada no .pfx");

  const privateKeyPem = forge.pki.privateKeyToPem(keyBag.key as forge.pki.rsa.PrivateKey);

  // Certificado
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certBag = certBags[forge.pki.oids.certBag]?.[0];
  if (!certBag?.cert) throw new Error("Certificado não encontrado no .pfx");

  const certPem = forge.pki.certificateToPem(certBag.cert);

  return { privateKeyPem, certPem };
}

/**
 * Assina o documento XML inteiro com xmldsig enveloped (SHA1-RSA).
 * Insere <ds:Signature> antes do fechamento do elemento raiz.
 */
function signXmlDocument(
  xmlDoc: string,
  pfxBuffer: Buffer,
  pfxPassword: string
): string {
  const { privateKeyPem, certPem } = extractPemFromPfx(pfxBuffer, pfxPassword);

  // Remove cabeçalho PEM para usar como X509Certificate (só o base64)
  const certBase64 = certPem
    .replace("-----BEGIN CERTIFICATE-----", "")
    .replace("-----END CERTIFICATE-----", "")
    .replace(/\r?\n/g, "");

  const sig = new SignedXml({
    privateKey: privateKeyPem,
    publicCert: certPem,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });

  // uri="" + isEmptyUri=true → referencia documento inteiro sem atributo Id.
  // xpath "/*" é necessário para que xml-crypto encontre o nó raiz antes de aplicar isEmptyUri.
  sig.addReference({
    xpath: "/*",
    uri: "",
    isEmptyUri: true,
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature"],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
  });

  // Nota: em xml-crypto v6 esses são passados no construtor, não como propriedades
  // (já passados acima via options)

  sig.computeSignature(xmlDoc, {
    location: { reference: "//*[local-name()='RPS']", action: "after" },
    prefix: "ds",
  });

  return sig.getSignedXml();
}

// ---------------------------------------------------------------------------
// Envelope SOAP — MensagemXML como CDATA (não base64!)
// ---------------------------------------------------------------------------

function buildSoapEnvelope(xmlPedido: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <EnvioLoteRPSRequest xmlns="http://www.prefeitura.sp.gov.br/nfe">
      <VersaoSchema>1</VersaoSchema>
      <MensagemXML><![CDATA[${xmlPedido}]]></MensagemXML>
    </EnvioLoteRPSRequest>
  </soap:Body>
</soap:Envelope>`;
}

// ---------------------------------------------------------------------------
// Parse da resposta
// ---------------------------------------------------------------------------

function parseSoapResponse(responseXml: string): string {
  // Desescapa o RetornoXML
  const mRetorno = responseXml.match(/<RetornoXML>([\s\S]*?)<\/RetornoXML>/);
  const inner = mRetorno
    ? mRetorno[1]
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    : responseXml;

  // Sucesso — número da NFS-e
  const mNfe = inner.match(/<NumeroNFe>(\d+)<\/NumeroNFe>/);
  if (mNfe) return mNfe[1];

  const mNota = inner.match(/<NumeroNota>(\d+)<\/NumeroNota>/);
  if (mNota) return mNota[1];

  // Número do lote (emissão assíncrona / lote aceito)
  const mSucesso = inner.match(/<Sucesso>(true|1)<\/Sucesso>/i);
  const mLote = inner.match(/<NumeroLote>(\d+)<\/NumeroLote>/);
  if (mSucesso && mLote) return `LOTE-${mLote[1]}`;

  // Erro de negócio
  const mDescricao = inner.match(/<Descricao>([\s\S]*?)<\/Descricao>/);
  const mCodigo    = inner.match(/<Codigo>(\d+)<\/Codigo>/);
  if (mDescricao) {
    throw new Error(
      `Erro NFS-e São Paulo${mCodigo ? ` [${mCodigo[1]}]` : ""}: ${mDescricao[1].trim()}`
    );
  }

  // Fault SOAP
  const mFault = responseXml.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
  if (mFault) throw new Error(`Erro SOAP São Paulo: ${mFault[1]}`);

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
    const hoje = new Date();
    const rpsNumero = String(Date.now()).slice(-12);
    const rpsSerieNumero = "A1";
    const dataEmissaoStr =
      `${hoje.getFullYear()}` +
      `${String(hoje.getMonth() + 1).padStart(2, "0")}` +
      `${String(hoje.getDate()).padStart(2, "0")}`;

    // Primeiro/último dia do mês corrente
    const dtInicio = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-01`;
    const ultimoDia = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
    const dtFim = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(ultimoDia).padStart(2, "0")}`;

    const cpfCnpjTomador = input.clientData.cpfCnpj.replace(/\D/g, "");
    const aliquota = (input.issRate / 100).toFixed(4);
    const codigoServico = this.itemListaServico.replace(".", "").padStart(5, "0");

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
      codigoServico,
      aliquota,
    });

    const assinatura = assinarRps(dadosAssinatura, this.certBuffer, this.certPassword);

    // codigoTributacao para SP deve ser um dos valores aceitos pela Nota Paulistana:
    //   "T" = Tributado no Município (padrão)
    //   "F" = Tributado Fora do Município
    //   "A" = Tributado no Município, porém Isento
    //   "B" = Tributado Fora do Município, porém Isento
    //   "M" = Micro Empreendedor Individual (MEI)
    //   "X" = Tributado no Município, porém Exigível
    //   "V" = Tributado no Município, porém Imune
    //   "P" = Exportação de Serviços
    //   "C" = Cancelado
    // ATENÇÃO: NÃO use código LC116 numérico aqui (ex: "01.07"). Use somente letras acima.
    const TRIBUTACAO_VALIDA = new Set(["T", "F", "A", "B", "M", "X", "V", "P", "C"]);
    const tributacaoRaw = this.codigoTributacao?.toUpperCase() || "T";
    const tributacaoRps = TRIBUTACAO_VALIDA.has(tributacaoRaw) ? tributacaoRaw : "T";

    const xmlPedido = buildPedidoXml(
      input,
      this.inscricaoMunicipal,
      this.itemListaServico,
      rpsNumero,
      rpsSerieNumero,
      assinatura,
      dtInicio,
      dtFim,
      tributacaoRps
    );

    // Assina o documento XML inteiro (xmldsig enveloped)
    const xmlAssinado = signXmlDocument(xmlPedido, this.certBuffer, this.certPassword);

    const soapBody = buildSoapEnvelope(xmlAssinado);

    // mTLS — apresenta o certificado A1 na camada TLS
    const agent = new https.Agent({
      pfx: this.certBuffer,
      passphrase: this.certPassword,
      rejectUnauthorized: true,
    });

    const url = process.env.NFSE_ENV === "production" ? URL_PROD : URL_HOMOLOG;

    const response = await axios.post(url, soapBody, {
      httpsAgent: agent,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: `"http://www.prefeitura.sp.gov.br/nfe/ws/envioLoteRPS"`,
      },
      // Aceita até 599: SOAP fault vem com HTTP 500 em erros de negócio.
      // Falhas de transporte puras (sem corpo SOAP) são detectadas logo abaixo.
      validateStatus: (s) => s < 600,
      timeout: 30_000,
    });

    if (response.status >= 400 && !String(response.data).toLowerCase().includes("<soap")) {
      throw new Error(`Erro de transporte NFS-e São Paulo: HTTP ${response.status}`);
    }

    return { nfNumber: parseSoapResponse(response.data as string) };
  }
}
