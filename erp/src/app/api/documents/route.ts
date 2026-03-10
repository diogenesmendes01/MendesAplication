import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/auth";
import { canAccessCompany } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { uploadFile, getFilePath } from "@/lib/file-upload";
import { documentProcessingQueue } from "@/lib/queue";

const ALLOWED_DOCUMENT_TYPES = new Set(["application/pdf", "text/plain"]);
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024; // 10MB

type DocumentAccessResult =
  | { ok: true; companyId: string }
  | { ok: false; response: NextResponse };

async function requireDocumentAccess(
  userId: string,
  role: string,
  companyId: string | null
): Promise<DocumentAccessResult> {
  if (!companyId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "companyId é obrigatório" },
        { status: 400 }
      ),
    };
  }

  const hasAccess = await canAccessCompany(userId, role, companyId);
  if (!hasAccess) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Acesso negado a esta empresa" },
        { status: 403 }
      ),
    };
  }

  return { ok: true, companyId };
}

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("accessToken")?.value;
    if (!token) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const payload = verifyAccessToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    const requestedCompanyId = req.nextUrl.searchParams.get("companyId");
    const access = await requireDocumentAccess(
      payload.userId,
      payload.role,
      requestedCompanyId
    );
    if (!access.ok) return access.response;

    const documents = await prisma.document.findMany({
      where: { companyId: access.companyId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        mimeType: true,
        fileSize: true,
        status: true,
        createdAt: true,
      },
    });

    return NextResponse.json(documents);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erro ao listar documentos";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("accessToken")?.value;
    if (!token) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const payload = verifyAccessToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const requestedCompanyId = formData.get("companyId") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "Nenhum arquivo enviado" },
        { status: 400 }
      );
    }

    const access = await requireDocumentAccess(
      payload.userId,
      payload.role,
      requestedCompanyId
    );
    if (!access.ok) return access.response;

    if (!ALLOWED_DOCUMENT_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: "Tipo de arquivo não permitido. Aceitos: PDF, TXT" },
        { status: 400 }
      );
    }

    if (file.size > MAX_DOCUMENT_SIZE) {
      return NextResponse.json(
        {
          error: `Arquivo muito grande (${(
            file.size / 1024 / 1024
          ).toFixed(1)}MB). Limite: 10MB`,
        },
        { status: 400 }
      );
    }

    const uploadResult = await uploadFile(file, access.companyId);

    const document = await prisma.document.create({
      data: {
        companyId: access.companyId,
        name: file.name,
        mimeType: file.type,
        fileSize: file.size,
      },
    });

    const filePath = await getFilePath(uploadResult.storagePath);

    await documentProcessingQueue.add("process", {
      documentId: document.id,
      companyId: access.companyId,
      filePath: filePath || uploadResult.storagePath,
    });

    return NextResponse.json(document, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro no upload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const token = req.cookies.get("accessToken")?.value;
    if (!token) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const payload = verifyAccessToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    const { id, companyId } = await req.json();

    if (!id || !companyId) {
      return NextResponse.json(
        { error: "id e companyId são obrigatórios" },
        { status: 400 }
      );
    }

    const access = await requireDocumentAccess(
      payload.userId,
      payload.role,
      companyId
    );
    if (!access.ok) return access.response;

    const document = await prisma.document.findFirst({
      where: { id, companyId: access.companyId },
    });

    if (!document) {
      return NextResponse.json(
        { error: "Documento não encontrado" },
        { status: 404 }
      );
    }

    await prisma.document.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erro ao deletar documento";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
