import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/auth";
import { getFilePath, getMimeType } from "@/lib/file-upload";
import fs from "fs/promises";

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

    // Prevent path traversal
    if (storagePath.includes("..")) {
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
