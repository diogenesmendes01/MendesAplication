"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  MapPin,
  Calendar,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useCompany } from "@/contexts/company-context";
import { getClientById, type ClientDetail } from "./actions";
import { ClientTimeline } from "@/components/client-timeline";
import { AdditionalContacts } from "./additional-contacts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function clientTypeLabel(t: string): string {
  return t === "PJ" ? "Pessoa Jurídica" : "Pessoa Física";
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.id as string;
  const { selectedCompanyId } = useCompany();

  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const loadClient = useCallback(async () => {
    if (!selectedCompanyId || !clientId) return;
    setLoading(true);
    try {
      const data = await getClientById(clientId, selectedCompanyId);
      setClient(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar cliente"
      );
    } finally {
      setLoading(false);
    }
  }, [clientId, selectedCompanyId]);

  useEffect(() => {
    loadClient();
  }, [loadClient]);

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para visualizar o cliente.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  if (!client) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          Cliente não encontrado.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{client.name}</h1>
          {client.razaoSocial && (
            <p className="text-sm text-muted-foreground">
              {client.razaoSocial}
            </p>
          )}
        </div>
      </div>

      {/* Client Profile Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Dados do Cliente</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex items-start gap-3">
              <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  CPF/CNPJ
                </p>
                <p className="text-sm">{client.cpfCnpj}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <User className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Tipo
                </p>
                <Badge variant="outline">{clientTypeLabel(client.type)}</Badge>
              </div>
            </div>

            {client.email && (
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Email
                  </p>
                  <p className="text-sm">{client.email}</p>
                </div>
              </div>
            )}

            {client.telefone && (
              <div className="flex items-start gap-3">
                <Phone className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Telefone
                  </p>
                  <p className="text-sm">{client.telefone}</p>
                </div>
              </div>
            )}

            {client.endereco && (
              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-xs font-medium text-muted-foreground">
                    Endereço
                  </p>
                  <p className="text-sm">{client.endereco}</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3">
              <Calendar className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Cadastrado em
                </p>
                <p className="text-sm">
                  {dateFmt.format(new Date(client.createdAt))}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Additional Contacts */}
      <AdditionalContacts clientId={clientId} companyId={selectedCompanyId} />

      {/* Timeline */}
      <ClientTimeline clientId={clientId} companyId={selectedCompanyId} />
    </div>
  );
}
