
"use client";
import { useEffect, useState, useCallback } from "react";
import { useCompany } from "@/contexts/company-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { ThumbsUp, ThumbsDown, Edit3, TrendingUp, AlertTriangle, BarChart3, Loader2 } from "lucide-react";
import { getFeedbackSummary, getRejectReasons, getEditPatterns, getConfidenceCalibration, type FeedbackSummary, type RejectReason, type EditPattern, type ConfidenceCalibration } from "./actions";

function getPeriodDates(p: string) { const now = new Date(); const d = p === "7d" ? 7 : p === "90d" ? 90 : 30; return { from: new Date(now.getTime() - d * 864e5).toISOString(), to: now.toISOString() }; }
const COLORS = ["#22c55e","#f59e0b","#ef4444","#6366f1","#8b5cf6","#ec4899"];
const TC: Record<string,string> = { positive: "#22c55e", correction: "#f59e0b", negative: "#ef4444" };

export default function FeedbackPage() {
  const { selectedCompany } = useCompany();
  const cid = selectedCompany?.id;
  const [period, setPeriod] = useState("30d");
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<FeedbackSummary|null>(null);
  const [reasons, setReasons] = useState<RejectReason[]>([]);
  const [edits, setEdits] = useState<EditPattern|null>(null);
  const [cal, setCal] = useState<ConfidenceCalibration[]>([]);
  const load = useCallback(async () => {
    if (!cid) return; setLoading(true);
    try { const { from, to } = getPeriodDates(period); const [s,r,e,c] = await Promise.all([getFeedbackSummary(cid,from,to), getRejectReasons(cid,from,to), getEditPatterns(cid,from,to), getConfidenceCalibration(cid,from,to)]); setSummary(s); setReasons(r); setEdits(e); setCal(c); } catch { /* error handled by UI state */ } finally { setLoading(false); }
  }, [cid, period]);
  useEffect(() => { load(); }, [load]);
  if (!cid) return <div className="flex items-center justify-center py-12 text-muted-foreground">Selecione uma empresa.</div>;
  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const pie = summary ? [{ name:"Aprovadas", value:summary.positive, color:TC.positive },{ name:"Editadas", value:summary.correction, color:TC.correction },{ name:"Rejeitadas", value:summary.negative, color:TC.negative }].filter(d=>d.value>0) : [];
  return (<div className="space-y-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold tracking-tight">🔄 Feedback Loop</h1><p className="text-muted-foreground">Análise de aprovações, edições e rejeições das sugestões de IA</p></div><Select value={period} onValueChange={setPeriod}><SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="7d">7 dias</SelectItem><SelectItem value="30d">30 dias</SelectItem><SelectItem value="90d">90 dias</SelectItem></SelectContent></Select></div>
    {summary && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"><Kpi title="Total" value={summary.total} icon={<BarChart3 className="h-4 w-4"/>}/><Kpi title="Aprovação" value={`${(summary.approvalRate*100).toFixed(1)}%`} icon={<ThumbsUp className="h-4 w-4 text-green-500"/>} sub={`${summary.positive} aprovadas`}/><Kpi title="Edição" value={`${(summary.editRate*100).toFixed(1)}%`} icon={<Edit3 className="h-4 w-4 text-amber-500"/>} sub={`${summary.correction} editadas`}/><Kpi title="Rejeição" value={`${(summary.rejectionRate*100).toFixed(1)}%`} icon={<ThumbsDown className="h-4 w-4 text-red-500"/>} sub={`${summary.negative} rejeitadas`}/></div>}
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card><CardHeader><CardTitle className="text-base">Distribuição</CardTitle><CardDescription>Proporção de aprovações, edições e rejeições</CardDescription></CardHeader><CardContent>{pie.length>0 ? <ResponsiveContainer width="100%" height={260}><PieChart><Pie data={pie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({name,percent}:{name?:string;percent?:number})=>`${name} ${((percent??0)*100).toFixed(0)}%`}>{pie.map((e,i)=><Cell key={i} fill={e.color}/>)}</Pie><Legend/><Tooltip/></PieChart></ResponsiveContainer> : <p className="py-8 text-center text-muted-foreground">Sem dados</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle className="text-base"><TrendingUp className="mr-2 inline h-4 w-4"/>Calibração de Confiança</CardTitle><CardDescription>Taxa aprovação real vs confiança IA</CardDescription></CardHeader><CardContent>{cal.some(b=>b.total>0) ? <ResponsiveContainer width="100%" height={260}><BarChart data={cal}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="bucket" fontSize={12}/><YAxis tickFormatter={(v:number)=>`${(v*100).toFixed(0)}%`} domain={[0,1]} fontSize={12}/><Tooltip formatter={(v)=>`${(Number(v)*100).toFixed(1)}%`}/><Bar dataKey="approvalRate" name="Taxa Aprovação" fill="#22c55e" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer> : <p className="py-8 text-center text-muted-foreground">Sem dados</p>}</CardContent></Card>
    </div>
    <Card><CardHeader><CardTitle className="text-base"><AlertTriangle className="mr-2 inline h-4 w-4 text-red-500"/>Top Motivos de Rejeição</CardTitle></CardHeader><CardContent>{reasons.length>0 ? <div className="space-y-3">{reasons.slice(0,10).map((r,i)=><div key={i} className="flex items-start justify-between rounded-lg border p-3"><div className="space-y-1"><p className="text-sm font-medium">{r.reason}</p>{r.category && <Badge variant="outline" className="text-xs">{r.category}</Badge>}</div><Badge variant="secondary">{r.count}x</Badge></div>)}</div> : <p className="py-4 text-center text-muted-foreground">Nenhuma rejeição</p>}</CardContent></Card>
    {edits && edits.totalEdits>0 && <Card><CardHeader><CardTitle className="text-base"><Edit3 className="mr-2 inline h-4 w-4 text-amber-500"/>Padrões de Edição</CardTitle></CardHeader><CardContent><div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-4"><MS l="Total" v={edits.totalEdits}/><MS l="Mudança Média" v={`${edits.avgChangePercent.toFixed(1)}%`}/><MS l="Menores" v={edits.minorEdits}/><MS l="Maiores" v={edits.majorEdits}/></div>{edits.topChanges.length>0 && <div className="space-y-2"><p className="text-sm font-medium text-muted-foreground">Edições mais significativas:</p>{edits.topChanges.map((c,i)=><div key={i} className="rounded border p-2 text-xs"><div className="text-red-600 line-through">{c.originalSnippet}...</div><div className="text-green-600">{c.editedSnippet}...</div><span className="text-muted-foreground">({c.changePercent.toFixed(1)}%)</span></div>)}</div>}</CardContent></Card>}
    {summary && summary.byCategory.length>0 && <Card><CardHeader><CardTitle className="text-base">Categorias de Erro</CardTitle></CardHeader><CardContent><ResponsiveContainer width="100%" height={300}><BarChart data={summary.byCategory.slice(0,8)} layout="vertical"><CartesianGrid strokeDasharray="3 3"/><XAxis type="number" fontSize={12}/><YAxis type="category" dataKey="category" width={150} fontSize={12}/><Tooltip/><Bar dataKey="count" name="Ocorrências" fill="#6366f1" radius={[0,4,4,0]}>{summary.byCategory.slice(0,8).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Bar></BarChart></ResponsiveContainer></CardContent></Card>}
  </div>);
}
function Kpi({title,value,icon,sub}:{title:string;value:string|number;icon:React.ReactNode;sub?:string}) { return <Card><CardContent className="pt-6"><div className="flex items-center justify-between"><div><p className="text-sm text-muted-foreground">{title}</p><p className="text-2xl font-bold">{value}</p>{sub && <p className="text-xs text-muted-foreground">{sub}</p>}</div><div className="rounded-full bg-muted p-2">{icon}</div></div></CardContent></Card>; }
function MS({l,v}:{l:string;v:string|number}) { return <div className="rounded-lg border p-3 text-center"><p className="text-lg font-bold">{v}</p><p className="text-xs text-muted-foreground">{l}</p></div>; }
