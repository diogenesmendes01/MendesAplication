import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

vi.mock("@/lib/session", () => ({
  requireSession: vi.fn().mockResolvedValue({ userId: "u1", email: "t@t.com", role: "ADMIN" }),
  getSession: vi.fn().mockResolvedValue({ userId: "u1", email: "t@t.com", role: "ADMIN" }),
}));
vi.mock("@/lib/rbac", () => ({
  canAccessCompany: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/logger", () => {
  const _log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() };
  return {
    logger: _log,
    createChildLogger: vi.fn(() => _log),
    sanitizeParams: vi.fn((obj: Record<string, unknown>) => obj),
    truncateForLog: vi.fn((v: unknown) => v),
    classifyError: vi.fn(() => "INTERNAL_ERROR"),
    classifyErrorByStatus: vi.fn(() => "INTERNAL_ERROR"),
    ErrorCode: {
      AUTH_FAILED: "AUTH_FAILED",
      VALIDATION_ERROR: "VALIDATION_ERROR",
      NOT_FOUND: "NOT_FOUND",
      PERMISSION_DENIED: "PERMISSION_DENIED",
      EXTERNAL_SERVICE_ERROR: "EXTERNAL_SERVICE_ERROR",
      DATABASE_ERROR: "DATABASE_ERROR",
      ENCRYPTION_ERROR: "ENCRYPTION_ERROR",
      RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
      INTERNAL_ERROR: "INTERNAL_ERROR",
      AUTH_TOKEN_EXPIRED: "AUTH_TOKEN_EXPIRED",
    },
    MAX_LOG_ARG_SIZE: 10240,
  };
});

const mDFF = vi.fn(), mDFM = vi.fn(), mDU = vi.fn(), mDCnt = vi.fn();
const mCC = vi.fn(), mCFM = vi.fn(), mCDM = vi.fn(), mCCnt = vi.fn();
const mVC = vi.fn(), mVFM = vi.fn(), mVFF = vi.fn();
const mDC = vi.fn(), mDD = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    document: {
      create: (...a: unknown[]) => mDC(...a),
      findMany: (...a: unknown[]) => mDFM(...a),
      findFirst: (...a: unknown[]) => mDFF(...a),
      update: (...a: unknown[]) => mDU(...a),
      delete: (...a: unknown[]) => mDD(...a),
      count: (...a: unknown[]) => mDCnt(...a),
    },
    documentChunk: {
      create: (...a: unknown[]) => mCC(...a),
      findMany: (...a: unknown[]) => mCFM(...a),
      deleteMany: (...a: unknown[]) => mCDM(...a),
      count: (...a: unknown[]) => mCCnt(...a),
    },
    documentVersion: {
      create: (...a: unknown[]) => mVC(...a),
      findMany: (...a: unknown[]) => mVFM(...a),
      findFirst: (...a: unknown[]) => mVFF(...a),
    },
  },
}));

const embedding = new Array(1536).fill(0.1);
vi.mock("@/lib/ai/embeddings", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(embedding),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let searchKnowledge: any, rechunkDocument: any, restoreVersion: any, uploadAndExtractText: any;
beforeAll(async () => {
  const mod = await import("@/lib/services/kb-actions");
  searchKnowledge = mod.searchKnowledge;
  rechunkDocument = mod.rechunkDocument;
  restoreVersion = mod.restoreVersion;
  uploadAndExtractText = mod.uploadAndExtractText;
});

describe("KB Search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty for blank query", async () => {
    const r = await searchKnowledge("c1", "");
    expect(r).toEqual([]);
  });

  it("returns empty for whitespace query", async () => {
    const r = await searchKnowledge("c1", "   ");
    expect(r).toEqual([]);
  });

  it("returns empty when no chunks exist", async () => {
    mCFM.mockResolvedValue([]);
    const r = await searchKnowledge("c1", "hello");
    expect(r).toEqual([]);
  });

  it("returns matching chunks sorted by similarity", async () => {
    mCFM.mockResolvedValue([
      {
        id: "c1",
        content: "Test A",
        chunkIndex: 0,
        embedding: embedding,
        document: { id: "d1", name: "Doc1", category: "Cat1" },
      },
      {
        id: "c2",
        content: "Test B",
        chunkIndex: 1,
        embedding: embedding.map((v: number) => v * 0.5),
        document: { id: "d1", name: "Doc1", category: "Cat1" },
      },
    ]);
    const r = await searchKnowledge("c1", "test query", 5);
    expect(r.length).toBeGreaterThanOrEqual(1);
    // First result should have highest similarity
    expect(r[0].similarity).toBe(100);
    expect(r[0].documentName).toBe("Doc1");
  });

  it("filters out chunks with empty embeddings", async () => {
    mCFM.mockResolvedValue([
      {
        id: "c1",
        content: "No embedding",
        chunkIndex: 0,
        embedding: [],
        document: { id: "d1", name: "Doc1", category: null },
      },
    ]);
    const r = await searchKnowledge("c1", "query");
    expect(r).toEqual([]);
  });

  it("respects limit parameter", async () => {
    const chunks = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      content: `Chunk ${i}`,
      chunkIndex: i,
      embedding: embedding,
      document: { id: "d1", name: "Doc1", category: null },
    }));
    mCFM.mockResolvedValue(chunks);
    const r = await searchKnowledge("c1", "query", 3);
    expect(r.length).toBeLessThanOrEqual(3);
  });
});

describe("KB Rechunk", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws if document not found", async () => {
    mDFF.mockResolvedValue(null);
    await expect(rechunkDocument("c1", "x")).rejects.toThrow();
  });

  it("throws if document has no content", async () => {
    mDFF.mockResolvedValue({ id: "d1", content: null });
    await expect(rechunkDocument("c1", "d1")).rejects.toThrow("conteudo");
  });

  it("rechunks document and returns count", async () => {
    mDFF.mockResolvedValue({ id: "d1", content: "Some test content." });
    mCDM.mockResolvedValue({});
    mCC.mockResolvedValue({});
    mDU.mockResolvedValue({});
    const result = await rechunkDocument("c1", "d1");
    expect(result.chunksCreated).toBeGreaterThanOrEqual(1);
    expect(mCDM).toHaveBeenCalledWith({ where: { documentId: "d1" } });
  });
});

describe("KB Restore Version", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws if version not found", async () => {
    mVFF.mockResolvedValue(null);
    await expect(restoreVersion("c1", "d1", 99)).rejects.toThrow("encontrada");
  });

  it("restores version by calling updateDocument internally", async () => {
    mVFF.mockResolvedValue({
      id: "v1",
      version: 1,
      title: "Old Title",
      content: "Old Content",
      category: "Cat",
      tags: ["old"],
    });
    // updateDocument needs findFirst for current doc
    mDFF.mockResolvedValue({
      id: "d1",
      name: "Current",
      content: "Current",
      version: 2,
      category: null,
      tags: [],
      fileSize: 7,
    });
    mVC.mockResolvedValue({});
    mDU.mockResolvedValue({ id: "d1", version: 3 });
    mCDM.mockResolvedValue({});
    mCC.mockResolvedValue({});

    const _result = await restoreVersion("c1", "d1", 1);
    expect(mVC).toHaveBeenCalled(); // saves current before restore
    expect(mDU).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Old Title",
          content: "Old Content",
        }),
      })
    );
  });
});

describe("KB Upload and Extract", () => {
  beforeEach(() => vi.clearAllMocks());

  it("throws if no file provided", async () => {
    const fd = new FormData();
    await expect(uploadAndExtractText(fd)).rejects.toThrow("arquivo");
  });

  it("extracts text from plain text file", async () => {
    const content = "Hello world plain text";
    const file = new File([content], "test.txt", { type: "text/plain" });
    const fd = new FormData();
    fd.append("file", file);
    const result = await uploadAndExtractText(fd);
    expect(result.extractedText).toBe(content);
    expect(result.fileName).toBe("test.txt");
    expect(result.mimeType).toBe("text/plain");
  });

  it("extracts text from CSV file", async () => {
    const csv = "col1,col2\nval1,val2";
    const file = new File([csv], "data.csv", { type: "text/csv" });
    const fd = new FormData();
    fd.append("file", file);
    const result = await uploadAndExtractText(fd);
    expect(result.extractedText).toBe(csv);
  });

  it("throws for unsupported mime type", async () => {
    const file = new File(["data"], "test.bin", { type: "application/octet-stream" });
    const fd = new FormData();
    fd.append("file", file);
    await expect(uploadAndExtractText(fd)).rejects.toThrow("suportado");
  });
});
