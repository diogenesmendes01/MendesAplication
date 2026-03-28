"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { RaTicketContext } from "../tickets/ra-actions";

// Helper function to get emoji for feeling
const getFeelingEmoji = (feeling: string | null): string => {
  if (!feeling) return "";

  const normalized = feeling.toLowerCase();
  if (normalized.includes("irritado") || normalized.includes("raiva")) return "😡";
  if (normalized.includes("triste") || normalized.includes("decepcionado")) return "😢";
  if (normalized.includes("neutro")) return "😐";
  if (normalized.includes("satisfeito")) return "😊";

  return feeling;
};

// Helper function to format time
const formatTime = (time: string | null): string => {
  if (!time) return "-";
  return time;
};

// Helper function to truncate long text with expand functionality
const TruncatedText = ({ text, maxLength = 100 }: { text: string | null; maxLength?: number }) => {
  if (!text) return null;

  const [isExpanded, setIsExpanded] = useState(false);
  const shouldTruncate = text.length > maxLength;

  const displayText = isExpanded ? text : text.substring(0, maxLength) + (shouldTruncate ? "..." : "");

  return (
    <div className="whitespace-pre-wrap">
      {displayText}
      {shouldTruncate && (
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="ml-1 text-blue-600 hover:text-blue-800 underline text-sm"
        >
          {isExpanded ? "mostrar menos" : "mostrar mais"}
        </button>
      )}
    </div>
  );
};


// RA SLA countdown component
function RaSlaCard({ deadline }: { deadline: string }) {
  const deadlineDate = new Date(deadline);
  const now = new Date();

  // Calculate business days remaining
  const target = new Date(deadlineDate);
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  let daysRemaining = 0;
  if (cursor >= target) {
    const d = new Date(target);
    while (d < cursor) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) daysRemaining--;
    }
  } else {
    const d = new Date(cursor);
    while (d < target) {
      d.setDate(d.getDate() + 1);
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) daysRemaining++;
    }
  }

  let badgeColor = "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200";
  let statusText = `${daysRemaining} dias úteis restantes`;
  let borderClass = "border-emerald-200 dark:border-emerald-800";

  if (daysRemaining <= 0) {
    badgeColor = "bg-black text-white dark:bg-gray-900 dark:text-gray-100";
    statusText = daysRemaining === 0 ? "Vence hoje!" : `Expirado há ${Math.abs(daysRemaining)} dia(s) útil(eis)`;
    borderClass = "border-red-500 dark:border-red-700";
  } else if (daysRemaining <= 2) {
    badgeColor = "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
    statusText = `⚠️ ${daysRemaining} dia(s) útil(eis) restante(s)`;
    borderClass = "border-red-300 dark:border-red-700";
  } else if (daysRemaining <= 5) {
    badgeColor = "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    statusText = `${daysRemaining} dias úteis restantes`;
    borderClass = "border-yellow-300 dark:border-yellow-700";
  }

  return (
    <Card className={borderClass}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          ⏱️ SLA Reclame Aqui
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Prazo (10 dias úteis):</span>
          <span className={`px-2 py-1 rounded-md text-xs font-semibold ${badgeColor}`}>
            {statusText}
          </span>
        </div>
        <div className="text-xs text-muted-foreground">
          Vencimento: {deadlineDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}
        </div>
      </CardContent>
    </Card>
  );
}
export function RaDetailPanel({ context }: { context: RaTicketContext }) {
  const {
    raStatusName,
    erpStatus,
    raFrozen,
    raActive,
    raReason,
    raFeeling,
    raCategories,
    raPublicTreatmentTime,
    raPrivateTreatmentTime,
    raCommentsCount,
    raUnreadCount,
    raRating,
    raResolvedIssue,
    raBackDoingBusiness,
    raRatingDate,
    whatsappEval,
    consumerConsideration,
    companyConsideration,
    raModerationStatus,
    raSlaDeadline,
    availableActions,
    recentMessages,
    client
  } = context;

  return (
    <div className="space-y-4">
      {/* Status Section */}
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Status RA:</span>
            <Badge variant={raFrozen ? "destructive" : "default"}>
              {raStatusName || "Não definido"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Status ERP:</span>
            <Badge variant="secondary">{erpStatus}</Badge>
          </div>
          {raFrozen && (
            <Badge variant="destructive" className="w-full justify-center">
              🧊 Ticket congelado
            </Badge>
          )}
          {raActive === false && (
            <Badge variant="outline" className="w-full justify-center">
              🏢 Ticket migrado para outra empresa
            </Badge>
          )}
          {client?.cpfCnpj?.startsWith("RA-") && (
            <Badge variant="destructive" className="w-full justify-center">
              ⚠️ Cliente sem CNPJ
            </Badge>
          )}
        </CardContent>
      </Card>


      {/* RA SLA Section */}
      {raSlaDeadline && (
        <RaSlaCard deadline={raSlaDeadline} />
      )}
      {/* Context Section */}
      {(raReason || raFeeling || (raCategories && raCategories.length > 0)) && (
        <Card>
          <CardHeader>
            <CardTitle>Contexto</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {raReason && (
              <div>
                <span className="text-sm font-medium">Motivo:</span>
                <p className="mt-1">{raReason}</p>
              </div>
            )}
            {raFeeling && (
              <div>
                <span className="text-sm font-medium">Sentimento:</span>
                <p className="mt-1 flex items-center gap-2">
                  {getFeelingEmoji(raFeeling)} {raFeeling}
                </p>
              </div>
            )}
            {raCategories && raCategories.length > 0 && (
              <div>
                <span className="text-sm font-medium">Categorias:</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {raCategories.map((category, index) => (
                    <Badge key={index} variant="secondary">
                      {category}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Metrics Section */}
      {(raPublicTreatmentTime || raPrivateTreatmentTime || raCommentsCount > 0 || raUnreadCount > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Métricas</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-4">
            {raPublicTreatmentTime && (
              <div>
                <span className="text-sm font-medium">Tempo resposta pública:</span>
                <p className="mt-1">{formatTime(raPublicTreatmentTime)}</p>
              </div>
            )}
            {raPrivateTreatmentTime && (
              <div>
                <span className="text-sm font-medium">Tempo resposta privada:</span>
                <p className="mt-1">{formatTime(raPrivateTreatmentTime)}</p>
              </div>
            )}
            {raCommentsCount > 0 && (
              <div>
                <span className="text-sm font-medium">Comentários:</span>
                <p className="mt-1">{raCommentsCount}</p>
              </div>
            )}
            {raUnreadCount > 0 && (
              <div>
                <span className="text-sm font-medium">Não lidas:</span>
                <p className="mt-1">{raUnreadCount}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Evaluation Section */}
      {(raRating || raResolvedIssue !== null || raBackDoingBusiness !== null || raRatingDate || whatsappEval) && (
        <Card>
          <CardHeader>
            <CardTitle>Avaliação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {raRating && (
              <div>
                <span className="text-sm font-medium">Nota:</span>
                <p className="mt-1">{raRating}</p>
              </div>
            )}
            {raResolvedIssue !== null && (
              <div>
                <span className="text-sm font-medium">Resolveu o problema?</span>
                <p className="mt-1">{raResolvedIssue ? "Sim" : "Não"}</p>
              </div>
            )}
            {raBackDoingBusiness !== null && (
              <div>
                <span className="text-sm font-medium">Voltaria a fazer negócio?</span>
                <p className="mt-1">{raBackDoingBusiness ? "Sim" : "Não"}</p>
              </div>
            )}
            {raRatingDate && (
              <div>
                <span className="text-sm font-medium">Data da avaliação:</span>
                <p className="mt-1">{new Date(raRatingDate).toLocaleDateString('pt-BR')}</p>
              </div>
            )}
            {whatsappEval && (
              <div>
                <span className="text-sm font-medium">Avaliação WhatsApp:</span>
                <div className="mt-1 space-y-1">
                  <div>Enviada: {whatsappEval.sent ? "Sim" : "Não"}</div>
                  {whatsappEval.done !== null && <div>Concluída: {whatsappEval.done ? "Sim" : "Não"}</div>}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Moderation Section */}
      {(raModerationStatus || availableActions.some(a => a.action === "REQUEST_MODERATION")) && (
        <Card>
          <CardHeader>
            <CardTitle>Moderação</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {raModerationStatus && (
              <div>
                <span className="text-sm font-medium">Status:</span>
                <p className="mt-1">{raModerationStatus}</p>
              </div>
            )}
            {availableActions.some(a => a.action === "REQUEST_MODERATION") && (
              <div>
                <Button
                  size="sm"
                  disabled={!availableActions.find(a => a.action === "REQUEST_MODERATION")?.enabled}
                >
                  Solicitar Moderação
                </Button>
                {!availableActions.find(a => a.action === "REQUEST_MODERATION")?.enabled &&
                 availableActions.find(a => a.action === "REQUEST_MODERATION")?.reason && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {availableActions.find(a => a.action === "REQUEST_MODERATION")?.reason}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Considerations Section */}
      {(consumerConsideration || companyConsideration) && (
        <Card>
          <CardHeader>
            <CardTitle>Considerações</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {consumerConsideration && (
              <div>
                <span className="text-sm font-medium">Consideração do consumidor:</span>
                <div className="mt-1">
                  <TruncatedText text={consumerConsideration} />
                </div>
              </div>
            )}
            {companyConsideration && (
              <div>
                <span className="text-sm font-medium">Consideração da empresa:</span>
                <div className="mt-1">
                  <TruncatedText text={companyConsideration} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Actions Section */}
      {availableActions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Ações</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {availableActions.map((action, index) => (
                <TooltipProvider key={index}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!action.enabled}
                      >
                        {action.action.replace(/_/g, " ").toLowerCase()}
                      </Button>
                    </TooltipTrigger>
                    {action.reason && (
                      <TooltipContent>
                        <p>{action.reason}</p>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default RaDetailPanel;
