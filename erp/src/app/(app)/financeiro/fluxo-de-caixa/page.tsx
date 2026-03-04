"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wallet,
  Building2,
} from "lucide-react";
import {
  LazyBarChart as BarChart,
  LazyBar as Bar,
  LazyLineChart as LineChart,
  LazyLine as Line,
  LazyXAxis as XAxis,
  LazyYAxis as YAxis,
  LazyCartesianGrid as CartesianGrid,
  LazyTooltip as Tooltip,
  LazyLegend as Legend,
  LazyResponsiveContainer as ResponsiveContainer,
} from "@/components/charts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/company-context";
import {
  getCashFlowData,
  getCompaniesForCashFlow,
  type CashFlowSummary,
  type PeriodGrouping,
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
  if (Math.abs(value) >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `R$ ${(value / 1_000).toFixed(0)}k`;
  return `R$ ${value}`;
}

function getDefaultDateRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 3, 0); // 3 months ahead
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Chart Tooltip
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

export default function CashFlowPage() {
  const { selectedCompanyId } = useCompany();
  const [data, setData] = useState<CashFlowSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [grouping, setGrouping] = useState<PeriodGrouping>("monthly");
  const [viewMode, setViewMode] = useState<"company" | "consolidated">("company");
  const [companies, setCompanies] = useState<{ id: string; nomeFantasia: string }[]>([]);

  const defaultRange = getDefaultDateRange();
  const [dateFrom, setDateFrom] = useState(defaultRange.from);
  const [dateTo, setDateTo] = useState(defaultRange.to);

  // Load available companies for consolidated view toggle
  useEffect(() => {
    getCompaniesForCashFlow()
      .then(setCompanies)
      .catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    if (!dateFrom || !dateTo) return;
    if (viewMode === "company" && !selectedCompanyId) return;

    try {
      setLoading(true);
      const result = await getCashFlowData({
        companyId: viewMode === "company" ? selectedCompanyId! : undefined,
        grouping,
        dateFrom,
        dateTo,
      });
      setData(result);
    } catch {
      toast.error("Erro ao carregar dados do fluxo de caixa");
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, grouping, dateFrom, dateTo, viewMode]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showConsolidatedToggle = companies.length > 1;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Fluxo de Caixa</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {viewMode === "consolidated"
              ? "Visão consolidada (holding)"
              : data?.companyName
                ? `Empresa: ${data.companyName}`
                : "Selecione uma empresa"}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          {showConsolidatedToggle && (
            <div>
              <Label className="mb-1 block text-xs">Visão</Label>
              <Select
                value={viewMode}
                onValueChange={(v) => setViewMode(v as "company" | "consolidated")}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">Por Empresa</SelectItem>
                  <SelectItem value="consolidated">Consolidado</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div>
            <Label className="mb-1 block text-xs">Agrupamento</Label>
            <Select
              value={grouping}
              onValueChange={(v) => setGrouping(v as PeriodGrouping)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Diário</SelectItem>
                <SelectItem value="weekly">Semanal</SelectItem>
                <SelectItem value="monthly">Mensal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-1 block text-xs">De</Label>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-[150px]"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs">Até</Label>
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-[150px]"
            />
          </div>
        </div>
      </div>

      {/* No company selected */}
      {viewMode === "company" && !selectedCompanyId && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Building2 className="mx-auto mb-2 h-8 w-8" />
            Selecione uma empresa no menu superior para visualizar o fluxo de caixa.
          </CardContent>
        </Card>
      )}

      {/* KPI Cards */}
      {loading && (viewMode === "consolidated" || selectedCompanyId) ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
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
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Saldo Atual
              </CardTitle>
              <Wallet className="h-5 w-5 text-blue-500" />
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${
                  data.currentBalance >= 0 ? "text-blue-600" : "text-red-600"
                }`}
              >
                {formatCurrency(data.currentBalance)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Baseado em itens pagos
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Saldo Projetado
              </CardTitle>
              <DollarSign className="h-5 w-5 text-purple-500" />
            </CardHeader>
            <CardContent>
              <div
                className={`text-2xl font-bold ${
                  data.projectedBalance >= 0
                    ? "text-purple-600"
                    : "text-red-600"
                }`}
              >
                {formatCurrency(data.projectedBalance)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Inclui pendentes
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Receitas
              </CardTitle>
              <TrendingUp className="h-5 w-5 text-green-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {formatCurrency(data.totalIncome)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                No período selecionado
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Despesas
              </CardTitle>
              <TrendingDown className="h-5 w-5 text-red-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">
                {formatCurrency(data.totalExpenses)}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                No período selecionado
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Cash Flow Chart */}
      {!loading && data && data.entries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Receitas vs Despesas
              {viewMode === "consolidated" && " (Consolidado)"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.entries}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 12 }}
                    interval={data.entries.length > 15 ? Math.floor(data.entries.length / 10) : 0}
                    angle={data.entries.length > 8 ? -20 : 0}
                    textAnchor={data.entries.length > 8 ? "end" : "middle"}
                    height={data.entries.length > 8 ? 60 : 30}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={formatChartCurrency}
                  />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Legend />
                  <Bar
                    dataKey="income"
                    name="Receitas"
                    fill="#22c55e"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="expenses"
                    name="Despesas"
                    fill="#ef4444"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Net Cash Flow Line Chart */}
      {!loading && data && data.entries.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Fluxo Líquido (Projeção)
              {viewMode === "consolidated" && " (Consolidado)"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={data.entries}
                  margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 12 }}
                    interval={data.entries.length > 15 ? Math.floor(data.entries.length / 10) : 0}
                    angle={data.entries.length > 8 ? -20 : 0}
                    textAnchor={data.entries.length > 8 ? "end" : "middle"}
                    height={data.entries.length > 8 ? 60 : 30}
                  />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={formatChartCurrency}
                  />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="net"
                    name="Fluxo Líquido"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={{ fill: "#3b82f6", r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {!loading && data && data.entries.length === 0 && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Nenhum dado financeiro encontrado para o período selecionado.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
