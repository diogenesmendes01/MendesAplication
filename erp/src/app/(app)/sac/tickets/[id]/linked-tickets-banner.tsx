"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Link2, ExternalLink, Check, X, GitMerge, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { getLinkedTickets, confirmLink, rejectLink, mergeTickets, type TicketLinkRow } from "../dedup-actions";
import { channelLabel } from "@/lib/sac/ticket-formatters";

interface LinkedTicketsBannerProps { ticketId: string; companyId: string; }

export default function LinkedTicketsBanner({ ticketId, companyId }: LinkedTicketsBannerProps) {
  const [links, setLinks] = useState<TicketLinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [mergeTarget, setMergeTarget] = useState<TicketLinkRow | null>(null);
  const [merging, setMerging] = useState(false);

  const fetchLinks = useCallback(async () => {
    try { const data = await getLinkedTickets(ticketId, companyId); setLinks(data); }
    catch { /* silent */ }
    finally { setLoading(false); }
  }, [ticketId, companyId]);

  useEffect(() => { fetchLinks(); }, [fetchLinks]);

  async function handleConfirm(linkId: string) {
    try { await confirmLink(linkId, companyId); toast.success("Link confirmado"); fetchLinks(); }
    catch { toast.error("Erro ao confirmar link"); }
  }
  async function handleReject(linkId: string) {
    try { await rejectLink(linkId, companyId); toast.success("Sugestão ignorada"); fetchLinks(); }
    catch { toast.error("Erro ao rejeitar link"); }
  }
  async function handleMerge() {
    if (!mergeTarget) return;
    setMerging(true);
    try { await mergeTickets(mergeTarget.linkedTicket.id, ticketId, companyId); toast.success("Tickets mergeados com sucesso"); setMergeTarget(null); fetchLinks(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Erro ao mergear tickets"); }
    finally { setMerging(false); }
  }

  if (loading || links.length === 0) return null;
  const suggested = links.filter((l) => l.status === "suggested");
  const confirmed = links.filter((l) => l.status === "confirmed");

  return (
    <>
      {suggested.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex items-center gap-2 mb-2">
            <Link2 className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-medium text-amber-800 dark:text-amber-200">
              {suggested.length === 1 ? "Possivelmente relacionado:" : `${suggested.length} tickets possivelmente relacionados:`}
            </span>
          </div>
          <div className="space-y-2">
            {suggested.map((link) => (
              <div key={link.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge variant="outline" className="text-xs shrink-0">{channelLabel(link.linkedTicket.channelType)}</Badge>
                  <span className="truncate text-amber-900 dark:text-amber-100">{link.linkedTicket.subject}</span>
                  <span className="text-xs text-amber-600 dark:text-amber-400 shrink-0">{Math.round(link.confidence * 100)}% match</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => window.open(`/sac/tickets/${link.linkedTicket.id}`, "_blank")}><ExternalLink className="h-3 w-3 mr-1" />Ver</Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-green-600 hover:text-green-700" onClick={() => handleConfirm(link.id)}><Check className="h-3 w-3 mr-1" />Vincular</Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-amber-600 hover:text-amber-700" onClick={() => setMergeTarget(link)}><GitMerge className="h-3 w-3 mr-1" />Merge</Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={() => handleReject(link.id)}><X className="h-3 w-3 mr-1" />Ignorar</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {confirmed.length > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
          <div className="flex items-center gap-2 mb-1">
            <Link2 className="h-4 w-4 text-blue-600" />
            <span className="text-sm font-medium text-blue-800 dark:text-blue-200">Tickets vinculados:</span>
          </div>
          <div className="space-y-1">
            {confirmed.map((link) => (
              <div key={link.id} className="flex items-center gap-2 text-sm">
                <Badge variant="outline" className="text-xs">{link.type}</Badge>
                <Badge variant="outline" className="text-xs">{channelLabel(link.linkedTicket.channelType)}</Badge>
                <span className="truncate text-blue-900 dark:text-blue-100">{link.linkedTicket.subject}</span>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs ml-auto" onClick={() => window.open(`/sac/tickets/${link.linkedTicket.id}`, "_blank")}><ExternalLink className="h-3 w-3" /></Button>
              </div>
            ))}
          </div>
        </div>
      )}
      <AlertDialog open={!!mergeTarget} onOpenChange={(open) => !open && setMergeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><GitMerge className="h-5 w-5" />Merge de Tickets</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p><strong>Ticket principal (mantém):</strong> {mergeTarget?.linkedTicket.subject} ({channelLabel(mergeTarget?.linkedTicket.channelType ?? null)})</p>
                <p><strong>Ticket duplicado (merge):</strong> Este ticket</p>
                <div className="rounded bg-muted p-2 text-xs space-y-1">
                  <p>O que vai acontecer:</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    <li>Mensagens deste ticket serão copiadas como notas no ticket principal</li>
                    <li>Anexos serão movidos para o ticket principal</li>
                    <li>Este ticket será marcado como MERGED</li>
                    <li>IA será desativada neste ticket</li>
                  </ul>
                </div>
                <p className="text-destructive font-medium">⚠️ Esta ação não pode ser desfeita.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleMerge} disabled={merging} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {merging ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <GitMerge className="h-4 w-4 mr-1" />}
              Confirmar Merge
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
