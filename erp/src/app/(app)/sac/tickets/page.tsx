"use client";

import { useCompany } from "@/contexts/company-context";
import { TicketDashboardKpis } from "./ticket-dashboard";
import { TicketTable } from "../components/ticket-table";

/**
 * /sac/tickets — backward-compatible page that shows all tickets across
 * every channel. Delegates rendering to the shared TicketTable component.
 */
export default function TicketsPage() {
  const { selectedCompanyId } = useCompany();

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para visualizar os tickets.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Tickets SAC</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie os tickets de atendimento ao cliente
        </p>
      </div>

      {/* Dashboard KPIs */}
      <TicketDashboardKpis companyId={selectedCompanyId} />

      {/* Full ticket table (all channels) */}
      <TicketTable />
    </div>
  );
}
