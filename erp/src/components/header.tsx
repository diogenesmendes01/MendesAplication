"use client";

import { usePathname } from "next/navigation";
import { Search, Bell, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { useUser } from "@/contexts/user-context";

/* ── Route → label map ── */
const routeLabels: Record<string, string> = {
  dashboard: "Dashboard",
  comercial: "Comercial",
  sac: "SAC",
  financeiro: "Financeiro",
  fiscal: "Fiscal",
  configuracoes: "Configurações",
  clientes: "Clientes",
  propostas: "Propostas",
  pipeline: "Pipeline",
  tickets: "Tickets",
  "notas-fiscais": "Notas Fiscais",
  "plano-de-contas": "Plano de Contas",
  impostos: "Impostos",
  canais: "Canais",
  sla: "SLA",
  "knowledge-base": "Knowledge Base",
  ai: "Agente IA",
  usuarios: "Usuários",
  nova: "Nova",
};

// Match CUID (clx..., cm...) or UUID patterns to replace with "Detalhe"
const idPattern = /^(cl[a-z0-9]{20,}|cm[a-z0-9]{20,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

function buildBreadcrumb(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  return segments
    .filter((s) => !s.startsWith("(")) // skip route groups like (app)
    .map((s) => {
      if (routeLabels[s]) return routeLabels[s];
      if (idPattern.test(s)) return "Detalhe";
      return s.charAt(0).toUpperCase() + s.slice(1);
    });
}

export function Header() {
  const pathname = usePathname();
  const { user } = useUser();
  const breadcrumb = buildBreadcrumb(pathname);

  const userName = user?.name || "Usuário";
  const userInitials = userName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border-subtle bg-background">
      <div className="flex w-full items-center justify-between px-4">
        {/* Left side: Sidebar trigger + Breadcrumb */}
        <div className="flex items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />

          {/* Dynamic breadcrumb */}
          <nav className="hidden items-center gap-1 text-sm md:flex" aria-label="Breadcrumb">
            <span className="text-text-tertiary">MendesERP</span>
            {breadcrumb.map((label, i) => (
              <span key={i} className="flex items-center gap-1">
                <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />
                <span
                  className={cn(
                    i === breadcrumb.length - 1
                      ? "font-semibold text-text-primary"
                      : "text-text-secondary"
                  )}
                >
                  {label}
                </span>
              </span>
            ))}
          </nav>
        </div>

        {/* Right side: Search + Notifications + Avatar */}
        <div className="flex items-center gap-2">
          {/* Global search */}
          <div className="hidden items-center gap-2 sm:flex">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
              <Input
                type="search"
                placeholder="Buscar..."
                className="h-9 w-64 pl-9"
              />
            </div>
          </div>

          {/* Notifications */}
          <Button
            variant="ghost"
            size="icon"
            className="relative text-text-secondary hover:text-text-primary"
            aria-label="Notificações"
          >
            <Bell className="h-5 w-5" />
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger" />
          </Button>

          {/* User avatar */}
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
              {userInitials}
            </div>
            <span className="hidden text-sm font-medium text-text-primary sm:inline">
              {userName}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
