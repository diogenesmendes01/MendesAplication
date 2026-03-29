"use client";

import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Header } from "@/components/header";
import { CompanyProvider } from "@/contexts/company-context";
import { UserProvider } from "@/contexts/user-context";
import { TooltipProvider } from "@/components/ui/tooltip";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <CompanyProvider>
      <UserProvider>
        <TooltipProvider delayDuration={300}>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <Header />
              <main className="p-4 md:p-6">{children}</main>
            </SidebarInset>
          </SidebarProvider>
        </TooltipProvider>
      </UserProvider>
    </CompanyProvider>
  );
}
