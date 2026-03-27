"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { RaTicketContext } from "./ra-actions"; // We'll need to export this from ra-actions.ts

// Helper function to get emoji for feeling
const getFeelingEmoji = (feeling: string | null): string => {
  if (!feeling) return "";
  
  const normalized = feeling.toLowerCase();
  if (normalized.includes("irritado") || normalized.includes("raiva")) return "😡";
  if (normalized.includes("triste") || normalized.includes("decepcionado")) return "😢";
  if (normalized.includes("neutro")) return "😐";
  if (normalized.includes("satisfeito")) return "😊";
  
  return feeling; // Return original text if no match
};

// Helper function to format time (assuming it's in minutes or hours)
const formatTime = (time: string | null): string => {
  if (!time) return "-";
  // Assuming time is in format like "2d 3h" or similar
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

import { useState } from "react";

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
    availableActions,
    recentMessages
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
        </CardContent>
      </Card>

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