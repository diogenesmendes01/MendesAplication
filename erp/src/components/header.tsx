"use client";

import { Menu, User, Building2, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useCompany } from "@/contexts/company-context";

interface HeaderProps {
  sidebarCollapsed: boolean;
  onMenuClick: () => void;
  userName?: string;
}

export function Header({ sidebarCollapsed, onMenuClick, userName }: HeaderProps) {
  const { companies, selectedCompany, setSelectedCompanyId, loading } = useCompany();

  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-30 flex h-14 items-center border-b bg-card transition-all duration-300",
        "left-0",
        sidebarCollapsed ? "md:left-16" : "md:left-60"
      )}
    >
      <div className="flex w-full items-center justify-between px-4">
        {/* Mobile hamburger */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onMenuClick}
          aria-label="Abrir menu"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Company selector */}
        <div className="hidden md:block">
          {loading ? (
            <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <span>Carregando...</span>
            </div>
          ) : companies.length === 0 ? (
            <div className="flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <span>Nenhuma empresa</span>
            </div>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Building2 className="h-4 w-4" />
                  <span className="max-w-[200px] truncate">
                    {selectedCompany?.nomeFantasia ?? "Selecionar empresa"}
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
                      <div className="truncate text-xs text-muted-foreground">
                        {company.cnpj}
                      </div>
                    </div>
                    {selectedCompany?.id === company.id && (
                      <Check className="ml-2 h-4 w-4 shrink-0 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Mobile company selector */}
        <div className="md:hidden">
          {!loading && companies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Selecionar empresa">
                  <Building2 className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[260px]">
                {companies.map((company) => (
                  <DropdownMenuItem
                    key={company.id}
                    onClick={() => setSelectedCompanyId(company.id)}
                    className="flex items-center justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{company.nomeFantasia}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {company.cnpj}
                      </div>
                    </div>
                    {selectedCompany?.id === company.id && (
                      <Check className="ml-2 h-4 w-4 shrink-0 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User info */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <User className="h-4 w-4" />
          </div>
          <span className="hidden text-sm font-medium sm:inline">
            {userName ?? "Usuário"}
          </span>
        </div>
      </div>
    </header>
  );
}
