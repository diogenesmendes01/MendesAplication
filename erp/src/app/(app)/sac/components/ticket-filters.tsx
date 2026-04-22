"use client";

import { type FormEvent } from "react";
import { Search, Filter, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ChannelType } from "@prisma/client";

interface TicketFiltersProps {
  searchInput: string;
  onSearchInputChange: (value: string) => void;
  onSearch: (e: FormEvent) => void;
  search: string;
  onClearSearch: () => void;
  channelFilter: ChannelType | "";
  onChannelFilterChange: (value: ChannelType | "") => void;
  pendingSuggestionFilter: boolean;
  onPendingSuggestionChange: (checked: boolean) => void;
  /** Hide channel dropdown when viewing a single channel */
  hideChannelFilter?: boolean;
}

export function TicketFilters({
  searchInput,
  onSearchInputChange,
  onSearch,
  search,
  onClearSearch,
  channelFilter,
  onChannelFilterChange,
  pendingSuggestionFilter,
  onPendingSuggestionChange,
  hideChannelFilter,
}: TicketFiltersProps) {
  return (
    <div className="space-y-4">
      {/* Search */}
      <form onSubmit={onSearch} className="flex items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente ou assunto..."
            value={searchInput}
            onChange={(e) => onSearchInputChange(e.target.value)}
            className="w-64 pl-9"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Buscar
        </Button>
        {search && (
          <Button type="button" variant="ghost" size="sm" onClick={onClearSearch}>
            Limpar
          </Button>
        )}
      </form>

      {/* Inline filters */}
      <div className="flex flex-wrap items-center gap-4">
        {!hideChannelFilter && (
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Label className="text-sm font-medium">Canal:</Label>
            <Select
              value={channelFilter || "__all__"}
              onValueChange={(v) =>
                onChannelFilterChange(v === "__all__" ? "" : (v as ChannelType))
              }
            >
              <SelectTrigger className="w-[160px] h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                <SelectItem value="RECLAMEAQUI">Reclame Aqui</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Switch
            id="pending-suggestion-filter"
            checked={pendingSuggestionFilter}
            onCheckedChange={(checked) => onPendingSuggestionChange(!!checked)}
          />
          <Label htmlFor="pending-suggestion-filter" className="text-sm cursor-pointer">
            <Bot className="inline h-4 w-4 mr-1" />
            Com sugestão pendente
          </Label>
        </div>
      </div>
    </div>
  );
}
