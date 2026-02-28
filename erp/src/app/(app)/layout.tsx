"use client";

import { useState, useEffect } from "react";
import { Sidebar } from "@/components/sidebar";
import { Header } from "@/components/header";
import { CompanyProvider } from "@/contexts/company-context";
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
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Desktop sidebar */}
      <div className="hidden md:block">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      </div>

      {/* Mobile sidebar (slides in/out) */}
      <div
        className={cn(
          "fixed inset-y-0 left-0 z-50 transition-transform duration-300 md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <Sidebar collapsed={false} onToggle={() => setMobileOpen(false)} />
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
    </CompanyProvider>
  );
}
