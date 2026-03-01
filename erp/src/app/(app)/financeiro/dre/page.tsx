"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Building2, FileText } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCompany } from "@/contexts/company-context";
import {
  getDREData,
  getDREConsolidated,
  getCompaniesForDRE,
  type DREData,
  type DREConsolidatedReport,
  type DREPeriodType,
  type DREPerCompany,
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

function getCurrentYear(): number {
  return new Date().getFullYear();
}

function getCurrentMonth(): number {
  return new Date().getMonth() + 1;
}

function getCurrentQuarter(): number {
  return Math.ceil((new Date().getMonth() + 1) / 3);
}

// ---------------------------------------------------------------------------
// DRE Table Component
// ---------------------------------------------------------------------------

interface DRETableProps {
  data: DREData;
  title?: string;
}

function DRETable({ data, title }: DRETableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <FileText className="h-5 w-5" />
          {title ?? "Demonstração do Resultado do Exercício (DRE)"}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {data.companyName
            ? `${data.companyName} — ${data.periodLabel}`
            : `Consolidado — ${data.periodLabel}`}
        </p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60%]">Descrição</TableHead>
              <TableHead className="text-right">Valor (R$)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {/* Gross Revenue */}
            <TableRow>
              <TableCell className="font-medium">
                (+) Receita Bruta de Serviços
              </TableCell>
              <TableCell
                className={`text-right font-medium ${
                  data.grossRevenue > 0 ? "text-green-700" : ""
                }`}
              >
                {formatCurrency(data.grossRevenue)}
              </TableCell>
            </TableRow>

            {/* Deductions */}
            <TableRow>
              <TableCell className="pl-8 text-muted-foreground">
                (-) Deduções sobre Receita
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatCurrency(data.deductions)}
              </TableCell>
            </TableRow>

            {/* Net Revenue */}
            <TableRow className="border-t-2 bg-muted/30">
              <TableCell className="font-semibold">
                (=) Receita Líquida
              </TableCell>
              <TableCell className="text-right font-semibold">
                {formatCurrency(data.netRevenue)}
              </TableCell>
            </TableRow>

            {/* Cost of Services */}
            <TableRow>
              <TableCell className="pl-8 text-muted-foreground">
                (-) Custos dos Serviços Prestados
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatCurrency(data.costOfServices)}
              </TableCell>
            </TableRow>

            {/* Gross Profit */}
            <TableRow className="border-t-2 bg-muted/30">
              <TableCell className="font-semibold">
                (=) Lucro Bruto
              </TableCell>
              <TableCell className="text-right font-semibold">
                {formatCurrency(data.grossProfit)}
              </TableCell>
            </TableRow>

            {/* Operating Expenses Header */}
            <TableRow>
              <TableCell className="font-medium">
                (-) Despesas Operacionais
              </TableCell>
              <TableCell className="text-right font-medium text-red-700">
                {formatCurrency(data.operatingExpenses)}
              </TableCell>
            </TableRow>

            {/* Expense categories breakdown */}
            {data.expensesByCategory.map((cat) => (
              <TableRow key={cat.category}>
                <TableCell className="pl-12 text-sm text-muted-foreground">
                  {cat.category}
                </TableCell>
                <TableCell className="text-right text-sm text-muted-foreground">
                  {formatCurrency(cat.value)}
                </TableCell>
              </TableRow>
            ))}

            {/* Operating Result */}
            <TableRow className="border-t-2 bg-muted/50">
              <TableCell className="text-base font-bold">
                (=) Resultado Operacional
              </TableCell>
              <TableCell
                className={`text-right text-base font-bold ${
                  data.operatingResult >= 0 ? "text-green-700" : "text-red-700"
                }`}
              >
                {formatCurrency(data.operatingResult)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>

        {(data.deductions === 0 || data.costOfServices === 0) && (
          <p className="mt-4 text-xs text-muted-foreground">
            * Deduções sobre receita e custos dos serviços serão preenchidos
            quando o módulo fiscal estiver implementado.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Per-Company Comparison Table
// ---------------------------------------------------------------------------

function CompanyComparisonTable({
  companies,
  periodLabel,
}: {
  companies: DREPerCompany[];
  periodLabel: string;
}) {
  if (companies.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          Comparativo por Empresa — {periodLabel}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[180px]">Empresa</TableHead>
                <TableHead className="text-right">Receita Bruta</TableHead>
                <TableHead className="text-right">Receita Líquida</TableHead>
                <TableHead className="text-right">Lucro Bruto</TableHead>
                <TableHead className="text-right">Despesas</TableHead>
                <TableHead className="text-right">Resultado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {companies.map((c) => (
                <TableRow key={c.companyId}>
                  <TableCell className="font-medium">
                    {c.companyName}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(c.grossRevenue)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(c.netRevenue)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(c.grossProfit)}
                  </TableCell>
                  <TableCell className="text-right text-red-700">
                    {formatCurrency(c.operatingExpenses)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-semibold ${
                      c.operatingResult >= 0
                        ? "text-green-700"
                        : "text-red-700"
                    }`}
                  >
                    {formatCurrency(c.operatingResult)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function DREPage() {
  const { selectedCompanyId } = useCompany();
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"company" | "consolidated">(
    "company"
  );
  const [periodType, setPeriodType] = useState<DREPeriodType>("monthly");
  const [year, setYear] = useState(getCurrentYear());
  const [month, setMonth] = useState(getCurrentMonth());
  const [quarter, setQuarter] = useState(getCurrentQuarter());
  const [companies, setCompanies] = useState<
    { id: string; nomeFantasia: string }[]
  >([]);

  // Data
  const [dreData, setDreData] = useState<DREData | null>(null);
  const [consolidatedReport, setConsolidatedReport] =
    useState<DREConsolidatedReport | null>(null);

  // Load available companies
  useEffect(() => {
    getCompaniesForDRE()
      .then(setCompanies)
      .catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    if (viewMode === "company" && !selectedCompanyId) return;

    const period =
      periodType === "monthly"
        ? month
        : periodType === "quarterly"
          ? quarter
          : undefined;

    try {
      setLoading(true);

      if (viewMode === "consolidated") {
        const report = await getDREConsolidated({
          periodType,
          year,
          period,
        });
        setConsolidatedReport(report);
        setDreData(null);
      } else {
        const data = await getDREData({
          companyId: selectedCompanyId!,
          periodType,
          year,
          period,
        });
        setDreData(data);
        setConsolidatedReport(null);
      }
    } catch {
      toast.error("Erro ao carregar DRE");
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, viewMode, periodType, year, month, quarter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const showConsolidatedToggle = companies.length > 1;

  // Generate year options (current year +/- 5)
  const currentYear = getCurrentYear();
  const yearOptions = Array.from({ length: 11 }, (_, i) => currentYear - 5 + i);

  const monthOptions = [
    { value: 1, label: "Janeiro" },
    { value: 2, label: "Fevereiro" },
    { value: 3, label: "Março" },
    { value: 4, label: "Abril" },
    { value: 5, label: "Maio" },
    { value: 6, label: "Junho" },
    { value: 7, label: "Julho" },
    { value: 8, label: "Agosto" },
    { value: 9, label: "Setembro" },
    { value: 10, label: "Outubro" },
    { value: 11, label: "Novembro" },
    { value: 12, label: "Dezembro" },
  ];

  const quarterOptions = [
    { value: 1, label: "1º Trimestre (Jan-Mar)" },
    { value: 2, label: "2º Trimestre (Abr-Jun)" },
    { value: 3, label: "3º Trimestre (Jul-Set)" },
    { value: 4, label: "4º Trimestre (Out-Dez)" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">DRE</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Demonstração do Resultado do Exercício
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          {showConsolidatedToggle && (
            <div>
              <Label className="mb-1 block text-xs">Visão</Label>
              <Select
                value={viewMode}
                onValueChange={(v) =>
                  setViewMode(v as "company" | "consolidated")
                }
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
            <Label className="mb-1 block text-xs">Período</Label>
            <Select
              value={periodType}
              onValueChange={(v) => setPeriodType(v as DREPeriodType)}
            >
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Mensal</SelectItem>
                <SelectItem value="quarterly">Trimestral</SelectItem>
                <SelectItem value="annual">Anual</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="mb-1 block text-xs">Ano</Label>
            <Select
              value={String(year)}
              onValueChange={(v) => setYear(parseInt(v))}
            >
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {periodType === "monthly" && (
            <div>
              <Label className="mb-1 block text-xs">Mês</Label>
              <Select
                value={String(month)}
                onValueChange={(v) => setMonth(parseInt(v))}
              >
                <SelectTrigger className="w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((m) => (
                    <SelectItem key={m.value} value={String(m.value)}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {periodType === "quarterly" && (
            <div>
              <Label className="mb-1 block text-xs">Trimestre</Label>
              <Select
                value={String(quarter)}
                onValueChange={(v) => setQuarter(parseInt(v))}
              >
                <SelectTrigger className="w-[210px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {quarterOptions.map((q) => (
                    <SelectItem key={q.value} value={String(q.value)}>
                      {q.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* No company selected */}
      {viewMode === "company" && !selectedCompanyId && (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <Building2 className="mx-auto mb-2 h-8 w-8" />
            Selecione uma empresa no menu superior para visualizar o DRE.
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {loading && (viewMode === "consolidated" || selectedCompanyId) && (
        <Card className="animate-pulse">
          <CardHeader>
            <div className="h-6 w-48 rounded bg-muted" />
          </CardHeader>
          <CardContent className="space-y-3">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="flex justify-between">
                <div className="h-4 w-60 rounded bg-muted" />
                <div className="h-4 w-24 rounded bg-muted" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Company view */}
      {!loading && viewMode === "company" && dreData && (
        <DRETable data={dreData} />
      )}

      {/* Consolidated view */}
      {!loading && viewMode === "consolidated" && consolidatedReport && (
        <>
          <DRETable
            data={consolidatedReport.consolidated}
            title="DRE Consolidado (Grupo)"
          />
          <CompanyComparisonTable
            companies={consolidatedReport.perCompany}
            periodLabel={consolidatedReport.periodLabel}
          />
        </>
      )}

      {/* Empty state */}
      {!loading &&
        ((viewMode === "company" && dreData && dreData.grossRevenue === 0 && dreData.operatingExpenses === 0) ||
          (viewMode === "consolidated" && consolidatedReport && consolidatedReport.consolidated.grossRevenue === 0 && consolidatedReport.consolidated.operatingExpenses === 0)) && (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma movimentação financeira encontrada para o período
              selecionado. Os valores do DRE serão populados conforme contas a
              receber e a pagar forem quitadas.
            </CardContent>
          </Card>
        )}
    </div>
  );
}
