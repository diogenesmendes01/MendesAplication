"use client";

import { useEffect, useState, useCallback } from "react";
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
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCompany } from "@/contexts/company-context";
import { getSlaAlertCounts } from "@/app/(app)/sac/tickets/actions";
import { useEventStream } from "@/hooks/use-event-stream";

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
  const { companies, selectedCompany, setSelectedCompanyId } = useCompany();
  const [sacBadge, setSacBadge] = useState(0);

  const fetchBadge = useCallback(() => {
    if (!selectedCompany) return;
    getSlaAlertCounts(selectedCompany.id)
      .then(({ breached, atRisk }) => {
        setSacBadge(breached + atRisk);
      })
      .catch(() => {
        setSacBadge(0);
      });
  }, [selectedCompany]);

  useEffect(() => {
    if (!selectedCompany) {
      setSacBadge(0);
      return;
    }

    fetchBadge();
  }, [selectedCompany, fetchBadge]);

  useEventStream(selectedCompany?.id ?? null, {
    "sla-update": () => {
      fetchBadge();
    },
  });

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 flex h-screen flex-col transition-all duration-300",
        collapsed ? "w-16" : "w-60",
        "bg-sidebar"
      )}
    >
      {/* Seletor de Empresa */}
      <div className="flex h-14 items-center justify-between border-b border-border-subtle px-3">
        {!collapsed && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-10 w-full justify-start gap-2 px-2"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-subtle text-accent">
                  {selectedCompany?.nomeFantasia?.charAt(0) || "E"}
                </div>
                <span className="flex-1 truncate text-left text-sm font-medium">
                  {selectedCompany?.nomeFantasia || "Empresa"}
                </span>
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[280px]">
              {companies.map((company) => (
                <DropdownMenuItem
                  key={company.id}
                  onClick={() => setSelectedCompanyId(company.id)}
                  className="flex items-center justify-between"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{company.nomeFantasia}</div>
                    <div className="truncate text-xs text-text-secondary">
                      {company.cnpj}
                    </div>
                  </div>
                  {selectedCompany?.id === company.id && (
                    <ChevronDown className="ml-2 h-4 w-4 shrink-0 rotate-180 text-accent" />
                  )}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {collapsed && (
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-subtle text-accent">
            {selectedCompany?.nomeFantasia?.charAt(0) || "E"}
          </div>
        )}
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
                  "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150",
                  collapsed && "justify-center px-2",
                  isActive
                    ? "bg-sidebar-active-bg text-sidebar-active-text shadow-sm"
                    : "text-text-secondary hover:bg-sidebar-hover-bg hover:text-text-primary"
                )}
                title={collapsed ? item.label : undefined}
              >
                {isActive && !collapsed && (
                  <div className="absolute left-0 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-accent" />
                )}
                <div className="relative shrink-0">
                  <item.icon className="h-5 w-5" />
                  {badge > 0 && collapsed && (
                    <span className="absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[9px] font-bold text-white">
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </div>
                {!collapsed && (
                  <span className="flex-1">{item.label}</span>
                )}
                {!collapsed && badge > 0 && (
                  <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-danger-subtle px-1.5 text-[10px] font-bold text-danger">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
                {!collapsed && hasChildren && (
                  <ChevronDown className={cn("h-4 w-4 transition-transform", isActive && "rotate-180")} />
                )}
              </Link>
              {showChildren && (
                <div className="ml-4 mt-1 space-y-1 border-l border-border-subtle pl-3">
                  {item.children!.map((child) => {
                    const childActive = pathname === child.href || pathname.startsWith(child.href + "/");
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                          childActive
                            ? "font-medium text-accent"
                            : "text-text-secondary hover:bg-sidebar-hover-bg hover:text-text-primary"
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

      {/* Footer com Avatar */}
      {!collapsed && (
        <div className="border-t border-border-subtle p-3">
          <div className="flex items-center gap-3 rounded-lg bg-sidebar-hover-bg p-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white">
              <User className="h-4 w-4" />
            </div>
            <div className="flex-1 truncate">
              <div className="truncate text-sm font-medium text-text-primary">Mendes</div>
              <div className="truncate text-xs text-text-tertiary">Administrador</div>
            </div>
            <ChevronDown className="h-4 w-4 text-text-tertiary" />
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <div className="border-t border-border-subtle p-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className={cn(
            "w-full text-text-secondary hover:bg-sidebar-hover-bg hover:text-text-primary",
            collapsed ? "justify-center" : "justify-end"
          )}
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
