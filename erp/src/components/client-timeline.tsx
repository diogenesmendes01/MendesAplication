"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Headphones,
  CreditCard,
  Mail,
  MessageCircle,
  Filter,
  DollarSign,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getClientTimeline,
  type TimelineItem,
  type TimelineItemType,
} from "@/app/(app)/comercial/clientes/[id]/actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function typeLabel(t: TimelineItemType): string {
  switch (t) {
    case "ticket":
      return "Ticket";
    case "boleto":
      return "Boleto";
    case "email":
      return "Email";
    case "whatsapp":
      return "WhatsApp";
    default:
      return t;
  }
}

function typeIcon(t: TimelineItemType) {
  switch (t) {
    case "ticket":
      return <Headphones className="h-4 w-4" />;
    case "boleto":
      return <CreditCard className="h-4 w-4" />;
    case "email":
      return <Mail className="h-4 w-4" />;
    case "whatsapp":
      return <MessageCircle className="h-4 w-4" />;
    default:
      return null;
  }
}

function typeBgColor(t: TimelineItemType): string {
  switch (t) {
    case "ticket":
      return "bg-blue-100 text-blue-700";
    case "boleto":
      return "bg-emerald-100 text-emerald-700";
    case "email":
      return "bg-purple-100 text-purple-700";
    case "whatsapp":
      return "bg-green-100 text-green-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function statusBadgeVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "PAID":
    case "RESOLVED":
    case "CLOSED":
    case "SENT":
      return "default";
    case "OVERDUE":
      return "destructive";
    case "OPEN":
    case "PENDING":
    case "RECEIVED":
      return "secondary";
    default:
      return "outline";
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case "OPEN":
      return "Aberto";
    case "IN_PROGRESS":
      return "Em Andamento";
    case "WAITING_CLIENT":
      return "Aguardando";
    case "RESOLVED":
      return "Resolvido";
    case "CLOSED":
      return "Fechado";
    case "PENDING":
      return "Pendente";
    case "PAID":
      return "Pago";
    case "OVERDUE":
      return "Vencido";
    case "SENT":
      return "Enviado";
    case "RECEIVED":
      return "Recebido";
    default:
      return s;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ClientTimelineProps {
  clientId: string;
  companyId: string;
}

export function ClientTimeline({ clientId, companyId }: ClientTimelineProps) {
  const router = useRouter();
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>("__all__");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const typeFilter =
        filterType === "__all__"
          ? undefined
          : (filterType as TimelineItemType);
      const data = await getClientTimeline(clientId, companyId, typeFilter);
      setItems(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar histórico"
      );
    } finally {
      setLoading(false);
    }
  }, [clientId, companyId, filterType]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-lg">Histórico de Interações</CardTitle>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Filtrar por tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">Todos</SelectItem>
              <SelectItem value="ticket">Tickets</SelectItem>
              <SelectItem value="boleto">Boletos</SelectItem>
              <SelectItem value="email">Emails</SelectItem>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            Carregando...
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            Nenhuma interação encontrada.
          </div>
        ) : (
          <div className="relative space-y-0">
            {/* Vertical timeline line */}
            <div className="absolute left-[19px] top-2 bottom-2 w-px bg-border" />

            {items.map((item) => (
              <div key={`${item.type}-${item.id}`} className="relative flex gap-4 pb-6 last:pb-0">
                {/* Icon circle */}
                <div
                  className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${typeBgColor(item.type)}`}
                >
                  {typeIcon(item.type)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {typeLabel(item.type)}
                    </span>
                    <Badge variant={statusBadgeVariant(item.status)}>
                      {statusLabel(item.status)}
                    </Badge>
                    {item.hasRefund && (
                      <Badge variant="destructive" className="gap-1">
                        <DollarSign className="h-3 w-3" />
                        Reembolso
                      </Badge>
                    )}
                  </div>

                  {item.contactName && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.contactName}
                      {item.contactRole && ` — ${item.contactRole}`}
                    </p>
                  )}

                  <p className="mt-1 text-sm leading-snug break-words">
                    {item.summary}
                  </p>

                  <div className="mt-1 flex flex-wrap items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      {dateFmt.format(new Date(item.date))}
                    </span>
                    {item.href && (
                      <Button
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() => router.push(item.href!)}
                      >
                        Ver detalhes
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
