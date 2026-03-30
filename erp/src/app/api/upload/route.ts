import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/auth";
import { canAccessCompany } from "@/lib/rbac";
import { uploadFile } from "@/lib/file-upload";
import { withApiLogging } from "@/lib/with-api-logging";

async function _POST(req: NextRequest) {
  try {
    // Verificar autenticação
    const token = req.cookies.get("accessToken")?.value
      ?? req.headers.get("authorization")?.replace("Bearer ", "");

    if (!token) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const payload = verifyAccessToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    // IMPORTANTE: companyId deve ser validado contra a sessão autenticada.
    // Aceitar companyId do body sem verificação permite IDOR — usuário da empresa A
    // passaria companyId da empresa B e faria upload em diretório de outra empresa.
    const companyId = formData.get("companyId") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "Nenhum arquivo enviado" },
        { status: 400 }
      );
    }

    if (!companyId) {
      return NextResponse.json(
        { error: "companyId é obrigatório" },
        { status: 400 }
      );
    }

    // Verificar se o usuário autenticado tem acesso à empresa informada.
    // Sem esta verificação, qualquer usuário autenticado poderia fazer upload
    // para o diretório de qualquer outra empresa (IDOR — Insecure Direct Object Reference).
    const hasAccess = await canAccessCompany(payload.userId, payload.role, companyId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Acesso negado a esta empresa" },
        { status: 403 }
      );
    }

    const result = await uploadFile(file, companyId);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro no upload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export const POST = withApiLogging("upload", _POST);
