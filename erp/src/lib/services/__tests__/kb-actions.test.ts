import { describe, it, expect, vi, beforeEach } from "vitest";
vi.mock("@/lib/session", () => ({ requireSession: vi.fn().mockResolvedValue({ userId: "u1", email: "t@t.com", role: "ADMIN" }), getSession: vi.fn().mockResolvedValue({ userId: "u1", email: "t@t.com", role: "ADMIN" }) }));
vi.mock("@/lib/rbac", () => ({ canAccessCompany: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const mDC = vi.fn(), mDFM = vi.fn(), mDFF = vi.fn(), mDU = vi.fn(), mDD = vi.fn(), mDCnt = vi.fn();
const mCC = vi.fn(), mCFM = vi.fn(), mCDM = vi.fn(), mCCnt = vi.fn();
const mVC = vi.fn(), mVFM = vi.fn();
vi.mock("@/lib/prisma", () => ({ prisma: { document: { create: (...a: unknown[]) => mDC(...a), findMany: (...a: unknown[]) => mDFM(...a), findFirst: (...a: unknown[]) => mDFF(...a), update: (...a: unknown[]) => mDU(...a), delete: (...a: unknown[]) => mDD(...a), count: (...a: unknown[]) => mDCnt(...a) }, documentChunk: { create: (...a: unknown[]) => mCC(...a), findMany: (...a: unknown[]) => mCFM(...a), deleteMany: (...a: unknown[]) => mCDM(...a), count: (...a: unknown[]) => mCCnt(...a) }, documentVersion: { create: (...a: unknown[]) => mVC(...a), findMany: (...a: unknown[]) => mVFM(...a), findFirst: vi.fn() } } }));
vi.mock("@/lib/ai/embeddings", () => ({ generateEmbedding: vi.fn().mockResolvedValue(new Array(1536).fill(0.1)) }));
import { beforeAll } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let listDocuments: any, createDocument: any, updateDocument: any, deleteDocument: any, getDocumentChunks: any, getDocumentVersions: any, getKBStats: any, getAllTags: any;
beforeAll(async () => {
  const mod = await import("@/lib/services/kb-actions");
  listDocuments = mod.listDocuments;
  createDocument = mod.createDocument;
  updateDocument = mod.updateDocument;
  deleteDocument = mod.deleteDocument;
  getDocumentChunks = mod.getDocumentChunks;
  getDocumentVersions = mod.getDocumentVersions;
  getKBStats = mod.getKBStats;
  getAllTags = mod.getAllTags;
});

describe("KB Actions", () => {
  beforeEach(() => vi.clearAllMocks());
  it("listDocuments - active by default", async () => { mDFM.mockResolvedValue([{ id: "d1", name: "Doc" }]); const r = await listDocuments("c1"); expect(mDFM).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ isActive: true }) })); expect(r).toHaveLength(1); });
  it("listDocuments - filters by category", async () => { mDFM.mockResolvedValue([]); await listDocuments("c1", { category: "Fin" }); expect(mDFM).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ category: "Fin" }) })); });
  it("listDocuments - filters by tag", async () => { mDFM.mockResolvedValue([]); await listDocuments("c1", { tag: "faq" }); expect(mDFM).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tags: { has: "faq" } }) })); });
  it("createDocument - creates doc + version", async () => { const doc = { id: "d1", name: "N", content: "C", version: 1, tags: [] }; mDC.mockResolvedValue(doc); mVC.mockResolvedValue({}); mCDM.mockResolvedValue({}); mCC.mockResolvedValue({}); mDU.mockResolvedValue(doc); const r = await createDocument("c1", { name: "N", content: "C" }); expect(mDC).toHaveBeenCalled(); expect(mVC).toHaveBeenCalled(); expect(r.id).toBe("d1"); });
  it("updateDocument - saves old version", async () => { mDFF.mockResolvedValue({ id: "d1", name: "Old", content: "Old", version: 1, category: null, tags: [], fileSize: 3 }); mVC.mockResolvedValue({}); mDU.mockResolvedValue({ id: "d1", version: 2 }); mCDM.mockResolvedValue({}); mCC.mockResolvedValue({}); await updateDocument("c1", "d1", { name: "New", content: "New" }); expect(mVC).toHaveBeenCalled(); expect(mDU).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ version: 2 }) })); });
  it("updateDocument - throws if not found", async () => { mDFF.mockResolvedValue(null); await expect(updateDocument("c1", "x", { name: "Y" })).rejects.toThrow("encontrado"); });
  it("deleteDocument - soft by default", async () => { mDFF.mockResolvedValue({ id: "d1" }); mDU.mockResolvedValue({}); await deleteDocument("c1", "d1"); expect(mDU).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: false } })); });
  it("deleteDocument - hard", async () => { mDFF.mockResolvedValue({ id: "d1" }); mDD.mockResolvedValue({}); await deleteDocument("c1", "d1", true); expect(mDD).toHaveBeenCalled(); });
  it("getDocumentChunks", async () => { mDFF.mockResolvedValue({ id: "d1" }); mCFM.mockResolvedValue([{ id: "c1", content: "Hello world test", chunkIndex: 0, createdAt: new Date() }]); const r = await getDocumentChunks("c1", "d1"); expect(r[0].tokenEstimate).toBe(4); });
  it("getDocumentVersions", async () => { mDFF.mockResolvedValue({ id: "d1" }); mVFM.mockResolvedValue([{ id: "v2", version: 2 }, { id: "v1", version: 1 }]); const r = await getDocumentVersions("c1", "d1"); expect(r).toHaveLength(2); });
  it("getKBStats", async () => { mDCnt.mockResolvedValueOnce(10).mockResolvedValueOnce(8); mCCnt.mockResolvedValue(50); mDFF.mockResolvedValue({ updatedAt: new Date() }); mDFM.mockResolvedValue([{ category: "Fin" }, { category: "Com" }]); const r = await getKBStats("c1"); expect(r.totalDocuments).toBe(10); expect(r.categories).toEqual(["Com", "Fin"]); });
  it("getAllTags", async () => { mDFM.mockResolvedValue([{ tags: ["b", "a"] }, { tags: ["b", "c"] }]); const r = await getAllTags("c1"); expect(r).toEqual(["a", "b", "c"]); });
});
