"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Upload, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/company-context";
import {
  listDocuments,
  createDocument,
  updateDocument,
  deleteDocument,
  getKBStats,
  getAllTags,
} from "./actions";
import type { KBDocument, KBStats } from "./actions";
import {
  KbStatsBar,
  DocumentList,
  DocumentEditor,
  ChunksViewer,
  VersionsViewer,
  SemanticSearch,
  UploadDialog,
} from "./components";

export default function KnowledgeBasePage() {
  const { selectedCompanyId } = useCompany();
  const [documents, setDocuments] = useState<KBDocument[]>([]);
  const [stats, setStats] = useState<KBStats | null>(null);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchFilter, setSearchFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  // Dialogs
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorDoc, setEditorDoc] = useState<KBDocument | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [chunksDoc, setChunksDoc] = useState<KBDocument | null>(null);
  const [versionsDoc, setVersionsDoc] = useState<KBDocument | null>(null);

  const loadAll = useCallback(async () => {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      const filters: Record<string, string> = {};
      if (categoryFilter) filters.category = categoryFilter;
      if (tagFilter) filters.tag = tagFilter;
      if (searchFilter) filters.search = searchFilter;

      const [docs, kbStats, tags] = await Promise.all([
        listDocuments(selectedCompanyId, filters),
        getKBStats(selectedCompanyId),
        getAllTags(selectedCompanyId),
      ]);
      setDocuments(docs);
      setStats(kbStats);
      setAllTags(tags);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao carregar dados"
      );
    } finally {
      setLoading(false);
    }
  }, [selectedCompanyId, categoryFilter, tagFilter, searchFilter]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ─── Handlers ───────────────────────────────────────────────────────────

  function handleNewDocument() {
    setEditorDoc(null);
    setEditorOpen(true);
  }

  function handleEdit(doc: KBDocument) {
    setEditorDoc(doc);
    setEditorOpen(true);
  }

  async function handleSaveDocument(data: {
    name: string;
    content: string;
    category: string;
    tags: string[];
    changeNote: string;
  }) {
    if (!selectedCompanyId) return;

    if (editorDoc) {
      await updateDocument(selectedCompanyId, editorDoc.id, {
        name: data.name,
        content: data.content,
        category: data.category || undefined,
        tags: data.tags,
        changeNote: data.changeNote || undefined,
      });
      toast.success("Documento atualizado");
    } else {
      await createDocument(selectedCompanyId, {
        name: data.name,
        content: data.content,
        category: data.category || undefined,
        tags: data.tags,
      });
      toast.success("Documento criado");
    }
    await loadAll();
  }

  async function handleDelete(doc: KBDocument) {
    if (!selectedCompanyId) return;
    if (!confirm(`Remover "${doc.name}"? O documento será desativado.`)) return;

    try {
      await deleteDocument(selectedCompanyId, doc.id, false);
      toast.success("Documento removido");
      await loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao remover");
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para gerenciar a Knowledge Base.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            📚 Base de Conhecimento
          </h1>
          <p className="text-sm text-muted-foreground">
            Gerencie os documentos usados pelo Agente IA para responder
            perguntas
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setUploadOpen(true)}>
            <Upload className="mr-2 h-4 w-4" />
            Upload
          </Button>
          <Button onClick={handleNewDocument}>
            <Plus className="mr-2 h-4 w-4" />
            Novo Documento
          </Button>
        </div>
      </div>

      {/* Stats */}
      <KbStatsBar stats={stats} />

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 flex-1">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Buscar por nome..."
            className="max-w-xs"
          />
        </div>
        {stats && stats.categories.length > 0 && (
          <Select
            value={categoryFilter || "all"}
            onValueChange={(v) => setCategoryFilter(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas categorias</SelectItem>
              {stats.categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {allTags.length > 0 && (
          <Select
            value={tagFilter || "all"}
            onValueChange={(v) => setTagFilter(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas tags</SelectItem>
              {allTags.map((t) => (
                <SelectItem key={t} value={t}>
                  #{t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Document List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">
            Documentos ({documents.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              Carregando...
            </div>
          ) : (
            <DocumentList
              documents={documents}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onViewChunks={(doc) => setChunksDoc(doc)}
              onViewVersions={(doc) => setVersionsDoc(doc)}
            />
          )}
        </CardContent>
      </Card>

      {/* Semantic Search */}
      <SemanticSearch companyId={selectedCompanyId} />

      {/* Dialogs */}
      <DocumentEditor
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditorDoc(null);
        }}
        onSave={handleSaveDocument}
        title={
          editorDoc ? `✏️ Editar: ${editorDoc.name}` : "📄 Novo Documento"
        }
        initialData={
          editorDoc
            ? {
                name: editorDoc.name,
                content: editorDoc.content || "",
                category: editorDoc.category || "",
                tags: editorDoc.tags,
              }
            : undefined
        }
        existingCategories={stats?.categories || []}
      />

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        companyId={selectedCompanyId}
        onUploaded={loadAll}
        existingCategories={stats?.categories || []}
      />

      {chunksDoc && (
        <ChunksViewer
          open={!!chunksDoc}
          onClose={() => setChunksDoc(null)}
          companyId={selectedCompanyId}
          documentId={chunksDoc.id}
          documentName={chunksDoc.name}
        />
      )}

      {versionsDoc && (
        <VersionsViewer
          open={!!versionsDoc}
          onClose={() => setVersionsDoc(null)}
          companyId={selectedCompanyId}
          documentId={versionsDoc.id}
          documentName={versionsDoc.name}
          currentVersion={versionsDoc.version}
          onRestored={loadAll}
        />
      )}
    </div>
  );
}
