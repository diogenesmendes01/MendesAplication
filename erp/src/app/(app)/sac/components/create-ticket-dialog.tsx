"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTicket } from "../tickets/actions";
import type { TicketPriority } from "@prisma/client";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CreateTicketDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  clients: { id: string; name: string }[];
  users: { id: string; name: string }[];
  onCreated: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateTicketDialog({
  open,
  onOpenChange,
  companyId,
  clients,
  users,
  onCreated,
}: CreateTicketDialogProps) {
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [formClientId, setFormClientId] = useState("");
  const [formSubject, setFormSubject] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPriority, setFormPriority] = useState<TicketPriority>("MEDIUM");
  const [formAssigneeId, setFormAssigneeId] = useState("");

  function resetForm() {
    setFormClientId("");
    setFormSubject("");
    setFormDescription("");
    setFormPriority("MEDIUM");
    setFormAssigneeId("");
    setFormError("");
  }

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) {
      resetForm();
    }
    onOpenChange(nextOpen);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError("");
    setSaving(true);

    try {
      await createTicket({
        companyId,
        clientId: formClientId,
        subject: formSubject,
        description: formDescription,
        priority: formPriority,
        assigneeId: formAssigneeId || undefined,
      });
      toast.success("Ticket criado com sucesso");
      onOpenChange(false);
      onCreated();
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Erro ao criar ticket"
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo Ticket</DialogTitle>
          <DialogDescription>
            Abra um novo ticket de atendimento ao cliente.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="clientId">Cliente *</Label>
            <Select
              value={formClientId || "__none__"}
              onValueChange={(v) =>
                setFormClientId(v === "__none__" ? "" : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um cliente" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" disabled>
                  Selecione um cliente
                </SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Assunto *</Label>
            <Input
              id="subject"
              value={formSubject}
              onChange={(e) => setFormSubject(e.target.value)}
              required
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Descrição *</Label>
            <Textarea
              id="description"
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              rows={4}
              required
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority">Prioridade</Label>
            <Select
              value={formPriority}
              onValueChange={(v) => setFormPriority(v as TicketPriority)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="HIGH">Alta</SelectItem>
                <SelectItem value="MEDIUM">Média</SelectItem>
                <SelectItem value="LOW">Baixa</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="assigneeId">Responsável</Label>
            <Select
              value={formAssigneeId || "__none__"}
              onValueChange={(v) =>
                setFormAssigneeId(v === "__none__" ? "" : v)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecione um respons\u00e1vel" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Nenhum</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {formError && (
            <p className="text-sm text-destructive">{formError}</p>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Salvando..." : "Criar Ticket"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
