"use client";

import { Menu, User, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface HeaderProps {
  sidebarCollapsed: boolean;
  onMenuClick: () => void;
  userName?: string;
}

export function Header({ sidebarCollapsed, onMenuClick, userName }: HeaderProps) {
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

        {/* Company selector placeholder */}
        <div className="hidden items-center gap-2 rounded-md border px-3 py-1.5 text-sm text-muted-foreground md:flex">
          <Building2 className="h-4 w-4" />
          <span>Selecionar empresa</span>
        </div>

        {/* Spacer on mobile */}
        <div className="flex-1 md:hidden" />

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
