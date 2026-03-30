"use server";

// Re-export from the canonical service module so UI components import from here
// (keeps co-location with the page while the real logic lives in lib/services).

import {
  listDocuments as _svcListDocuments,
  createDocument as _svcCreateDocument,
  updateDocument as _svcUpdateDocument,
  deleteDocument as _svcDeleteDocument,
  getDocumentChunks as _svcGetDocumentChunks,
  searchKnowledge as _svcSearchKnowledge,
  getDocumentVersions as _svcGetDocumentVersions,
  restoreVersion as _svcRestoreVersion,
  getKBStats as _svcGetKBStats,
  getAllTags as _svcGetAllTags,
  uploadAndExtractText as _svcUploadAndExtractText,
  rechunkDocument as _svcRechunkDocument,
} from "@/lib/services/kb-actions";
import { withLogging } from "@/lib/with-logging";

// Types: import directly from "@/lib/services/kb-actions"

export const listDocuments = withLogging('kb.listDocuments', _svcListDocuments);
export const createDocument = withLogging('kb.createDocument', _svcCreateDocument);
export const updateDocument = withLogging('kb.updateDocument', _svcUpdateDocument);
export const deleteDocument = withLogging('kb.deleteDocument', _svcDeleteDocument);
export const getDocumentChunks = withLogging('kb.getDocumentChunks', _svcGetDocumentChunks);
export const searchKnowledge = withLogging('kb.searchKnowledge', _svcSearchKnowledge);
export const getDocumentVersions = withLogging('kb.getDocumentVersions', _svcGetDocumentVersions);
export const restoreVersion = withLogging('kb.restoreVersion', _svcRestoreVersion);
export const getKBStats = withLogging('kb.getKBStats', _svcGetKBStats);
export const getAllTags = withLogging('kb.getAllTags', _svcGetAllTags);
export const uploadAndExtractText = withLogging('kb.uploadAndExtractText', _svcUploadAndExtractText);
export const rechunkDocument = withLogging('kb.rechunkDocument', _svcRechunkDocument);
