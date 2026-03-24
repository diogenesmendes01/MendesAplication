"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Upload,
  Trash2,
  FileText,
  FileType,
  Plus,
  Pencil,
  ShieldAlert,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCompany } from "@/contexts/company-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DocumentRow {
  id: string;
  name: string;
  mimeType: string;
  fileSize: number;
  status: "PROCESSING" | "READY" | "ERROR";
  channel: string | null;
  content?: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusBadge(status: DocumentRow["status"]) {
  switch (status) {
    case "PROCESSING":
      return <Badge variant="secondary">Processando</Badge>;
    case "READY":
      return (
        <Badge variant="default" className="bg-green-600 hover:bg-green-700">
          Pronto
        </Badge>
      );
    case "ERROR":
      return <Badge variant="destructive">Erro</Badge>;
  }
}

function mimeIcon(mimeType: string) {
  if (mimeType === "application/pdf")
    return <FileType className="h-4 w-4 text-red-500" />;
  return <FileText className="h-4 w-4 text-blue-500" />;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function KnowledgeBasePage() {
  const { selectedCompanyId } = useCompany();
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // RA document dialog state
  const [raDialogOpen, setRaDialogOpen] = useState(false);
  const [raEditingId, setRaEditingId] = useState<string | null>(null);
  const [raDocTitle, setRaDocTitle] = useState("");
  const [raDocContent, setRaDocContent] = useState("");
  const [raSaving, setRaSaving] = useState(false);

  const loadDocuments = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/documents?companyId=${selectedCompanyId}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao carregar documentos");
      }
      const data = await res.json();
      setDocuments(data);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar documentos"
      );
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  // Filter documents by channel
  const generalDocs = documents.filter((d) => !d.channel);
  const raDocs = documents.filter((d) => d.channel === "RECLAMEAQUI");

  async function handleUpload(files: FileList | File[]) {
    if (!selectedCompanyId) return;
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      if (!["application/pdf", "text/plain"].includes(file.type)) {
        toast.error(`Tipo não permitido: ${file.name}. Aceitos: PDF, TXT`);
        continue;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error(`Arquivo muito grande: ${file.name}. Limite: 10MB`);
        continue;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("companyId", selectedCompanyId);

        const res = await fetch("/api/documents", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Erro no upload");
        }

        toast.success(`${file.name} enviado com sucesso`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Erro no upload");
      } finally {
        setUploading(false);
      }
    }

    await loadDocuments();

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleDelete(docId: string, docName: string) {
    if (!selectedCompanyId) return;
    if (!confirm(`Excluir "${docName}"? Esta ação não pode ser desfeita.`))
      return;

    setDeleting(docId);
    try {
      const res = await fetch("/api/documents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: docId, companyId: selectedCompanyId }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao excluir");
      }

      toast.success("Documento excluído");
      await loadDocuments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao excluir");
    } finally {
      setDeleting(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleUpload(e.dataTransfer.files);
    }
  }

  // RA document CRUD
  function openRaCreate() {
    setRaEditingId(null);
    setRaDocTitle("");
    setRaDocContent("");
    setRaDialogOpen(true);
  }

  function openRaEdit(doc: DocumentRow) {
    setRaEditingId(doc.id);
    setRaDocTitle(doc.name);
    setRaDocContent(doc.content || "");
    setRaDialogOpen(true);
  }

  async function handleRaSave() {
    if (!selectedCompanyId) return;
    if (!raDocTitle.trim()) {
      toast.error("Título é obrigatório");
      return;
    }

    setRaSaving(true);
    try {
      if (raEditingId) {
        // Update existing document
        const res = await fetch("/api/documents", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: raEditingId,
            companyId: selectedCompanyId,
            name: raDocTitle.trim(),
            content: raDocContent,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Erro ao atualizar");
        }

        toast.success("Documento atualizado");
      } else {
        // Create new RA document
        const res = await fetch("/api/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: selectedCompanyId,
            name: raDocTitle.trim(),
            content: raDocContent,
            channel: "RECLAMEAQUI",
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || "Erro ao criar documento");
        }

        toast.success("Documento criado");
      }

      setRaDialogOpen(false);
      setRaEditingId(null);
      setRaDocTitle("");
      setRaDocContent("");
      await loadDocuments();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar documento");
    } finally {
      setRaSaving(false);
    }
  }

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para gerenciar a Knowledge Base.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Carregando...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Knowledge Base</h1>
        <p className="text-sm text-muted-foreground">
          Gerencie os documentos usados pelo Agente IA para responder perguntas
        </p>
      </div>

      <Tabs defaultValue="geral" className="space-y-4">
        <TabsList>
          <TabsTrigger value="geral" className="gap-1.5">
            <BookOpen className="h-4 w-4" />
            Geral
          </TabsTrigger>
          <TabsTrigger value="reclameaqui" className="gap-1.5">
            <ShieldAlert className="h-4 w-4" />
            Reclame Aqui
          </TabsTrigger>
        </TabsList>

        {/* General Documents Tab */}
        <TabsContent value="geral">
          <div className="space-y-6">
            {/* Upload area */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Upload de Documentos</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
                    dragOver
                      ? "border-primary bg-primary/5"
                      : "border-muted-foreground/25 hover:border-primary/50"
                  }`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="mb-1 text-sm font-medium">
                    Arraste arquivos aqui ou clique para selecionar
                  </p>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Formatos aceitos: PDF, TXT. Tamanho máximo: 10MB
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,application/pdf,text/plain"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files.length > 0) {
                        handleUpload(e.target.files);
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    {uploading ? "Enviando..." : "Selecionar Arquivos"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Documents table */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Documentos ({generalDocs.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {generalDocs.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    Nenhum documento encontrado. Faça upload para começar.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nome</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Tamanho</TableHead>
                        <TableHead>Data Upload</TableHead>
                        <TableHead className="w-16"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {generalDocs.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {mimeIcon(doc.mimeType)}
                              <span className="font-medium">{doc.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>{statusBadge(doc.status)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatFileSize(doc.fileSize)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(doc.createdAt).toLocaleDateString(
                              "pt-BR",
                              {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={deleting === doc.id}
                              onClick={() => handleDelete(doc.id, doc.name)}
                              title="Excluir documento"
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Reclame Aqui Documents Tab */}
        <TabsContent value="reclameaqui">
          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg">
                  Documentos Reclame Aqui ({raDocs.length})
                </CardTitle>
                <Button onClick={openRaCreate} size="sm">
                  <Plus className="mr-2 h-4 w-4" />
                  Novo Documento
                </Button>
              </CardHeader>
              <CardContent>
                {raDocs.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-muted-foreground">
                    Nenhum documento do Reclame Aqui. Clique em &quot;Novo
                    Documento&quot; para criar.
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Título</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Tamanho</TableHead>
                        <TableHead>Data Criação</TableHead>
                        <TableHead className="w-24"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {raDocs.map((doc) => (
                        <TableRow key={doc.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-orange-500" />
                              <span className="font-medium">{doc.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>{statusBadge(doc.status)}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {formatFileSize(doc.fileSize)}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(doc.createdAt).toLocaleDateString(
                              "pt-BR",
                              {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openRaEdit(doc)}
                                title="Editar documento"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={deleting === doc.id}
                                onClick={() => handleDelete(doc.id, doc.name)}
                                title="Excluir documento"
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* RA Document Create/Edit Dialog */}
      <Dialog open={raDialogOpen} onOpenChange={setRaDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {raEditingId
                ? "Editar Documento — Reclame Aqui"
                : "Novo Documento — Reclame Aqui"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="ra-doc-title">Título</Label>
              <Input
                id="ra-doc-title"
                value={raDocTitle}
                onChange={(e) => setRaDocTitle(e.target.value)}
                placeholder="Ex: Política de Reembolso, FAQ Reclame Aqui"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ra-doc-content">Conteúdo (Markdown)</Label>
              <Textarea
                id="ra-doc-content"
                value={raDocContent}
                onChange={(e) => setRaDocContent(e.target.value)}
                placeholder="Escreva o conteúdo do documento em Markdown..."
                rows={15}
                className="font-mono text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRaDialogOpen(false)}
              disabled={raSaving}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleRaSave}
              disabled={raSaving || !raDocTitle.trim()}
            >
              {raSaving ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
