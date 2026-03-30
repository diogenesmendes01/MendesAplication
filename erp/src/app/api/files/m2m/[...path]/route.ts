import { NextRequest, NextResponse } from "next/server";
import { getFilePath, getMimeType } from "@/lib/file-upload";
import { verifySignedFileRequest } from "@/lib/file-token";
import { withApiLogging } from "@/lib/with-api-logging";
import fs from "fs/promises";
import path from "path";

async function _GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const { path: pathSegments } = await params;
    if (!pathSegments?.length) {
      return NextResponse.json(
        { error: "Caminho não informado" },
        { status: 400 }
      );
    }

    const storagePath = pathSegments.join("/");
    const expires = req.nextUrl.searchParams.get("expires");
    const signature = req.nextUrl.searchParams.get("signature");

    if (!verifySignedFileRequest(storagePath, expires, signature)) {
      return NextResponse.json(
        { error: "Assinatura inválida ou expirada" },
        { status: 401 }
      );
    }

    const uploadsDir = path.join(process.cwd(), "uploads");
    const resolvedPath = path.resolve(uploadsDir, storagePath);
    if (
      !resolvedPath.startsWith(uploadsDir + path.sep) &&
      resolvedPath !== uploadsDir
    ) {
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

    const rawName = pathSegments[pathSegments.length - 1];
    const safeName = path.basename(rawName).replace(/["\r\n]/g, "_");

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${safeName}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Erro ao buscar arquivo" },
      { status: 500 }
    );
  }
}

export const GET = withApiLogging("files.m2m", _GET);
