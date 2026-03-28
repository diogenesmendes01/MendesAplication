"use client";

import { useState, useEffect } from "react";
import { Loader2, RotateCcw, Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getDocumentVersions,
  restoreVersion,
} from "../actions";
import type { KBVersion } from "../actions";

interface VersionsViewerProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  documentId: string;
  documentName: string;
  currentVersion: number;
  onRestored: () => void;
}

export function VersionsViewer({
  open,
  onClose,
  companyId,
  documentId,
  documentName,
  currentVersion,
  onRestored,
}: VersionsViewerProps) {
  const [versions, setVersions] = useState<KBVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<number | null>(null);
  const [viewContent, setViewContent] = useState<KBVersion | null>(null);

  useEffect(() => {
    if (open && documentId) {
      loadVersions();
    }
  }, [open, documentId]);

  async function loadVersions() {
    setLoading(true);
    try {
      const data = await getDocumentVersions(companyId, documentId);
      setVersions(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar versões"
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleRestore(version: number) {
    if (
      !confirm(
        `Restaurar versão v${version}? O conteúdo atual será salvo como nova versão.`
      )
    )
      return;

    setRestoring(version);
    try {
      await restoreVersion(companyId, documentId, version);
      toast.success(`Versão v${version} restaurada`);
      onRestored();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao restaurar versão"
      );
    } finally {
      setRestoring(null);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>📋 Versões: {documentName}</DialogTitle>
          </DialogHeader>

          {loading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : versions.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              Nenhuma versão anterior encontrada.
            </div>
          ) : (
            <div className="space-y-3">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="flex items-start justify-between rounded-lg border p-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">v{v.version}</span>
                      {v.version === currentVersion && (
                        <Badge variant="default" className="text-xs">
                          atual
                        </Badge>
                      )}
                    </div>
                    {v.changeNote && (
                      <p className="text-sm text-muted-foreground">
                        {v.changeNote}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {new Date(v.createdAt).toLocaleDateString("pt-BR", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewContent(v)}
                    >
                      <Eye className="mr-1 h-3 w-3" />
                      Ver
                    </Button>
                    {v.version !== currentVersion && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRestore(v.version)}
                        disabled={restoring === v.version}
                      >
                        {restoring === v.version ? (
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="mr-1 h-3 w-3" />
                        )}
                        Restaurar
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View content dialog */}
      <Dialog
        open={!!viewContent}
        onOpenChange={(v) => !v && setViewContent(null)}
      >
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              v{viewContent?.version} — {viewContent?.title}
            </DialogTitle>
          </DialogHeader>
          <pre className="whitespace-pre-wrap rounded-md bg-muted p-4 text-sm">
            {viewContent?.content}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
