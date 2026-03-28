"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
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

interface DocumentEditorProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: {
    name: string;
    content: string;
    category: string;
    tags: string[];
    changeNote: string;
  }) => Promise<void>;
  initialData?: {
    name: string;
    content: string;
    category: string;
    tags: string[];
  };
  title: string;
  existingCategories?: string[];
}

export function DocumentEditor({
  open,
  onClose,
  onSave,
  initialData,
  title,
  existingCategories = [],
}: DocumentEditorProps) {
  const [name, setName] = useState(initialData?.name || "");
  const [content, setContent] = useState(initialData?.content || "");
  const [category, setCategory] = useState(initialData?.category || "");
  const [tags, setTags] = useState<string[]>(initialData?.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [saving, setSaving] = useState(false);

  function addTag() {
    const tag = tagInput
      .trim()
      .toLowerCase()
      .replace(/[^a-záàãâéêíóôõúüç0-9-_]/g, "");
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag]);
    }
    setTagInput("");
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag));
  }

  async function handleSave() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        content,
        category: category.trim(),
        tags,
        changeNote: changeNote.trim(),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="doc-name">Título</Label>
              <Input
                id="doc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do documento"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-category">Categoria</Label>
              <Input
                id="doc-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Ex: Financeiro > Cobranças"
                list="category-suggestions"
              />
              {existingCategories.length > 0 && (
                <datalist id="category-suggestions">
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
                  <button onClick={() => removeTag(tag)} className="ml-0.5">
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

          {initialData && (
            <div className="space-y-2">
              <Label htmlFor="change-note">Nota da alteração</Label>
              <Input
                id="change-note"
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                placeholder="O que mudou nesta versão?"
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="doc-content">Conteúdo (Markdown)</Label>
            <Textarea
              id="doc-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Escreva o conteúdo do documento..."
              rows={18}
              className="font-mono text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
