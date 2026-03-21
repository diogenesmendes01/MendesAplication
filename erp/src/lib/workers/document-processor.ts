import { Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import { chunkText } from "@/lib/ai/embedding-utils";
import { generateEmbedding } from "@/lib/ai/embeddings";
import fs from "fs/promises";
import { PDFParse } from "pdf-parse";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentProcessingJobData {
  documentId: string;
  companyId: string;
  filePath: string;
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

async function extractText(filePath: string, mimeType: string): Promise<string> {
  const buffer = await fs.readFile(filePath);

  if (mimeType === "text/plain") {
    return buffer.toString("utf-8");
  }

  if (mimeType === "application/pdf") {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    return result.text;
  }

  throw new Error(`Tipo de arquivo nao suportado: ${mimeType}`);
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export async function processDocumentProcessing(
  job: Job<DocumentProcessingJobData>
) {
  const { documentId, companyId, filePath } = job.data;

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, mimeType: true, companyId: true },
  });

  if (!document) {
    logger.warn(
      `[document-processing] Document ${documentId} not found, skipping`
    );
    return;
  }

  if (document.companyId !== companyId) {
    logger.warn(
      `[document-processing] Document ${documentId} does not belong to company ${companyId}, skipping`
    );
    return;
  }

  try {
    // 1. Extract text from file
    logger.info(
      `[document-processing] Extracting text from ${filePath} (${document.mimeType})`
    );
    const text = await extractText(filePath, document.mimeType);

    if (!text || text.trim().length === 0) {
      throw new Error("Texto extraido esta vazio");
    }

    // 2. Split text into chunks
    const chunks = chunkText(text);
    logger.info(
      `[document-processing] Document ${documentId}: ${chunks.length} chunks created`
    );

    // 3. Generate embeddings and save chunks
    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i];

      logger.info(
        `[document-processing] Document ${documentId}: generating embedding for chunk ${i + 1}/${chunks.length}`
      );
      const embedding = await generateEmbedding(chunkContent);

      await prisma.documentChunk.create({
        data: {
          documentId,
          content: chunkContent,
          embedding,
          chunkIndex: i,
        },
      });
    }

    // 4. Update document status to READY
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "READY" },
    });

    logger.info(
      `[document-processing] Document ${documentId} processed successfully: ${chunks.length} chunks with embeddings`
    );
  } catch (error) {
    logger.error(
      `[document-processing] Failed to process document ${documentId}:`,
      error
    );

    // Update document status to ERROR
    await prisma.document.update({
      where: { id: documentId },
      data: { status: "ERROR" },
    });

    throw error;
  }
}
