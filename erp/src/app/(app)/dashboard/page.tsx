"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  DollarSign,
  TrendingDown,
  TrendingUp,
  Calendar,
  FileText,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  getDashboardData,
  type DashboardData,
  type PeriodType,
} from "./actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatChartCurrency(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}k`;
  return `R$ ${value}`;
}

const PERIOD_OPTIONS: { value: PeriodType; label: string }[] = [
  { value: "day", label: "Hoje" },
  { value: "week", label: "Esta Semana" },
  { value: "month", label: "Este Mês" },
  { value: "year", label: "Este Ano" },
  { value: "custom", label: "Personalizado" },
];

// ---------------------------------------------------------------------------
// Chart tooltip
// ---------------------------------------------------------------------------

function ChartTooltipContent({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number; name: string; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-white p-3 shadow-md">
      <p className="mb-1 text-sm font-medium">{label}</p>
      {payload.map((entry, i) => (
        <p key={i} className="text-sm" style={{ color: entry.color }}>
          {entry.name}: {formatCurrency(entry.value)}
        </p>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodType>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const result = await getDashboardData({
        period,
        customStart: period === "custom" ? customStart : undefined,
        customEnd: period === "custom" ? customEnd : undefined,
      });
      setData(result);
    } catch {
      toast.error("Erro ao carregar dados do dashboard");
    } finally {
      setLoading(false);
    }
  }, [period, customStart, customEnd]);

  useEffect(() => {
    // For custom period, only load when both dates are set
    if (period === "custom" && (!customStart || !customEnd)) return;
    loadData();
  }, [loadData, period, customStart, customEnd]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          {data && (
            <p className="mt-1 text-sm text-muted-foreground">
              <Calendar className="mr-1 inline h-4 w-4" />
              {data.periodLabel}
            </p>
          )}
        </div>

        {/* Period filter */}
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label className="mb-1 block text-xs">Período</Label>
            <Select value={period} onValueChange={(v) => setPeriod(v as PeriodType)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIOD_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {period === "custom" && (
            <>
              <div>
                <Label className="mb-1 block text-xs">De</Label>
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="w-[150px]"
                />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Até</Label>
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="w-[150px]"
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="pb-2">
                <div className="h-4 w-24 rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-32 rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : data ? (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Receita Total
              </CardTitle>
              <TrendingUp className="h-5 w-5 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {formatCurrency(data.totalRevenue)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Dados placeholder
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Despesas Totais
              </CardTitle>
              <TrendingDown className="h-5 w-5 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {formatCurrency(data.totalExpenses)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Dados placeholder
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Lucro Total
              </CardTitle>
              <DollarSign className="h-5 w-5 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${
                  data.totalProfit >= 0 ? "text-blue-600" : "text-red-600"
                }`}
              >
                {formatCurrency(data.totalProfit)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Receita - Despesas
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Boleto Summary Cards */}
      {!loading && data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Boletos Emitidos
              </CardTitle>
              <FileText className="h-5 w-5 text-gray-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.boletoSummary.emitted}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                Dados placeholder
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Boletos Pagos
              </CardTitle>
              <CheckCircle className="h-5 w-5 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {data.boletoSummary.paid}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Dados placeholder
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Boletos Vencidos
              </CardTitle>
              <AlertTriangle className="h-5 w-5 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {data.boletoSummary.overdue}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Dados placeholder
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Revenue Comparison Chart */}
      {!loading && data && data.revenueChart.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Comparativo de Receita por Empresa</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.revenueChart}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="companyName"
                    tick={{ fontSize: 12 }}
                    interval={0}
                    angle={data.revenueChart.length > 4 ? -20 : 0}
                    textAnchor={data.revenueChart.length > 4 ? "end" : "middle"}
                    height={data.revenueChart.length > 4 ? 60 : 30}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={formatChartCurrency}
                  />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Legend />
                  <Bar dataKey="revenue" name="Receita" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="expenses" name="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="profit" name="Lucro" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Per-company breakdown table */}
      {!loading && data && data.companies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Métricas por Empresa</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empresa</TableHead>
                    <TableHead className="text-right">Receita</TableHead>
                    <TableHead className="text-right">Despesas</TableHead>
                    <TableHead className="text-right">Lucro</TableHead>
                    <TableHead className="text-right">Margem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.companies.map((company) => {
                    const margin =
                      company.revenue > 0
                        ? ((company.profit / company.revenue) * 100).toFixed(1)
                        : "0.0";
                    return (
                      <TableRow key={company.companyId}>
                        <TableCell className="font-medium">
                          {company.companyName}
                        </TableCell>
                        <TableCell className="text-right text-green-600">
                          {formatCurrency(company.revenue)}
                        </TableCell>
                        <TableCell className="text-right text-red-600">
                          {formatCurrency(company.expenses)}
                        </TableCell>
                        <TableCell
                          className={`text-right font-medium ${
                            company.profit >= 0
                              ? "text-blue-600"
                              : "text-red-600"
                          }`}
                        >
                          {formatCurrency(company.profit)}
                        </TableCell>
                        <TableCell className="text-right">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                              parseFloat(margin) >= 0
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {margin}%
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {/* Totals row */}
                  {data.companies.length > 1 && (
                    <TableRow className="border-t-2 font-bold">
                      <TableCell>Total Consolidado</TableCell>
                      <TableCell className="text-right text-green-600">
                        {formatCurrency(data.totalRevenue)}
                      </TableCell>
                      <TableCell className="text-right text-red-600">
                        {formatCurrency(data.totalExpenses)}
                      </TableCell>
                      <TableCell
                        className={`text-right ${
                          data.totalProfit >= 0
                            ? "text-blue-600"
                            : "text-red-600"
                        }`}
                      >
                        {formatCurrency(data.totalProfit)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            data.totalRevenue > 0 &&
                            data.totalProfit / data.totalRevenue >= 0
                              ? "bg-green-100 text-green-700"
                              : "bg-red-100 text-red-700"
                          }`}
                        >
                          {data.totalRevenue > 0
                            ? (
                                (data.totalProfit / data.totalRevenue) *
                                100
                              ).toFixed(1)
                            : "0.0"}
                          %
                        </span>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && data && data.companies.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nenhuma empresa encontrada. Verifique suas permissões ou cadastre empresas.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
