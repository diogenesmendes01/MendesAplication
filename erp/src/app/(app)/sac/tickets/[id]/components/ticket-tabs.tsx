"use client";

import { LayoutGrid, Clock, Edit3 } from "lucide-react";
import { useChannelTheme } from "./channel-theme-provider";

export type TabId = "detalhes" | "timeline" | "responder";

interface TicketTabsProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
}

const TABS: { id: TabId; label: string; icon: typeof LayoutGrid }[] = [
  { id: "detalhes", label: "Detalhes", icon: LayoutGrid },
  { id: "timeline", label: "Timeline", icon: Clock },
  { id: "responder", label: "Responder", icon: Edit3 },
];

export default function TicketTabs({ activeTab, onTabChange }: TicketTabsProps) {
  const theme = useChannelTheme();

  return (
    <div className="flex border-b border-[#f1f5f9]">
      {TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        const Icon = tab.icon;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="flex items-center gap-1.5 px-4 py-[9px] text-[12px] transition-colors border-b-2"
            style={{
              color: isActive ? theme.tabActive : "#94a3b8",
              borderBottomColor: isActive ? theme.tabActive : "transparent",
              fontWeight: isActive ? 600 : 500,
            }}
          >
            <Icon className="h-3 w-3" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
