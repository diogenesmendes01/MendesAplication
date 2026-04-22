"use client";

import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { ChannelType } from "@prisma/client";
import { useCompany } from "@/contexts/company-context";
import { TicketDashboardKpis } from "../tickets/ticket-dashboard";
import { ChannelDashboard } from "../components/channel-dashboard";
import { TicketTable } from "../components/ticket-table";
import { TicketKanban } from "../components/ticket-kanban";
import { ViewToggle, type ViewMode } from "../components/view-toggle";

interface TicketListPageProps {
  channelType: ChannelType;
  channelLabel: string;
  channelIcon: LucideIcon;
}

export function TicketListPage({
  channelType,
  channelLabel,
  channelIcon: Icon,
}: TicketListPageProps) {
  const { selectedCompanyId } = useCompany();
  const [viewMode, setViewMode] = useState<ViewMode>("table");

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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-6 w-6" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {channelLabel}
            </h1>
            <p className="text-sm text-muted-foreground">
              Tickets do canal {channelLabel}
            </p>
          </div>
        </div>
        <ViewToggle onChange={setViewMode} />
      </div>

      {/* Channel-specific dashboard (above the view toggle area) */}
      <ChannelDashboard channelType={channelType} />

      {/* Channel-filtered KPI summary — fix for PR #362 Tech Lead note */}
      <TicketDashboardKpis
        companyId={selectedCompanyId}
        channelType={channelType}
      />

      {/* Content */}
      {viewMode === "kanban" ? (
        <TicketKanban channelType={channelType} />
      ) : (
        <TicketTable channelType={channelType} />
      )}
    </div>
  );
}
