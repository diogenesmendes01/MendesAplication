import { NextRequest, NextResponse } from "next/server";
import { verifyAccessToken } from "@/lib/auth";
import { canAccessCompany } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/encryption";
import { getGateway } from "@/lib/payment/factory";
import { isProviderType } from "@/lib/payment/types";

/**
 * GET /api/boletos/[boletoId]/pdf
 *
 * Returns a JSON object with the PDF download link for a boleto.
 * Uses the optional `getBankSlipPdf` method from the PaymentGateway interface.
 * Requires authenticated session with access to the boleto's company.
 *
 * Response: { link: string }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ boletoId: string }> },
) {
  try {
    // 1. Authenticate
    const token = req.cookies.get("accessToken")?.value;
    if (!token) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const payload = verifyAccessToken(token);
    if (!payload) {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    const { boletoId } = await params;

    // 2. Look up boleto with provider and client info
    const boleto = await prisma.boleto.findUnique({
      where: { id: boletoId },
      include: {
        provider: true,
        proposal: {
          include: {
            client: true,
          },
        },
      },
    });

    if (!boleto) {
      return NextResponse.json(
        { error: "Boleto não encontrado" },
        { status: 404 },
      );
    }

    // 3. Verify company access
    const hasAccess = await canAccessCompany(
      payload.userId,
      payload.role,
      boleto.companyId,
    );
    if (!hasAccess) {
      return NextResponse.json(
        { error: "Acesso negado a esta empresa" },
        { status: 403 },
      );
    }

    // 4. Validate provider exists
    if (!boleto.provider) {
      return NextResponse.json(
        { error: "Boleto sem provider configurado" },
        { status: 400 },
      );
    }

    if (!boleto.gatewayId) {
      return NextResponse.json(
        { error: "Boleto não possui gatewayId registrado" },
        { status: 400 },
      );
    }

    // 5. Extract covenantCode and bankNumber from gatewayId
    // Format: nsuCode.nsuDate.ENV.covenantCode.bankNumber
    const parts = boleto.gatewayId.split(".");
    if (parts.length !== 5) {
      return NextResponse.json(
        { error: "gatewayId do boleto está em formato inválido" },
        { status: 400 },
      );
    }
    const covenantCode = parts[3];
    const bankNumber = parts[4];

    // 6. Get payer document number from the client
    const payerDocumentNumber = boleto.proposal?.client?.cpfCnpj;
    if (!payerDocumentNumber) {
      return NextResponse.json(
        { error: "Documento do pagador não encontrado" },
        { status: 400 },
      );
    }
    // Remove formatting (keep only digits)
    const cleanDocument = payerDocumentNumber.replace(/\D/g, "");

    // 7. Instantiate the provider gateway
    const provider = boleto.provider;
    if (!isProviderType(provider.provider)) {
      return NextResponse.json(
        { error: "Tipo de provider inválido" },
        { status: 500 },
      );
    }

    const decryptedCredentials = JSON.parse(
      decrypt(provider.credentials),
    ) as Record<string, unknown>;
    const metadata = provider.metadata as Record<string, unknown> | null;

    const gateway = getGateway(
      provider.provider,
      decryptedCredentials,
      metadata,
      provider.webhookSecret ? decrypt(provider.webhookSecret) : undefined,
      { sandbox: provider.sandbox, companyId: boleto.companyId },
    );

    // 8. Call getBankSlipPdf via the PaymentGateway interface (optional method)
    if (!gateway.getBankSlipPdf) {
      return NextResponse.json(
        { error: "Provider não suporta download de PDF" },
        { status: 400 },
      );
    }

    const result = await gateway.getBankSlipPdf(
      covenantCode,
      bankNumber,
      cleanDocument,
    );

    return NextResponse.json({ link: result.link });
  } catch (err) {
    console.error("[api/boletos/pdf] Error:", err);
    const message =
      err instanceof Error ? err.message : "Erro ao obter PDF do boleto";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
