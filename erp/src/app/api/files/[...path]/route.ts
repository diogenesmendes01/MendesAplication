import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/auth";
import { getFilePath, getMimeType } from "@/lib/file-upload";
import fs from "fs/promises";
import path from "path";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    // Verify authentication
    const token = req.cookies.get("accessToken")?.value;
    if (!token) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const payload = verifyAccessToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    const { path: pathSegments } = await params;
    const storagePath = pathSegments.join("/");

    // Prevent path traversal: resolve o caminho completo e verifica se está
    // dentro de UPLOADS_DIR. Checar só ".." não é suficiente (e.g. encoded %2e%2e).
    const uploadsDir = path.join(process.cwd(), "uploads");
    const resolvedPath = path.resolve(uploadsDir, storagePath);
    if (!resolvedPath.startsWith(uploadsDir + path.sep) && resolvedPath !== uploadsDir) {
      return NextResponse.json({ error: "Caminho inválido" }, { status: 400 });
    }

    const fullPath = await getFilePath(storagePath);
    if (!fullPath) {
      return NextResponse.json(
        { error: "Arquivo não encontrado" },
        { status: 404 }
      );
    }

    const fileBuffer = await fs.readFile(fullPath);
    const mimeType = getMimeType(storagePath);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${pathSegments[pathSegments.length - 1]}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Erro ao buscar arquivo" },
      { status: 500 }
    );
  }
}
