// File-level disables for worker with dynamic type handling and large-file streaming
// TODO: Refactor with TypeScript strict mode and streaming-based processing
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return */
import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { readFile, stat } from "fs/promises";
import path from "path";
import { extractCnpjs } from "@/lib/ai/cnpj-utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExtractionJobData {
  attachmentId: string;
  storagePath: string;
  mimeType: string;
  fileName: string;
  companyId: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const SUPPORTED_PDF = "application/pdf";
const SUPPORTED_IMAGES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/tiff",
];
const SUPPORTED_TEXT = ["text/plain", "text/csv"];
const SUPPORTED_XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const SUPPORTED_DOCX =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const ALL_SUPPORTED = [
  SUPPORTED_PDF,
  ...SUPPORTED_IMAGES,
  ...SUPPORTED_TEXT,
  SUPPORTED_XLSX,
  SUPPORTED_DOCX,
];


/** Maximum file size allowed for extraction (50 MB) */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Maximum image size for Vision API base64 encoding (5 MB) */
export const MAX_VISION_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

/** rawText length threshold for warning log (100k chars) */
const RAW_TEXT_WARN_LENGTH = 100_000;

const SUMMARY_PROMPT = `Analise o texto extraído de um anexo de atendimento ao cliente e retorne JSON:
{
  "summary": "Resumo em ~50 palavras do conteúdo do documento",
  "metadata": {
    "cnpjs": [],
    "cpfs": [],
    "values": [],
    "dates": [],
    "names": [],
    "emails": [],
    "phones": [],
    "documentType": "boleto|nf|contrato|print|planilha|comprovante|outro",
    "keywords": []
  }
}
Retorne APENAS o JSON válido, sem markdown ou explicação.`;

// ─── Main processor ──────────────────────────────────────────────────────────

export async function processAttachmentExtraction(
  job: Job<ExtractionJobData>
): Promise<void> {
  const { attachmentId, storagePath, mimeType, fileName, companyId } = job.data;
  const startTime = Date.now();

  logger.info(
    { attachmentId, fileName, mimeType },
    "[extraction] Starting extraction"
  );

  // Create or update extraction record to "processing"
  await prisma.attachmentExtraction.upsert({
    where: { attachmentId },
    create: {
      attachmentId,
      method: "pending",
      status: "processing",
      rawText: "",
    },
    update: { status: "processing", errorMessage: null },
  });

  try {
    // 1. Validate mime type
    if (!isMimeTypeSupported(mimeType)) {
      await markFailed(
        attachmentId,
        `Tipo de arquivo não suportado: ${mimeType}`,
        startTime
      );
      return;
    }

    // 2. Read file from storage (with path traversal + size validation)
    const fileBuffer = await readFileFromStorage(storagePath, attachmentId, startTime);
    if (!fileBuffer) return; // already marked as failed inside readFileFromStorage
    if (fileBuffer.length === 0) {
      await markFailed(
        attachmentId,
        "Arquivo vazio ou não encontrado",
        startTime
      );
      return;
    }

    // 3. Cascade extraction pipeline
    const result = await extractText(fileBuffer, mimeType, companyId, attachmentId);

    if (!result) {
      await markFailed(
        attachmentId,
        "Nenhum método de extração retornou texto utilizável",
        startTime
      );
      return;
    }

    const { rawText, method } = result;

    // 3.5. Warn if rawText is very large
    if (rawText.length > RAW_TEXT_WARN_LENGTH) {
      logger.warn(
        { attachmentId, rawTextLength: rawText.length },
        "[extraction] rawText exceeds 100k chars \u2014 storing as-is but may impact performance"
      );
    }

    // 4. Generate summary + metadata via LLM
    const tokenCount = estimateTokens(rawText);
    let summary = "";
    let metadata: Record<string, unknown> = {};

    try {
      const summaryResult = await generateSummaryAndMetadata(rawText);
      summary = summaryResult.summary;
      metadata = summaryResult.metadata;
    } catch (e) {
      logger.warn(
        { attachmentId, error: e },
        "[extraction] Summary generation failed — saving rawText only"
      );
      summary = `Documento: ${fileName} (${tokenCount} tokens)`;
      // Extract CNPJs from rawText as fallback metadata
      const cnpjs = extractCnpjs(rawText);
      if (cnpjs.length > 0) {
        metadata = { cnpjs };
      }
    }

    // 5. Compute confidence based on method
    const confidence = getConfidence(method);
    const processingMs = Date.now() - startTime;

    // 6. Save completed extraction
    await prisma.attachmentExtraction.update({
      where: { attachmentId },
      data: {
        method,
        status: "completed",
        rawText,
        summary,
        metadata: metadata as Record<string, string>,
        confidence,
        tokenCount,
        processingMs,
      },
    });

    // 7. Log CNPJ if found in metadata (for auto-inject)
    const cnpjs = (metadata as { cnpjs?: string[] })?.cnpjs;
    if (cnpjs && cnpjs.length > 0) {
      logger.info(
        { attachmentId, cnpjs, companyId },
        "[extraction] CNPJ(s) found in attachment — available for agent via GET_HISTORY"
      );
    }

    if (tokenCount > 5000) {
      logger.info(
        { attachmentId, tokenCount },
        "[extraction] Large attachment — consider using query parameter in READ_ATTACHMENT"
      );
    }

    logger.info(
      { attachmentId, method, tokenCount, processingMs, confidence },
      "[extraction] Completed successfully"
    );
  } catch (error) {
    await markFailed(
      attachmentId,
      error instanceof Error ? error.message : String(error),
      startTime
    );
  }
}

// ─── Cascade Extraction Pipeline ─────────────────────────────────────────────

interface ExtractionResult {
  rawText: string;
  method: string;
}

async function extractText(
  fileBuffer: Buffer,
  mimeType: string,
  companyId: string,
  attachmentId: string
): Promise<ExtractionResult | null> {
  // Stage 1: Native parse (text, spreadsheet, docx, pdf)
  const nativeResult = await tryNativeParse(fileBuffer, mimeType, attachmentId);
  if (nativeResult) return nativeResult;

  // Stage 2: OCR (for PDFs with scanned content or images)
  if (isOcrCandidate(mimeType)) {
    const ocrResult = await tryOcr(fileBuffer, attachmentId);
    if (ocrResult) return ocrResult;
  }

  // Stage 3: Vision model (last resort for images/PDFs)
  if (isVisionCandidate(mimeType)) {
    const visionResult = await tryVision(
      fileBuffer,
      mimeType,
      companyId,
      attachmentId
    );
    if (visionResult) return visionResult;
  }

  return null;
}

async function tryNativeParse(
  fileBuffer: Buffer,
  mimeType: string,
  attachmentId: string
): Promise<ExtractionResult | null> {
  if (mimeType === SUPPORTED_PDF) {
    try {
      const pdfParse = (await import("pdf-parse") as any).default;
      const result = await pdfParse(fileBuffer);
      if (isExtractionUsable(result.text)) {
        return { rawText: result.text, method: "pdf-parse" };
      }
    } catch (e) {
      logger.warn(
        { attachmentId, error: String(e) },
        "[extraction] pdf-parse failed"
      );
    }
    return null;
  }

  if (SUPPORTED_TEXT.includes(mimeType)) {
    const text = fileBuffer.toString("utf-8");
    if (isExtractionUsable(text)) {
      return { rawText: text, method: "direct" };
    }
    return null;
  }

  if (mimeType === SUPPORTED_XLSX) {
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(fileBuffer, { type: "buffer" });
      const sheets = workbook.SheetNames.map((name) => {
        const sheet = workbook.Sheets[name];
        return `=== ${name} ===\n${XLSX.utils.sheet_to_csv(sheet)}`;
      });
      const text = sheets.join("\n\n");
      if (isExtractionUsable(text)) {
        return { rawText: text, method: "spreadsheet" };
      }
    } catch (e) {
      logger.warn(
        { attachmentId, error: String(e) },
        "[extraction] xlsx parse failed"
      );
    }
    return null;
  }

  if (mimeType === SUPPORTED_DOCX) {
    try {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      if (isExtractionUsable(result.value)) {
        return { rawText: result.value, method: "direct" };
      }
    } catch (e) {
      logger.warn(
        { attachmentId, error: String(e) },
        "[extraction] docx parse failed"
      );
    }
    return null;
  }

  return null;
}

async function tryOcr(
  fileBuffer: Buffer,
  attachmentId: string
): Promise<ExtractionResult | null> {
  try {
    const Tesseract = await import("tesseract.js");
    const result = await Tesseract.recognize(fileBuffer, "por+eng");
    if (isExtractionUsable(result.data.text)) {
      return { rawText: result.data.text, method: "ocr" };
    }
  } catch (e) {
    logger.warn(
      { attachmentId, error: String(e) },
      "[extraction] OCR (tesseract.js) failed"
    );
  }
  return null;
}

async function tryVision(
  fileBuffer: Buffer,
  mimeType: string,
  _companyId: string,
  attachmentId: string
): Promise<ExtractionResult | null> {
  try {
    // Guard: skip vision for images larger than 5 MB
    if (
      SUPPORTED_IMAGES.includes(mimeType) &&
      fileBuffer.length > MAX_VISION_IMAGE_SIZE_BYTES
    ) {
      let resized = false;

      // Attempt to resize with sharp if available
      try {
        const sharp = (await import("sharp")).default;
        const resizedBuffer = await sharp(fileBuffer)
          .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
          .jpeg({ quality: 80 })
          .toBuffer();

        if (resizedBuffer.length <= MAX_VISION_IMAGE_SIZE_BYTES) {
          const base64 = resizedBuffer.toString("base64");
          const text = await callVisionModel(base64, "image/jpeg");
          if (isExtractionUsable(text)) {
            return { rawText: text, method: "vision" };
          }
          return null;
        }
        resized = true; // resized but still too large
      } catch {
        // sharp not available
      }

      logger.warn(
        { attachmentId, sizeBytes: fileBuffer.length, resized },
        "[extraction] Image too large for vision API \u2014 skipping"
      );
      return null;
    }

    const base64 = fileBuffer.toString("base64");
    const text = await callVisionModel(base64, mimeType);
    if (isExtractionUsable(text)) {
      return { rawText: text, method: "vision" };
    }
  } catch (e) {
    logger.warn(
      { attachmentId, error: String(e) },
      "[extraction] Vision model failed"
    );
  }
  return null;
}

// ─── Vision Model (GPT-4o-mini) ─────────────────────────────────────────────

async function callVisionModel(
  base64: string,
  mimeType: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set — vision extraction unavailable");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extraia TODO o texto visível desta imagem. Retorne apenas o texto, sem formatação ou explicação.",
            },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${base64}` },
            },
          ],
        },
      ],
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    throw new Error(`Vision API returned ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content || "";
}

// ─── Summary & Metadata Generation ──────────────────────────────────────────

async function generateSummaryAndMetadata(
  rawText: string
): Promise<{ summary: string; metadata: Record<string, unknown> }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set — summary generation unavailable");
  }

  const textForSummary =
    rawText.length > 8000
      ? rawText.slice(0, 8000) + "\n...[truncado para análise]"
      : rawText;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: textForSummary },
      ],
      max_tokens: 500,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    throw new Error(`Summary API returned ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content || "{}";

  try {
    const parsed = JSON.parse(content) as {
      summary?: string;
      metadata?: Record<string, unknown>;
    };
    return {
      summary: parsed.summary || `Documento com ${estimateTokens(rawText)} tokens`,
      metadata: parsed.metadata || {},
    };
  } catch {
    return {
      summary: `Documento com ${estimateTokens(rawText)} tokens`,
      metadata: {},
    };
  }
}

// ─── Helper Functions ────────────────────────────────────────────────────────

export function isExtractionUsable(text: string | undefined | null): boolean {
  const trimmed = (text || "").trim();
  if (trimmed.length < 10) return false;
  if (trimmed.length < 50 && !/\w{3,}/.test(trimmed)) return false;
  return true;
}

function isMimeTypeSupported(mimeType: string): boolean {
  if (mimeType.startsWith("image/")) return true;
  return ALL_SUPPORTED.includes(mimeType);
}

function isOcrCandidate(mimeType: string): boolean {
  return SUPPORTED_IMAGES.includes(mimeType) || mimeType === SUPPORTED_PDF;
}

function isVisionCandidate(mimeType: string): boolean {
  return SUPPORTED_IMAGES.includes(mimeType) || mimeType === SUPPORTED_PDF;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getConfidence(method: string): number {
  switch (method) {
    case "pdf-parse":
    case "direct":
      return 0.95;
    case "spreadsheet":
      return 0.9;
    case "vision":
      return 0.85;
    case "ocr":
      return 0.7;
    default:
      return 0.5;
  }
}

async function markFailed(
  attachmentId: string,
  error: string,
  startTime: number
): Promise<void> {
  await prisma.attachmentExtraction.update({
    where: { attachmentId },
    data: {
      status: "failed",
      errorMessage: error,
      processingMs: Date.now() - startTime,
    },
  });
  logger.warn({ attachmentId, error }, "[extraction] Failed");
}

/**
 * Reads a file from the uploads directory with path traversal protection
 * and file size validation.
 *
 * Returns null (and marks extraction as failed) if validation fails.
 */
async function readFileFromStorage(
  storagePath: string,
  attachmentId: string,
  startTime: number
): Promise<Buffer | null> {
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const fullPath = path.resolve(uploadsDir, storagePath);

  // Path traversal protection: ensure resolved path is inside uploads/
  if (!fullPath.startsWith(uploadsDir + path.sep) && fullPath !== uploadsDir) {
    logger.warn(
      { attachmentId, storagePath, resolvedPath: fullPath },
      "[extraction] Path traversal detected \u2014 blocking file access"
    );
    await markFailed(attachmentId, "Path traversal detected", startTime);
    return null;
  }

  // File size check before reading into memory
  try {
    const fileStat = await stat(fullPath);
    if (fileStat.size > MAX_FILE_SIZE_BYTES) {
      logger.warn(
        { attachmentId, sizeBytes: fileStat.size, maxBytes: MAX_FILE_SIZE_BYTES },
        "[extraction] File too large \u2014 skipping extraction"
      );
      await markFailed(attachmentId, "File too large", startTime);
      return null;
    }
  } catch (e) {
    // stat failed \u2014 let readFile handle the error naturally
    logger.warn(
      { attachmentId, error: String(e) },
      "[extraction] Could not stat file \u2014 attempting read"
    );
  }

  return readFile(fullPath);
}
