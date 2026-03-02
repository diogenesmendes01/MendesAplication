import path from "path";
import fs from "fs/promises";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/csv",
  "text/plain",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".csv",
  ".txt",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UploadResult {
  fileName: string;
  fileSize: number;
  mimeType: string;
  storagePath: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateFile(fileName: string, fileSize: number, mimeType: string): string | null {
  const ext = path.extname(fileName).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `Tipo de arquivo não permitido: ${ext}. Tipos aceitos: ${Array.from(ALLOWED_EXTENSIONS).join(", ")}`;
  }

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return `Tipo MIME não permitido: ${mimeType}`;
  }

  if (fileSize > MAX_FILE_SIZE) {
    return `Arquivo muito grande (${(fileSize / 1024 / 1024).toFixed(1)}MB). Limite: 10MB`;
  }

  return null;
}

function getStorageDir(companyId: string): string {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return path.join(companyId, yearMonth);
}

function sanitizeFileName(fileName: string): string {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext)
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .substring(0, 100);
  const timestamp = Date.now();
  return `${base}_${timestamp}${ext}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function uploadFile(
  file: File,
  companyId: string
): Promise<UploadResult> {
  const error = validateFile(file.name, file.size, file.type);
  if (error) {
    throw new Error(error);
  }

  const storageDir = getStorageDir(companyId);
  const safeFileName = sanitizeFileName(file.name);
  const storagePath = path.join(storageDir, safeFileName);
  const fullPath = path.join(UPLOADS_DIR, storagePath);

  await fs.mkdir(path.dirname(fullPath), { recursive: true });

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);

  return {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    storagePath,
  };
}

export function getFileUrl(storagePath: string): string {
  return `/api/files/${storagePath}`;
}

export async function deleteFile(storagePath: string): Promise<void> {
  const fullPath = path.join(UPLOADS_DIR, storagePath);
  try {
    await fs.unlink(fullPath);
  } catch {
    // File may not exist, ignore
  }
}

export async function getFilePath(storagePath: string): Promise<string | null> {
  const fullPath = path.join(UPLOADS_DIR, storagePath);
  try {
    await fs.access(fullPath);
    return fullPath;
  } catch {
    return null;
  }
}

export function getMimeType(storagePath: string): string {
  const ext = path.extname(storagePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".txt": "text/plain",
  };
  return mimeMap[ext] || "application/octet-stream";
}
