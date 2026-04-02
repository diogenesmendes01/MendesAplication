"use client";

import { ExternalLink, Loader2, Lock, Scale, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RaActionBarProps {
  ticketId: string;
  companyId: string;
  raExternalId: string | null;
  raHugmeId: string | null;
  raCanEvaluate: boolean;
  raCanModerate: boolean;
  onRequestEvaluation: () => Promise<void>;
  onRequestModeration: () => void;
  onFinishPrivate: () => Promise<void>;
  requestingEval: boolean;
  finishingPrivate: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RaActionBar({
  raExternalId,
  raHugmeId,
  raCanEvaluate,
  raCanModerate,
  onRequestEvaluation,
  onRequestModeration,
  onFinishPrivate,
  requestingEval,
  finishingPrivate,
}: RaActionBarProps) {
  // Use raHugmeId (slug) for the correct company area URL
  // Fallback to raExternalId (numeric) for legacy tickets without raHugmeId
  const raUrl = raHugmeId
    ? `https://www.reclameaqui.com.br/area-da-empresa/reclamacoes/${raHugmeId}`
    : raExternalId
    ? `https://www.reclameaqui.com.br/empresa/ocorrencia/ver/${raExternalId}/`
    : null;


  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-4 py-3">
        <span className="text-xs font-semibold text-purple-700 mr-1 hidden sm:inline">
          Ações RA:
        </span>

        {/* ⭐ Pedir Avaliação */}
        {raCanEvaluate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="border-yellow-300 bg-yellow-50 text-yellow-800 hover:bg-yellow-100"
                onClick={onRequestEvaluation}
                disabled={requestingEval}
              >
                {requestingEval ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Star className="mr-1.5 h-3.5 w-3.5" />
                )}
                {requestingEval ? "Enviando..." : "Pedir Avaliação"}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Solicita que o consumidor avalie o atendimento no Reclame Aqui</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* ⚖️ Pedir Moderação */}
        {raCanModerate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="border-orange-300 bg-orange-50 text-orange-800 hover:bg-orange-100"
                onClick={onRequestModeration}
              >
                <Scale className="mr-1.5 h-3.5 w-3.5" />
                Pedir Moderação
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Solicita moderação da reclamação pelo Reclame Aqui</p>
            </TooltipContent>
          </Tooltip>
        )}

        {/* 🔒 Encerrar Msg Privada */}
        <Tooltip>
          <TooltipTrigger asChild>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-gray-300 text-gray-700 hover:bg-gray-100"
                  disabled={finishingPrivate}
                >
                  {finishingPrivate ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Lock className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {finishingPrivate ? "Encerrando..." : "Encerrar Msg Privada"}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Encerrar mensagem privada?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Isso encerrará a sessão de mensagem privada com o consumidor.
                    Novas mensagens privadas não poderão ser enviadas após o encerramento.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={onFinishPrivate}>
                    Encerrar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TooltipTrigger>
          <TooltipContent>
            <p>Encerra o canal de mensagem privada com o consumidor</p>
          </TooltipContent>
        </Tooltip>

        {/* 🔗 Ver no Reclame Aqui */}
        {raUrl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="border-purple-300 bg-white text-purple-700 hover:bg-purple-50"
                asChild
              >
                <a href={raUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Ver no RA
                </a>
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Abre a reclamação original no portal Reclame Aqui</p>
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
