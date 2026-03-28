"use server";

// Re-export from the canonical service module so UI components import from here
// (keeps co-location with the page while the real logic lives in lib/services).

import {
  listDocuments as _listDocuments,
  createDocument as _createDocument,
  updateDocument as _updateDocument,
  deleteDocument as _deleteDocument,
  getDocumentChunks as _getDocumentChunks,
  searchKnowledge as _searchKnowledge,
  getDocumentVersions as _getDocumentVersions,
  restoreVersion as _restoreVersion,
  getKBStats as _getKBStats,
  getAllTags as _getAllTags,
  uploadAndExtractText as _uploadAndExtractText,
  rechunkDocument as _rechunkDocument,
} from "@/lib/services/kb-actions";

// Types: import directly from "@/lib/services/kb-actions"

export async function listDocuments(...args: Parameters<typeof _listDocuments>) {
  return _listDocuments(...args);
}
export async function createDocument(...args: Parameters<typeof _createDocument>) {
  return _createDocument(...args);
}
export async function updateDocument(...args: Parameters<typeof _updateDocument>) {
  return _updateDocument(...args);
}
export async function deleteDocument(...args: Parameters<typeof _deleteDocument>) {
  return _deleteDocument(...args);
}
export async function getDocumentChunks(...args: Parameters<typeof _getDocumentChunks>) {
  return _getDocumentChunks(...args);
}
export async function searchKnowledge(...args: Parameters<typeof _searchKnowledge>) {
  return _searchKnowledge(...args);
}
export async function getDocumentVersions(...args: Parameters<typeof _getDocumentVersions>) {
  return _getDocumentVersions(...args);
}
export async function restoreVersion(...args: Parameters<typeof _restoreVersion>) {
  return _restoreVersion(...args);
}
export async function getKBStats(...args: Parameters<typeof _getKBStats>) {
  return _getKBStats(...args);
}
export async function getAllTags(...args: Parameters<typeof _getAllTags>) {
  return _getAllTags(...args);
}
export async function uploadAndExtractText(...args: Parameters<typeof _uploadAndExtractText>) {
  return _uploadAndExtractText(...args);
}
export async function rechunkDocument(...args: Parameters<typeof _rechunkDocument>) {
  return _rechunkDocument(...args);
}
