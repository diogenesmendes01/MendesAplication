"use client";

import { useState, useCallback } from "react";
import { ChevronDown, ChevronUp, Search, Wrench, Brain, BarChart3, Clock, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { fetchAuditTrail, exportAuditTrail, type AuditTrailRecord } from "../audit-trail-actions";
import { toast } from "sonner";

interface ToolCallData { tool: string; args: Record<string, unknown>; result: string; durationMs: number; }

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });

function decisionLabel(d: string) {
  const map: Record<string, string> = { respond: "Respondeu", escalate: "Escalou", collect_info: "Coletou Info", suggest: "Sugeriu", no_action: "Sem Ação" };
  return map[d] || d;
}
function decisionColor(d: string) {
  const map: Record<string, string> = { respond: "bg-green-100 text-green-800", escalate: "bg-red-100 text-red-800", suggest: "bg-blue-100 text-blue-800" };
  return map[d] || "bg-gray-100 text-gray-800";
}
function formatDuration(ms: number) { return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`; }
function formatCost(c: number | string) { const v = typeof c === "string" ? parseFloat(c) : c; return v < 0.01 ? `R$ ${v.toFixed(4)}` : `R$ ${v.toFixed(2)}`; }

function AuditEntryCard({ entry }: { entry: AuditTrailRecord }) {
  const [expanded, setExpanded] = useState(false);
  const toolCalls = (entry.toolCalls as unknown as ToolCallData[]) || [];
  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger asChild>
        <button type="button" className="w-full text-left rounded-lg border bg-card p-3 hover:bg-muted/50 transition-colors">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-mono text-muted-foreground">#{entry.iteration}</span>
              <Badge variant="secondary" className={`text-xs ${decisionColor(entry.decision)}`}>{decisionLabel(entry.decision)}</Badge>
              {toolCalls.length > 0 && <span className="text-xs text-muted-foreground">{toolCalls.length} tool{toolCalls.length > 1 ? "s" : ""}</span>}
              <span className="text-xs text-muted-foreground">{formatDuration(entry.durationMs)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{dateFmt.format(new Date(entry.createdAt))}</span>
              {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-1 rounded-lg border bg-muted/20 p-4 space-y-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1"><Search className="h-3.5 w-3.5 text-blue-600" /><span className="text-xs font-semibold text-blue-800">Input</span></div>
            <p className="text-sm bg-white rounded p-2 border">{entry.input.substring(0, 300)}{entry.input.length > 300 && "..."}</p>
          </div>
          {entry.reasoning && (
            <div>
              <div className="flex items-center gap-1.5 mb-1"><Brain className="h-3.5 w-3.5 text-purple-600" /><span className="text-xs font-semibold text-purple-800">Raciocínio</span></div>
              <p className="text-sm bg-purple-50 rounded p-2 border border-purple-100 italic">{entry.reasoning}</p>
            </div>
          )}
          {toolCalls.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1"><Wrench className="h-3.5 w-3.5 text-orange-600" /><span className="text-xs font-semibold text-orange-800">Tools Chamadas</span></div>
              <div className="space-y-2">
                {toolCalls.map((tc, idx) => (
                  <div key={idx} className="text-xs bg-white rounded p-2 border font-mono">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-orange-700">{idx + 1}. {tc.tool}</span>
                      <span className="text-muted-foreground">{formatDuration(tc.durationMs)}</span>
                    </div>
                    <p className="text-muted-foreground whitespace-pre-wrap break-all">→ {tc.result.substring(0, 200)}{tc.result.length > 200 && "..."}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          {entry.output && (
            <div>
              <span className="text-xs font-semibold text-green-800">📤 Output</span>
              <p className="text-sm bg-green-50 rounded p-2 border border-green-100 mt-1">{entry.output.substring(0, 300)}{entry.output.length > 300 && "..."}</p>
            </div>
          )}
          <div>
            <div className="flex items-center gap-1.5 mb-1"><BarChart3 className="h-3.5 w-3.5 text-gray-600" /><span className="text-xs font-semibold text-gray-800">Métricas</span></div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="outline" className="font-mono">{entry.inputTokens + entry.outputTokens} tokens</Badge>
              <Badge variant="outline" className="font-mono">{formatCost(Number(entry.costBrl))}</Badge>
              <Badge variant="outline" className="font-mono"><Clock className="mr-1 h-3 w-3" />{formatDuration(entry.durationMs)}</Badge>
              <Badge variant="outline" className="font-mono">{entry.provider}/{entry.model}</Badge>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function AiAuditPanel({ ticketId, companyId }: { ticketId: string; companyId: string }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<AuditTrailRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);

  const loadEntries = useCallback(async () => {
    if (loaded) return;
    setLoading(true);
    try { const data = await fetchAuditTrail(ticketId, companyId); setEntries(data); setLoaded(true); }
    catch { toast.error("Erro ao carregar audit trail"); }
    finally { setLoading(false); }
  }, [ticketId, companyId, loaded]);

  async function handleToggle(isOpen: boolean) { setOpen(isOpen); if (isOpen && !loaded) await loadEntries(); }

  async function handleExport(format: "csv" | "json") {
    setExporting(true);
    try {
      const data = await exportAuditTrail(ticketId, companyId, format);
      const blob = new Blob([data], { type: format === "csv" ? "text/csv" : "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = `audit-trail-${ticketId.slice(-8)}.${format}`; a.click();
      URL.revokeObjectURL(url);
      toast.success(`Audit trail exportado (${format.toUpperCase()})`);
    } catch { toast.error("Erro ao exportar"); } finally { setExporting(false); }
  }

  const totalCost = entries.reduce((s, e) => s + (typeof e.costBrl === "string" ? parseFloat(e.costBrl) : Number(e.costBrl)), 0);
  const totalTokens = entries.reduce((s, e) => s + e.inputTokens + e.outputTokens, 0);

  return (
    <Collapsible open={open} onOpenChange={handleToggle}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-muted-foreground hover:text-foreground">
          <span className="flex items-center gap-1.5">
            <Search className="h-3.5 w-3.5" />Por que a IA fez isso?
            {loaded && entries.length > 0 && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{entries.length}</Badge>}
          </span>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        {loading && <p className="text-xs text-muted-foreground text-center py-4">Carregando audit trail...</p>}
        {loaded && entries.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Nenhum registro de audit trail para este ticket.</p>}
        {loaded && entries.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-muted-foreground px-1">
              <span>{entries.length} iteraç{entries.length > 1 ? "ões" : "ão"} • {totalTokens.toLocaleString()} tokens • {formatCost(totalCost)}</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => handleExport("csv")} disabled={exporting}><Download className="h-3 w-3 mr-1" />CSV</Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => handleExport("json")} disabled={exporting}><Download className="h-3 w-3 mr-1" />JSON</Button>
              </div>
            </div>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {entries.map((e) => <AuditEntryCard key={e.id} entry={e} />)}
            </div>
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
