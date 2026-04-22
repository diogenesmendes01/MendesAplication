"use client";

import { BarChart3, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { useAiUsage } from "../hooks";
import type { AiConfigData } from "./types";

interface TabConsumoProps {
  companyId: string;
  config: AiConfigData;
}

export function TabConsumo({ companyId, config }: TabConsumoProps) {
  const { usageSummary, todaySpend, loadingUsage, loadUsageData } =
    useAiUsage(companyId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="h-5 w-5" />
                Consumo de IA
              </CardTitle>
              <CardDescription>
                Acompanhe o uso e os custos do agente IA nos últimos 30 dias
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadUsageData}
              disabled={loadingUsage}
            >
              {loadingUsage ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <BarChart3 className="mr-2 h-4 w-4" />
              )}
              {loadingUsage ? "Carregando..." : "Carregar dados"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!usageSummary && !loadingUsage && (
            <p className="text-sm text-muted-foreground text-center py-8">
              Clique em &quot;Carregar dados&quot; para visualizar o consumo.
            </p>
          )}

          {loadingUsage && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando dados de consumo...
            </div>
          )}

          {usageSummary && !loadingUsage && (
            <div className="space-y-6">
              {/* Today vs limit */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Gasto hoje</p>
                  <p className="text-2xl font-bold">
                    R$ {todaySpend.toFixed(2)}
                  </p>
                  {config.dailySpendLimitBrl && (
                    <p className="text-xs text-muted-foreground mt-1">
                      de R$ {config.dailySpendLimitBrl.toFixed(2)} (limite)
                    </p>
                  )}
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Total 30 dias</p>
                  <p className="text-2xl font-bold">
                    R$ {usageSummary.totalCostBrl.toFixed(2)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    US$ {usageSummary.totalCostUsd.toFixed(4)}
                  </p>
                </div>
                <div className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">Tokens totais</p>
                  <p className="text-2xl font-bold">
                    {(
                      usageSummary.totalInputTokens +
                      usageSummary.totalOutputTokens
                    ).toLocaleString("pt-BR")}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {usageSummary.totalInputTokens.toLocaleString("pt-BR")} in ·{" "}
                    {usageSummary.totalOutputTokens.toLocaleString("pt-BR")} out
                  </p>
                </div>
              </div>

              {/* Breakdown by channel */}
              {usageSummary.byChannel.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-2">Por canal</h3>
                  <div className="rounded-md border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="px-4 py-2 text-left font-medium">Canal</th>
                          <th className="px-4 py-2 text-right font-medium">Tokens</th>
                          <th className="px-4 py-2 text-right font-medium">Custo (R$)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageSummary.byChannel.map((ch) => (
                          <tr key={ch.channel} className="border-b last:border-0">
                            <td className="px-4 py-2">
                              <Badge variant="outline">{ch.channel}</Badge>
                            </td>
                            <td className="px-4 py-2 text-right font-mono">
                              {ch.totalTokens.toLocaleString("pt-BR")}
                            </td>
                            <td className="px-4 py-2 text-right font-mono">
                              {ch.costBrl.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Breakdown by model */}
              {usageSummary.byModel.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium mb-2">Por modelo</h3>
                  <div className="rounded-md border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="px-4 py-2 text-left font-medium">Modelo</th>
                          <th className="px-4 py-2 text-right font-medium">Tokens</th>
                          <th className="px-4 py-2 text-right font-medium">Custo (R$)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usageSummary.byModel.map((m) => (
                          <tr key={m.model} className="border-b last:border-0">
                            <td className="px-4 py-2 font-mono text-xs">{m.model}</td>
                            <td className="px-4 py-2 text-right font-mono">
                              {m.totalTokens.toLocaleString("pt-BR")}
                            </td>
                            <td className="px-4 py-2 text-right font-mono">
                              {m.costBrl.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {usageSummary.byChannel.length === 0 &&
                usageSummary.byModel.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Nenhum uso registrado nos últimos 30 dias.
                  </p>
                )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
