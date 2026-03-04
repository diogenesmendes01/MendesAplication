"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingCart,
  Headphones,
  DollarSign,
  FileText,
  Settings,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Radio,
  Clock,
  BookOpen,
  Bot,
  Receipt,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/contexts/company-context";
import { getSlaAlertCounts } from "@/app/(app)/sac/tickets/actions";

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: { label: string; href: string; icon: React.ComponentType<{ className?: string }> }[];
}

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Comercial", href: "/comercial", icon: ShoppingCart },
  { label: "SAC", href: "/sac", icon: Headphones },
  { label: "Financeiro", href: "/financeiro", icon: DollarSign },
  { label: "Fiscal", href: "/fiscal", icon: FileText },
  {
    label: "Configurações",
    href: "/configuracoes",
    icon: Settings,
    children: [
      { label: "Canais", href: "/configuracoes/canais", icon: Radio },
      { label: "SLA", href: "/configuracoes/sla", icon: Clock },
      { label: "Knowledge Base", href: "/configuracoes/knowledge-base", icon: BookOpen },
      { label: "Agente IA", href: "/configuracoes/ai", icon: Bot },
      { label: "Fiscal", href: "/configuracoes/fiscal", icon: Receipt },
    ],
  },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onMobileClose?: () => void;
}

export function Sidebar({ collapsed, onToggle, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const { selectedCompanyId } = useCompany();
  const [sacBadge, setSacBadge] = useState(0);

  useEffect(() => {
    if (!selectedCompanyId) {
      setSacBadge(0);
      return;
    }

    let stale = false;

    function fetchBadge() {
      getSlaAlertCounts(selectedCompanyId!)
        .then(({ breached, atRisk }) => {
          if (!stale) setSacBadge(breached + atRisk);
        })
        .catch(() => {
          if (!stale) setSacBadge(0);
        });
    }

    fetchBadge();

    // Refresh every 60 seconds instead of never
    const interval = setInterval(fetchBadge, 60_000);

    return () => {
      stale = true;
      clearInterval(interval);
    };
  }, [selectedCompanyId]);

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col border-r bg-card transition-all duration-300",
        collapsed ? "w-16" : "w-60"
      )}
    >
      {/* Logo / Brand */}
      <div className="flex h-14 items-center justify-between border-b px-4">
        <div>
          {!collapsed && (
            <span className="text-lg font-bold text-primary">MendesERP</span>
          )}
          {collapsed && (
            <span className="text-lg font-bold text-primary">M</span>
          )}
        </div>
        {/* Mobile close button */}
        {onMobileClose && (
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onMobileClose}
            aria-label="Fechar menu"
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(item.href + "/");
          const badge = item.href === "/sac" ? sacBadge : 0;
          const hasChildren = item.children && item.children.length > 0;
          const showChildren = hasChildren && isActive && !collapsed;
          return (
            <div key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  collapsed && "justify-center px-2"
                )}
                title={collapsed ? item.label : undefined}
              >
                <div className="relative shrink-0">
                  <item.icon className="h-5 w-5" />
                  {badge > 0 && collapsed && (
                    <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </div>
                {!collapsed && (
                  <span className="flex-1">{item.label}</span>
                )}
                {!collapsed && badge > 0 && (
                  <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-600 px-1.5 text-[10px] font-bold text-white">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
                {!collapsed && hasChildren && (
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isActive && "rotate-0")} />
                )}
              </Link>
              {showChildren && (
                <div className="ml-4 mt-1 space-y-1 border-l pl-3">
                  {item.children!.map((child) => {
                    const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                          childActive
                            ? "font-medium text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        )}
                      >
                        <child.icon className="h-4 w-4" />
                        <span>{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className={cn("w-full", collapsed ? "justify-center" : "justify-end")}
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>
    </aside>
  );
}
