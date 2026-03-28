"use client";

import { useState, useRef } from "react";
import { Upload, Loader2, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { uploadAndExtractText, createDocument } from "../actions";

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  onUploaded: () => void;
  existingCategories?: string[];
}

const ACCEPT_STRING =
  ".pdf,.txt,.csv,.docx,.doc,.xlsx,.xls,application/pdf,text/plain,text/csv";

type UploadStep = "select" | "review";

export function UploadDialog({
  open,
  onClose,
  companyId,
  onUploaded,
  existingCategories = [],
}: UploadDialogProps) {
  const [step, setStep] = useState<UploadStep>("select");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Review step state
  const [fileName, setFileName] = useState("");
  const [name, setName] = useState("");
  const [extractedText, setExtractedText] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  function resetState() {
    setStep("select");
    setFileName("");
    setName("");
    setExtractedText("");
    setCategory("");
    setTags([]);
    setTagInput("");
  }

  function handleClose() {
    resetState();
    onClose();
  }

  async function processFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      toast.error(`Arquivo muito grande: ${file.name}. Limite: 10MB`);
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const result = await uploadAndExtractText(formData);
      setFileName(result.fileName);
      setName(result.fileName.replace(/\.[^/.]+$/, ""));
      setExtractedText(result.extractedText);
      setStep("review");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro no upload");
    } finally {
      setUploading(false);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await createDocument(companyId, {
        name: name.trim(),
        content: extractedText,
        category: category.trim() || undefined,
        tags,
      });
      toast.success("Documento salvo com sucesso");
      onUploaded();
      handleClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function addTag() {
    const tag = tagInput
      .trim()
      .toLowerCase()
      .replace(/[^a-záàãâéêíóôõúüç0-9-_]/g, "");
    if (tag && !tags.includes(tag)) setTags([...tags, tag]);
    setTagInput("");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {step === "select"
              ? "📎 Upload de Arquivo"
              : "📎 Revisar Texto Extraído"}
          </DialogTitle>
        </DialogHeader>

        {step === "select" && (
          <div className="py-4">
            <div
              className={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 transition-colors ${
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
              {uploading ? (
                <>
                  <Loader2 className="mb-3 h-8 w-8 animate-spin text-muted-foreground" />
                  <p className="text-sm">Extraindo texto...</p>
                </>
              ) : (
                <>
                  <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
                  <p className="mb-1 text-sm font-medium">
                    Arraste um arquivo aqui ou clique para selecionar
                  </p>
                  <p className="mb-3 text-xs text-muted-foreground">
                    PDF, DOCX, TXT, CSV, XLSX — Máximo: 10MB
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={ACCEPT_STRING}
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files?.[0]) processFile(e.target.files[0]);
                    }}
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Selecionar Arquivo
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4 py-2">
            <div className="rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 p-3 text-sm">
              ✅ Texto extraído de <strong>{fileName}</strong> (
              {extractedText.length.toLocaleString()} caracteres). Revise antes
              de salvar.
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="upload-name">Título</Label>
                <Input
                  id="upload-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="upload-category">Categoria</Label>
                <Input
                  id="upload-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Ex: Comercial > Preços"
                  list="upload-cat-suggestions"
                />
                {existingCategories.length > 0 && (
                  <datalist id="upload-cat-suggestions">
                    {existingCategories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="gap-1">
                    #{tag}
                    <button
                      onClick={() => setTags(tags.filter((t) => t !== tag))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                <div className="flex items-center gap-1">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag();
                      }
                    }}
                    placeholder="Adicionar tag..."
                    className="h-7 w-32 text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={addTag}
                  >
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="upload-content">Texto Extraído (editável)</Label>
              <Textarea
                id="upload-content"
                value={extractedText}
                onChange={(e) => setExtractedText(e.target.value)}
                rows={14}
                className="font-mono text-sm"
              />
            </div>
          </div>
        )}

        {step === "review" && (
          <DialogFooter>
            <Button variant="outline" onClick={handleClose} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              {saving ? "Salvando..." : "Salvar Documento"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
