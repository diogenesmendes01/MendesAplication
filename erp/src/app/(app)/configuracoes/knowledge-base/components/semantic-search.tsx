"use client";

import { useState } from "react";
import { Search, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { searchKnowledge } from "../actions";
import type { KBSearchResult } from "../actions";

interface SemanticSearchProps {
  companyId: string;
}

function similarityColor(score: number): string {
  if (score >= 90) return "bg-green-600";
  if (score >= 75) return "bg-yellow-500";
  return "bg-orange-500";
}

export function SemanticSearch({ companyId }: SemanticSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KBSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    setSearched(true);
    try {
      const data = await searchKnowledge(companyId, query.trim());
      setResults(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro na busca");
    } finally {
      setSearching(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Search className="h-5 w-5" />
          Testar Busca Semântica
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSearch();
            }}
            placeholder="Como a IA encontraria este conteúdo? Teste aqui..."
            className="flex-1"
          />
          <Button onClick={handleSearch} disabled={searching || !query.trim()}>
            {searching ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Buscar
          </Button>
        </div>

        {searched && !searching && results.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-4">
            Nenhum resultado encontrado acima do threshold (50%).
          </div>
        )}

        {results.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Resultados (top {results.length}):
            </p>
            {results.map((r, i) => (
              <div
                key={`${r.documentId}-${r.chunkIndex}`}
                className="rounded-lg border p-3 space-y-1"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">
                      {i + 1}.
                    </span>
                    <span className="font-medium">{r.documentName}</span>
                    {r.category && (
                      <Badge variant="outline" className="text-xs">
                        {r.category}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      — Chunk {r.chunkIndex + 1}
                    </span>
                  </div>
                  <Badge className={similarityColor(r.similarity)}>
                    {r.similarity}% match
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {r.chunkContent}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
