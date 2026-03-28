// ============================================================
// Reclame Aqui — Attachment Validation
// ============================================================
// Limits and accepted formats per HugMe API docs.

export const RA_ATTACHMENT_LIMITS = {
  maxFiles: 6,
  maxAudioSizeMB: 7,
  maxOtherSizeMB: 3,
  acceptedMimeTypes: [
    'image/png', 'image/jpeg', 'image/gif',
    'application/pdf',
    'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'audio/mpeg', 'audio/x-ms-wma', 'audio/ogg', 'audio/aac',
  ],
  acceptedExtensions: ['png', 'jpeg', 'jpg', 'gif', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'mp3', 'wma', 'ogg', 'aac'],
} as const;

const AUDIO_MIME_TYPES = new Set(['audio/mpeg', 'audio/x-ms-wma', 'audio/ogg', 'audio/aac']);

export interface AttachmentValidationError {
  file: string;
  reason: string;
}

/**
 * Validate files against RA attachment limits.
 * Returns empty array if all files are valid.
 */
export function validateRaAttachments(files: File[]): AttachmentValidationError[] {
  const errors: AttachmentValidationError[] = [];

  if (files.length > RA_ATTACHMENT_LIMITS.maxFiles) {
    errors.push({ file: '*', reason: `Máximo ${RA_ATTACHMENT_LIMITS.maxFiles} arquivos por envio` });
    return errors;
  }

  for (const file of files) {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !(RA_ATTACHMENT_LIMITS.acceptedExtensions as readonly string[]).includes(ext)) {
      errors.push({ file: file.name, reason: `Tipo não aceito (.${ext ?? '?'}). Aceitos: ${RA_ATTACHMENT_LIMITS.acceptedExtensions.join(', ')}` });
      continue;
    }

    const isAudio = AUDIO_MIME_TYPES.has(file.type);
    const maxSizeMB = isAudio ? RA_ATTACHMENT_LIMITS.maxAudioSizeMB : RA_ATTACHMENT_LIMITS.maxOtherSizeMB;
    const sizeMB = file.size / (1024 * 1024);

    if (sizeMB > maxSizeMB) {
      errors.push({ file: file.name, reason: `Arquivo muito grande (${sizeMB.toFixed(1)}MB). Máximo: ${maxSizeMB}MB` });
    }
  }

  return errors;
}
