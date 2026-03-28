"use client";

import { useState, useEffect } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getDocumentChunks, rechunkDocument } from "../actions";
import type { KBChunk } from "../actions";

interface ChunksViewerProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  documentId: string;
  documentName: string;
}

export function ChunksViewer({
  open,
  onClose,
  companyId,
  documentId,
  documentName,
}: ChunksViewerProps) {
  const [chunks, setChunks] = useState<KBChunk[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [chunkSize, setChunkSize] = useState(500);

  useEffect(() => {
    if (open && documentId) {
      loadChunks();
    }
  }, [open, documentId]);

  async function loadChunks() {
    setLoading(true);
    try {
      const data = await getDocumentChunks(companyId, documentId);
      setChunks(data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao carregar chunks");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegenerate() {
    setRegenerating(true);
    try {
      const result = await rechunkDocument(companyId, documentId, chunkSize);
      toast.success(`${result.chunksCreated} chunks gerados`);
      await loadChunks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao regenerar chunks");
    } finally {
      setRegenerating(false);
    }
  }

  const totalTokens = chunks.reduce((sum, c) => sum + c.tokenEstimate, 0);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            🧩 Chunks: {documentName} ({chunks.length} chunks, ~{totalTokens}{" "}
            tokens)
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-4 py-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="chunk-size" className="text-sm whitespace-nowrap">
              Tamanho:
            </Label>
            <Input
              id="chunk-size"
              type="number"
              value={chunkSize}
              onChange={(e) => setChunkSize(Number(e.target.value))}
              className="w-24 h-8"
              min={100}
              max={2000}
            />
            <span className="text-xs text-muted-foreground">tokens</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRegenerate}
            disabled={regenerating}
          >
            {regenerating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Regenerar Chunks
          </Button>
        </div>

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : chunks.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            Nenhum chunk encontrado.
          </div>
        ) : (
          <div className="space-y-3">
            {chunks.map((chunk) => (
              <Card key={chunk.id}>
                <CardHeader className="py-2 px-4">
                  <CardTitle className="text-xs font-medium text-muted-foreground">
                    Chunk {chunk.chunkIndex + 1} (~{chunk.tokenEstimate} tokens)
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-3">
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">
                    {chunk.content}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
