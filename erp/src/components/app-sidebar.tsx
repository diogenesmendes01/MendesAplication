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
  ChevronDown,
  Shield,
  Check,
  Radio,
  Clock,
  BookOpen,
  Bot,
  Receipt,
  Landmark,
  LogOut,
  LayoutGrid,
  Mail,
  MessageCircle,
  Star,
  Lightbulb,
  ChevronsUpDown,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,

} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useCompany } from "@/contexts/company-context";
import { useUser } from "@/contexts/user-context";
import { getSlaAlertCounts } from "@/app/(app)/sac/tickets/actions";
import { getPendingSuggestionsCount } from "@/app/(app)/sac/tickets/[id]/suggestion-actions";
import { useEventStream } from "@/hooks/use-event-stream";

/* ── Types ── */
interface NavChild {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavItem {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: NavChild[];
}

/* ── Nav Items ── */
const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Comercial", href: "/comercial", icon: ShoppingCart },
  {
    label: "SAC",
    href: "/sac",
    icon: Headphones,
    children: [
      { label: "Visão Geral", href: "/sac", icon: LayoutGrid },
      { label: "Email", href: "/sac/email", icon: Mail },
      { label: "WhatsApp", href: "/sac/whatsapp", icon: MessageCircle },
      { label: "Reclame Aqui", href: "/sac/reclameaqui", icon: Star },
      { label: "Sugestões IA", href: "/sac/suggestions", icon: Lightbulb },
      { label: "SLA Dashboard", href: "/sac/sla", icon: Shield },
    ],
  },
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

/* ── Component ── */
export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  

  const { companies, selectedCompany, setSelectedCompanyId } = useCompany();
  const { user } = useUser();

  const [sacBadge, setSacBadge] = useState(0);
  const [suggestionBadge, setSuggestionBadge] = useState(0);

  /* ── Badge fetching ── */
  const fetchBadge = useCallback(() => {
    if (!selectedCompany) return;
    getSlaAlertCounts(selectedCompany.id)
      .then(({ breached, atRisk }) => setSacBadge(breached + atRisk))
      .catch(() => setSacBadge(0));
    getPendingSuggestionsCount(selectedCompany.id)
      .then((count) => setSuggestionBadge(count))
      .catch(() => setSuggestionBadge(0));
  }, [selectedCompany]);

  useEffect(() => {
    if (!selectedCompany) {
      setSacBadge(0);
      return;
    }
    fetchBadge();
  }, [selectedCompany, fetchBadge]);

  useEventStream(selectedCompany?.id ?? null, ["sac"], {
    "sac:sla-update": () => fetchBadge(),
  });

  /* ── Logout ── */
  const handleLogout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      router.push("/login");
    }
  }, [router]);

  /* ── User helpers ── */
  const userName = user?.name || "Usuário";
  const userRole = user?.role ? (roleLabels[user.role] || user.role) : "—";
  const userInitials = userName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <Sidebar collapsible="icon">
      {/* ── Company Selector ── */}
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-subtle text-accent font-semibold text-sm">
                    {selectedCompany?.nomeFantasia?.charAt(0) || "E"}
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {selectedCompany?.nomeFantasia || "Empresa"}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto h-4 w-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
                align="start"
                side="bottom"
                sideOffset={4}
              >
                {companies.map((company) => (
                  <DropdownMenuItem
                    key={company.id}
                    onClick={() => setSelectedCompanyId(company.id)}
                    className="flex items-center justify-between gap-2"
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
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      {/* ── Navigation ── */}
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navegação</SidebarGroupLabel>
          <SidebarMenu>
            {navItems.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(item.href + "/");
              const hasChildren = item.children && item.children.length > 0;
              const badge = item.href === "/sac" ? sacBadge : 0;

              if (!hasChildren) {
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                    >
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                    {badge > 0 && (
                      <SidebarMenuBadge className="bg-danger-subtle text-danger text-[10px] font-bold">
                        {badge > 99 ? "99+" : badge}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                );
              }

              return (
                <Collapsible
                  key={item.href}
                  asChild
                  defaultOpen={isActive}
                  className="group/collapsible"
                >
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        tooltip={item.label}
                        isActive={isActive}
                      >
                        <item.icon />
                        <span>{item.label}</span>
                        <ChevronDown className="ml-auto h-4 w-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    {badge > 0 && (
                      <SidebarMenuBadge className="bg-danger-subtle text-danger text-[10px] font-bold">
                        {badge > 99 ? "99+" : badge}
                      </SidebarMenuBadge>
                    )}
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.children!.map((child) => {
                          const childActive =
                            pathname === child.href ||
                            pathname.startsWith(child.href + "/");
                          return (
                            <SidebarMenuSubItem key={child.href}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={childActive}
                              >
                                <Link href={child.href}>
                                  <child.icon className="h-4 w-4" />
                                  <span>{child.label}</span>
                                </Link>
                              </SidebarMenuSubButton>
                              {child.href === "/sac/suggestions" &&
                                suggestionBadge > 0 && (
                                  <SidebarMenuBadge className="bg-purple-100 text-purple-700 text-[9px] font-bold">
                                    {suggestionBadge > 99 ? "99+" : suggestionBadge}
                                  </SidebarMenuBadge>
                                )}
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      {/* ── User Profile Footer ── */}
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
                    {userInitials}
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">{userName}</span>
                    <span className="truncate text-xs text-text-tertiary">
                      {userRole}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto h-4 w-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56"
                side="top"
                align="start"
                sideOffset={4}
              >
                <div className="px-2 py-1.5">
                  <div className="text-sm font-medium">{userName}</div>
                  <div className="text-xs text-text-tertiary">{user?.email}</div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-danger focus:text-danger"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Sair
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
