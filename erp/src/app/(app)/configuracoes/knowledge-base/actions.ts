"use server";

// Re-export from the canonical service module so UI components import from here
// (keeps co-location with the page while the real logic lives in lib/services).

export {
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  getDocumentChunks,
  searchKnowledge,
  getDocumentVersions,
  restoreVersion,
  getKBStats,
  getAllTags,
  uploadAndExtractText,
  rechunkDocument,
} from "@/lib/services/kb-actions";

export type {
  KBDocument,
  KBChunk,
  KBSearchResult,
  KBVersion,
  KBStats,
} from "@/lib/services/kb-actions";
