"use client";

import { useState, useEffect } from "react";
import { List, Kanban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ViewMode = "table" | "kanban";

const STORAGE_KEY = "sac-view-mode";

interface ViewToggleProps {
  onChange?: (mode: ViewMode) => void;
}

export function ViewToggle({ onChange }: ViewToggleProps) {
  const [mode, setMode] = useState<ViewMode>("table");

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "table" || stored === "kanban") {
      setMode(stored);
      onChange?.(stored);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(next: ViewMode) {
    setMode(next);
    localStorage.setItem(STORAGE_KEY, next);
    onChange?.(next);
  }

  return (
    <div className="inline-flex items-center rounded-md border p-0.5">
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-7 px-2",
          mode === "table" && "bg-muted font-semibold"
        )}
        onClick={() => toggle("table")}
        title="Tabela"
      >
        <List className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          "h-7 px-2",
          mode === "kanban" && "bg-muted font-semibold"
        )}
        onClick={() => toggle("kanban")}
        title="Kanban"
      >
        <Kanban className="h-4 w-4" />
      </Button>
    </div>
  );
}
