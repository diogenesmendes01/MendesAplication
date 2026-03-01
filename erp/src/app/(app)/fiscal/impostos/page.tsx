"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
  Building2,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCompany } from "@/contexts/company-context";
import {
  getTaxDashboardData,
  markTaxEntryAsPaid,
  type TaxDashboardData,
  type TaxEntryRow,
  type CompanyTaxSummary,
} from "./actions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const currencyFmt = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function taxTypeLabel(type: string) {
  const labels: Record<string, string> = {
    ISS: "ISS",
    PIS: "PIS",
    COFINS: "COFINS",
    IRPJ: "IRPJ",
    CSLL: "CSLL",
  };
  return labels[type] ?? type;
}

function taxTypeColor(type: string) {
  const colors: Record<string, string> = {
    ISS: "bg-blue-100 text-blue-800",
    PIS: "bg-purple-100 text-purple-800",
    COFINS: "bg-orange-100 text-orange-800",
    IRPJ: "bg-green-100 text-green-800",
    CSLL: "bg-pink-100 text-pink-800",
  };
  return colors[type] ?? "bg-gray-100 text-gray-800";
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function AlertBanner({
  upcomingCount,
  overdueCount,
}: {
  upcomingCount: number;
  overdueCount: number;
}) {
  if (upcomingCount === 0 && overdueCount === 0) return null;

  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {overdueCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>
            <strong>{overdueCount}</strong> imposto(s) em atraso
          </span>
        </div>
      )}
      {upcomingCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">
          <Clock className="h-4 w-4 flex-shrink-0" />
          <span>
            <strong>{upcomingCount}</strong> imposto(s) vencendo nos próximos 7 dias
          </span>
        </div>
      )}
    </div>
  );
}

function TaxOverviewCards({
  data,
}: {
  data: TaxDashboardData["consolidated"];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Base de Cálculo (NFs Emitidas)
          </CardTitle>
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {currencyFmt.format(data.totalInvoiceValue)}
          </div>
          <p className="text-xs text-muted-foreground">
            Período atual
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Total de Impostos
          </CardTitle>
          <DollarSign className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {currencyFmt.format(data.totalTaxes)}
          </div>
          <p className="text-xs text-muted-foreground">
            Calculado sobre NFs emitidas
          </p>
        </CardContent>
      </Card>

      <Card className="sm:col-span-2 lg:col-span-1">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Carga Tributária
          </CardTitle>
          <Building2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">
            {data.totalInvoiceValue > 0
              ? `${((data.totalTaxes / data.totalInvoiceValue) * 100).toFixed(1)}%`
              : "0%"}
          </div>
          <p className="text-xs text-muted-foreground">
            Percentual sobre faturamento
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function TaxBreakdownTable({
  taxes,
  title,
}: {
  taxes: TaxDashboardData["consolidated"]["taxBreakdown"];
  title: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Imposto</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="text-right">Alíquota</TableHead>
              <TableHead className="text-right">Base de Cálculo</TableHead>
              <TableHead className="text-right">Valor Calculado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {taxes.map((tax) => (
              <TableRow key={tax.type}>
                <TableCell>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${taxTypeColor(tax.type)}`}
                  >
                    {tax.label}
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {tax.description}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {tax.rate.toFixed(2)}%
                </TableCell>
                <TableCell className="text-right font-mono">
                  {currencyFmt.format(tax.baseValue)}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold">
                  {currencyFmt.format(tax.calculatedValue)}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="font-bold">
              <TableCell colSpan={4}>Total</TableCell>
              <TableCell className="text-right font-mono">
                {currencyFmt.format(
                  taxes.reduce((sum, t) => sum + t.calculatedValue, 0)
                )}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function CompanyTaxCard({
  company,
}: {
  company: CompanyTaxSummary;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{company.companyName}</CardTitle>
          <span className="text-xs text-muted-foreground">{company.cnpj}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">NFs Emitidas</p>
            <p className="text-lg font-bold">
              {currencyFmt.format(company.totalInvoiceValue)}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Impostos</p>
            <p className="text-lg font-bold">
              {currencyFmt.format(company.totalTaxes)}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          {company.taxes.map((tax) => (
            <div
              key={tax.type}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${taxTypeColor(tax.type)}`}
                >
                  {tax.label}
                </span>
                <span className="text-muted-foreground">
                  {tax.rate.toFixed(2)}%
                </span>
              </div>
              <span className="font-mono font-medium">
                {currencyFmt.format(tax.calculatedValue)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function TaxEntriesTable({
  entries,
  title,
  variant,
  onMarkPaid,
}: {
  entries: TaxEntryRow[];
  title: string;
  variant: "upcoming" | "overdue";
  onMarkPaid: (entryId: string, companyId: string) => void;
}) {
  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {variant === "overdue"
              ? "Nenhum imposto em atraso."
              : "Nenhum imposto vencendo nos próximos 7 dias."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          <Badge variant={variant === "overdue" ? "destructive" : "secondary"}>
            {entries.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Imposto</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Período</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Vencimento</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow
                key={entry.id}
                className={
                  variant === "overdue"
                    ? "bg-red-50"
                    : "bg-yellow-50"
                }
              >
                <TableCell>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${taxTypeColor(entry.type)}`}
                  >
                    {taxTypeLabel(entry.type)}
                  </span>
                </TableCell>
                <TableCell>{entry.companyName}</TableCell>
                <TableCell>{entry.period}</TableCell>
                <TableCell className="text-right font-mono">
                  {currencyFmt.format(parseFloat(entry.value))}
                </TableCell>
                <TableCell>
                  <span
                    className={
                      variant === "overdue"
                        ? "font-semibold text-red-600"
                        : "font-semibold text-yellow-600"
                    }
                  >
                    {dateFmt.format(new Date(entry.dueDate))}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onMarkPaid(entry.id, entry.companyId)}
                  >
                    <CheckCircle className="mr-1 h-4 w-4" />
                    Pagar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ImpostosPage() {
  const { selectedCompanyId } = useCompany();

  const [data, setData] = useState<TaxDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("consolidated");

  // Pay confirmation
  const [payDialogOpen, setPayDialogOpen] = useState(false);
  const [payingEntry, setPayingEntry] = useState<{
    id: string;
    companyId: string;
  } | null>(null);
  const [paying, setPaying] = useState(false);

  // ---------------------------------------------------
  // Load data
  // ---------------------------------------------------

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getTaxDashboardData();
      setData(result);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar dados fiscais"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ---------------------------------------------------
  // Mark as paid
  // ---------------------------------------------------

  function handlePayClick(entryId: string, companyId: string) {
    setPayingEntry({ id: entryId, companyId });
    setPayDialogOpen(true);
  }

  async function handleConfirmPay() {
    if (!payingEntry) return;
    setPaying(true);
    try {
      await markTaxEntryAsPaid(payingEntry.id, payingEntry.companyId);
      toast.success("Imposto marcado como pago");
      setPayDialogOpen(false);
      setPayingEntry(null);
      await loadData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao marcar como pago"
      );
    } finally {
      setPaying(false);
    }
  }

  // ---------------------------------------------------
  // Filter for selected company or show all
  // ---------------------------------------------------

  const filteredCompanies = selectedCompanyId
    ? data?.companies.filter((c) => c.companyId === selectedCompanyId) ?? []
    : data?.companies ?? [];

  const displayConsolidated = selectedCompanyId
    ? (() => {
        const company = filteredCompanies[0];
        if (!company) {
          return {
            totalInvoiceValue: 0,
            totalTaxes: 0,
            taxBreakdown: data?.consolidated.taxBreakdown.map((t) => ({
              ...t,
              baseValue: 0,
              calculatedValue: 0,
            })) ?? [],
          };
        }
        return {
          totalInvoiceValue: company.totalInvoiceValue,
          totalTaxes: company.totalTaxes,
          taxBreakdown: company.taxes,
        };
      })()
    : data?.consolidated ?? {
        totalInvoiceValue: 0,
        totalTaxes: 0,
        taxBreakdown: [],
      };

  const filteredUpcoming = selectedCompanyId
    ? data?.upcomingEntries.filter((e) => e.companyId === selectedCompanyId) ?? []
    : data?.upcomingEntries ?? [];

  const filteredOverdue = selectedCompanyId
    ? data?.overdueEntries.filter((e) => e.companyId === selectedCompanyId) ?? []
    : data?.overdueEntries ?? [];

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Carregando dados fiscais...
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Erro ao carregar dados. Tente novamente.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          Painel de Impostos
        </h1>
        <p className="text-sm text-muted-foreground">
          {selectedCompanyId
            ? "Visão dos impostos da empresa selecionada"
            : "Visão consolidada dos impostos de todas as empresas"}
        </p>
      </div>

      {/* Alert banner */}
      <AlertBanner
        upcomingCount={filteredUpcoming.length}
        overdueCount={filteredOverdue.length}
      />

      {/* Overview cards */}
      <TaxOverviewCards data={displayConsolidated} />

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="consolidated">Detalhamento</TabsTrigger>
          <TabsTrigger value="companies">Por Empresa</TabsTrigger>
          <TabsTrigger value="entries">Lançamentos</TabsTrigger>
        </TabsList>

        {/* Consolidated tab */}
        <TabsContent value="consolidated" className="space-y-6">
          <TaxBreakdownTable
            taxes={displayConsolidated.taxBreakdown}
            title={
              selectedCompanyId
                ? "Detalhamento de Impostos — Empresa Selecionada"
                : "Detalhamento Consolidado de Impostos"
            }
          />
        </TabsContent>

        {/* Per-company tab */}
        <TabsContent value="companies" className="space-y-6">
          {filteredCompanies.length === 0 ? (
            <Card>
              <CardContent className="flex h-24 items-center justify-center text-muted-foreground">
                Nenhuma empresa encontrada.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredCompanies.map((company) => (
                <CompanyTaxCard key={company.companyId} company={company} />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Entries tab */}
        <TabsContent value="entries" className="space-y-6">
          <TaxEntriesTable
            entries={filteredOverdue}
            title="Impostos em Atraso"
            variant="overdue"
            onMarkPaid={handlePayClick}
          />
          <TaxEntriesTable
            entries={filteredUpcoming}
            title="Vencendo nos Próximos 7 Dias"
            variant="upcoming"
            onMarkPaid={handlePayClick}
          />
        </TabsContent>
      </Tabs>

      {/* Pay Confirmation Dialog */}
      <Dialog
        open={payDialogOpen}
        onOpenChange={(open) => {
          setPayDialogOpen(open);
          if (!open) setPayingEntry(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Pagamento</DialogTitle>
            <DialogDescription>
              Deseja marcar este imposto como pago? Esta ação registrará o
              pagamento no sistema.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPayDialogOpen(false);
                setPayingEntry(null);
              }}
              disabled={paying}
            >
              Cancelar
            </Button>
            <Button onClick={handleConfirmPay} disabled={paying}>
              {paying ? "Processando..." : "Confirmar Pagamento"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
