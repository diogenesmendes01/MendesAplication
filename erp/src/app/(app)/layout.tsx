"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { CompanyProvider } from "@/contexts/company-context";
import { UserProvider } from "@/contexts/user-context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close mobile sidebar on window resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setMobileOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <CompanyProvider>
      <UserProvider>
        <TooltipProvider delayDuration={300}>
          {/* Mobile backdrop */}
          {mobileOpen && (
            <div
              className="fixed inset-0 z-30 bg-black/50 md:hidden"
              onClick={() => setMobileOpen(false)}
            />
          )}

          {/* Single sidebar — always mounted, CSS handles responsive */}
          <div
            className={cn(
              "fixed inset-y-0 left-0 z-40 transition-transform duration-300",
              mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
            )}
          >
            <Sidebar
              collapsed={collapsed}
              onToggle={() => setCollapsed(!collapsed)}
              onMobileClose={() => setMobileOpen(false)}
            />
          </div>

          {/* Header */}
          <Header
            sidebarCollapsed={collapsed}
            onMenuClick={() => setMobileOpen(!mobileOpen)}
          />

          {/* Main content */}
          <main
            className={cn(
              "min-h-screen pt-14 transition-all duration-300",
              collapsed ? "md:pl-16" : "md:pl-60"
            )}
          >
            <div className="p-6">{children}</div>
          </main>
        </TooltipProvider>
      </UserProvider>
    </CompanyProvider>
  );
}
