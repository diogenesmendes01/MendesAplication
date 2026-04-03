"use client";

import { FlaskConical, HeartPulse } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TabSimulador } from "./tab-simulador";
import { TabHealth } from "./tab-health";
import type { AiConfigData } from "./types";

interface TabFerramentasProps {
  companyId: string;
  config: AiConfigData;
}

export function TabFerramentas({ companyId, config }: TabFerramentasProps) {
  return (
    <Tabs defaultValue="simulador">
      <TabsList>
        <TabsTrigger value="simulador" className="gap-1.5">
          <FlaskConical className="h-4 w-4" />
          Simulador
        </TabsTrigger>
        <TabsTrigger value="saude" className="gap-1.5">
          <HeartPulse className="h-4 w-4" />
          Saúde
        </TabsTrigger>
      </TabsList>

      <TabsContent value="simulador" className="mt-4">
        <TabSimulador companyId={companyId} />
      </TabsContent>

      <TabsContent value="saude" className="mt-4">
        <TabHealth companyId={companyId} />
      </TabsContent>
    </Tabs>
  );
}
