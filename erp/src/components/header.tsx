"use client";

import { Menu, User, Search, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface HeaderProps {
  sidebarCollapsed: boolean;
  onMenuClick: () => void;
  userName?: string;
  pageTitle?: string;
}

export function Header({ sidebarCollapsed, onMenuClick, userName, pageTitle }: HeaderProps) {
  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-30 flex h-14 items-center bg-background transition-all duration-300",
        sidebarCollapsed ? "left-16" : "left-60"
      )}
    >
      <div className="flex w-full items-center justify-between px-4">
        {/* Lado esquerdo: Mobile hamburger + Breadcrumb */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onMenuClick}
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Breadcrumb simplificado */}
          <div className="hidden items-center gap-1 text-sm text-text-secondary md:flex">
            {pageTitle && (
              <span className="font-medium text-text-primary">{pageTitle}</span>
            )}
          </div>
        </div>

        {/* Lado direito: Busca + Notificações + Avatar */}
        <div className="flex items-center gap-2">
          {/* Busca global */}
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

          {/* Notificações */}
          <Button
            variant="ghost"
            size="icon"
            className="relative text-text-secondary hover:text-text-primary"
            aria-label="Notificações"
          >
            <Bell className="h-5 w-5" />
            {/* Badge de notificação (exemplo - pode ser dinâmico) */}
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-danger" />
          </Button>

          {/* Avatar do usuário */}
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white">
              <User className="h-4 w-4" />
            </div>
            <span className="hidden text-sm font-medium text-text-primary sm:inline">
              {userName ?? "Usuário"}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
