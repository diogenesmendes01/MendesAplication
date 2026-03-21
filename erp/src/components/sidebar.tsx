"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
  Check,
  Radio,
  Clock,
  BookOpen,
  Bot,
  Receipt,
  Landmark,
  X,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCompany } from "@/contexts/company-context";
import { useUser } from "@/contexts/user-context";
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
      { label: "SLA", href: "/configuracoes/sla", icon: Clock },
      { label: "Knowledge Base", href: "/configuracoes/knowledge-base", icon: BookOpen },
      { label: "Agente IA", href: "/configuracoes/ai", icon: Bot },
      { label: "Fiscal", href: "/configuracoes/fiscal", icon: Receipt },
      { label: "Integrações Bancárias", href: "/configuracoes/integracoes-bancarias", icon: Landmark },
      { label: "Canais", href: "/configuracoes/canais", icon: Radio },
    ],
  },
];

const roleLabels: Record<string, string> = {
  ADMIN: "Administrador",
  MANAGER: "Gerente",
  USER: "Usuário",
  VIEWER: "Visualizador",
};

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onMobileClose?: () => void;
}

export function Sidebar({ collapsed, onToggle, onMobileClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { companies, selectedCompany, setSelectedCompanyId } = useCompany();
  const { user } = useUser();
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

  /* ── Logout handler ── */
  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
    }
  }, [router]);

  /* ── User display helpers ── */
  const userName = user?.name || "Usuário";
  const userRole = user?.role ? (roleLabels[user.role] || user.role) : "—";
  const userInitials = userName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  /* ── Shared company dropdown content ── */
  const companyDropdownItems = companies.map((company) => (
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
        <Check className="ml-2 h-4 w-4 shrink-0 text-accent" />
      )}
    </DropdownMenuItem>
  ));

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
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-accent">
                  {selectedCompany?.nomeFantasia?.charAt(0) || "E"}
                </div>
                <span className="flex-1 truncate text-left text-sm font-medium">
                  {selectedCompany?.nomeFantasia || "Empresa"}
                </span>
                <ChevronDown className="h-4 w-4 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[280px]">
              {companyDropdownItems}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {collapsed && (
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-subtle text-accent transition-colors hover:bg-accent-muted"
                    aria-label="Trocar empresa"
                  >
                    {selectedCompany?.nomeFantasia?.charAt(0) || "E"}
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">
                {selectedCompany?.nomeFantasia || "Trocar empresa"}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" side="right" className="w-[280px]">
              {companyDropdownItems}
            </DropdownMenuContent>
          </DropdownMenu>
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

      {/* Footer com Avatar + Logout (expanded) */}
      {!collapsed && (
        <div className="border-t border-border-subtle p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex w-full items-center gap-3 rounded-lg bg-sidebar-hover-bg p-2 transition-colors hover:bg-sidebar-active-bg">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                  {userInitials}
                </div>
                <div className="flex-1 truncate text-left">
                  <div className="truncate text-sm font-medium text-text-primary">{userName}</div>
                  <div className="truncate text-xs text-text-tertiary">{userRole}</div>
                </div>
                <ChevronDown className="h-4 w-4 text-text-tertiary" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-[220px]">
              <div className="px-2 py-1.5">
                <div className="text-sm font-medium">{userName}</div>
                <div className="text-xs text-text-tertiary">{user?.email}</div>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-danger focus:text-danger">
                <LogOut className="mr-2 h-4 w-4" />
                Sair
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* Collapsed: logout icon button */}
      {collapsed && (
        <div className="border-t border-border-subtle p-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                className="w-full text-text-secondary hover:bg-sidebar-hover-bg hover:text-danger"
                aria-label="Sair"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">Sair</TooltipContent>
          </Tooltip>
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
