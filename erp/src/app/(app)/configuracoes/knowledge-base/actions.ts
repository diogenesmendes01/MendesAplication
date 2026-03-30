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

const _wrapped_listDocuments = withLogging('kb.listDocuments', _svcListDocuments);
export async function listDocuments(...args: Parameters<typeof _svcListDocuments>) { return _wrapped_listDocuments(...args); }
const _wrapped_createDocument = withLogging('kb.createDocument', _svcCreateDocument);
export async function createDocument(...args: Parameters<typeof _svcCreateDocument>) { return _wrapped_createDocument(...args); }
const _wrapped_updateDocument = withLogging('kb.updateDocument', _svcUpdateDocument);
export async function updateDocument(...args: Parameters<typeof _svcUpdateDocument>) { return _wrapped_updateDocument(...args); }
const _wrapped_deleteDocument = withLogging('kb.deleteDocument', _svcDeleteDocument);
export async function deleteDocument(...args: Parameters<typeof _svcDeleteDocument>) { return _wrapped_deleteDocument(...args); }
const _wrapped_getDocumentChunks = withLogging('kb.getDocumentChunks', _svcGetDocumentChunks);
export async function getDocumentChunks(...args: Parameters<typeof _svcGetDocumentChunks>) { return _wrapped_getDocumentChunks(...args); }
const _wrapped_searchKnowledge = withLogging('kb.searchKnowledge', _svcSearchKnowledge);
export async function searchKnowledge(...args: Parameters<typeof _svcSearchKnowledge>) { return _wrapped_searchKnowledge(...args); }
const _wrapped_getDocumentVersions = withLogging('kb.getDocumentVersions', _svcGetDocumentVersions);
export async function getDocumentVersions(...args: Parameters<typeof _svcGetDocumentVersions>) { return _wrapped_getDocumentVersions(...args); }
const _wrapped_restoreVersion = withLogging('kb.restoreVersion', _svcRestoreVersion);
export async function restoreVersion(...args: Parameters<typeof _svcRestoreVersion>) { return _wrapped_restoreVersion(...args); }
const _wrapped_getKBStats = withLogging('kb.getKBStats', _svcGetKBStats);
export async function getKBStats(...args: Parameters<typeof _svcGetKBStats>) { return _wrapped_getKBStats(...args); }
const _wrapped_getAllTags = withLogging('kb.getAllTags', _svcGetAllTags);
export async function getAllTags(...args: Parameters<typeof _svcGetAllTags>) { return _wrapped_getAllTags(...args); }
const _wrapped_uploadAndExtractText = withLogging('kb.uploadAndExtractText', _svcUploadAndExtractText);
export async function uploadAndExtractText(...args: Parameters<typeof _svcUploadAndExtractText>) { return _wrapped_uploadAndExtractText(...args); }
const _wrapped_rechunkDocument = withLogging('kb.rechunkDocument', _svcRechunkDocument);
export async function rechunkDocument(...args: Parameters<typeof _svcRechunkDocument>) { return _wrapped_rechunkDocument(...args); }
