"use client";

import Link from "next/link";
import { Mail, MessageSquare, Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useCompany } from "@/contexts/company-context";
import { MasterDashboard } from "./components/master-dashboard";

const channels = [
  {
    href: "/sac/email",
    label: "Email",
    icon: Mail,
    color: "text-blue-600",
    bg: "bg-blue-50",
  },
  {
    href: "/sac/whatsapp",
    label: "WhatsApp",
    icon: MessageSquare,
    color: "text-green-600",
    bg: "bg-green-50",
  },
  {
    href: "/sac/reclameaqui",
    label: "Reclame Aqui",
    icon: Globe,
    color: "text-purple-600",
    bg: "bg-purple-50",
  },
] as const;

export default function SacOverviewPage() {
  const { selectedCompanyId } = useCompany();

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para visualizar o SAC.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">SAC — Overview</h1>
        <p className="text-sm text-muted-foreground">
          Visão geral de todos os canais de atendimento
        </p>
      </div>

      {/* Master Dashboard — KPIs + bar chart + urgent tickets */}
      <MasterDashboard />

      {/* Channel navigation cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        {channels.map(({ href, label, icon: Icon, color, bg }) => (
          <Link key={href} href={href}>
            <Card className="transition-shadow hover:shadow-md cursor-pointer">
              <CardHeader className="flex flex-row items-center gap-3 pb-2">
                <div className={`rounded-lg p-2 ${bg}`}>
                  <Icon className={`h-5 w-5 ${color}`} />
                </div>
                <CardTitle className="text-base">{label}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Ver tickets de {label}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
