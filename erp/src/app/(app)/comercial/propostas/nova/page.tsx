"use client";

import { useState, useEffect, useCallback, Suspense, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCompany } from "@/contexts/company-context";
import {
  createProposal,
  updateProposal,
  getProposalById,
  listClientsForProposal,
  type ProposalItemInput,
  type ClientOption,
} from "../actions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ItemForm {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateKey(): string {
  return Math.random().toString(36).slice(2, 10);
}

function emptyItem(): ItemForm {
  return { key: generateKey(), description: "", quantity: "1", unitPrice: "" };
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function calculateItemTotal(item: ItemForm): number {
  const qty = parseFloat(item.quantity) || 0;
  const price = parseFloat(item.unitPrice) || 0;
  return qty * price;
}

function calculateTotal(items: ItemForm[]): number {
  return items.reduce((sum, item) => sum + calculateItemTotal(item), 0);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function NovaPropostaPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-12">
        <p className="text-sm text-muted-foreground">Carregando...</p>
      </div>
    }>
      <NovaPropostaContent />
    </Suspense>
  );
}

function NovaPropostaContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");
  const { selectedCompanyId } = useCompany();

  // Form state
  const [clientId, setClientId] = useState("");
  const [paymentConditions, setPaymentConditions] = useState("");
  const [validity, setValidity] = useState("");
  const [observations, setObservations] = useState("");
  const [items, setItems] = useState<ItemForm[]>([emptyItem()]);

  // UI state
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(!!editId);
  const [formError, setFormError] = useState("");

  // ---------------------------------------------------
  // Load clients
  // ---------------------------------------------------

  const loadClients = useCallback(async () => {
    if (!selectedCompanyId) return;
    try {
      const result = await listClientsForProposal(selectedCompanyId);
      setClients(result);
    } catch {
      toast.error("Erro ao carregar clientes");
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    loadClients();
  }, [loadClients]);

  // ---------------------------------------------------
  // Load proposal for editing
  // ---------------------------------------------------

  useEffect(() => {
    if (!editId || !selectedCompanyId) return;

    async function loadProposal() {
      try {
        const proposal = await getProposalById(editId!, selectedCompanyId!);
        setClientId(proposal.clientId);
        setPaymentConditions(proposal.paymentConditions ?? "");
        setValidity(
          proposal.validity
            ? proposal.validity.split("T")[0]
            : ""
        );
        setObservations(proposal.observations ?? "");
        setItems(
          proposal.items.map((item) => ({
            key: generateKey(),
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          }))
        );
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Erro ao carregar proposta"
        );
        router.push("/comercial/propostas");
      } finally {
        setLoading(false);
      }
    }

    loadProposal();
  }, [editId, selectedCompanyId, router]);

  // ---------------------------------------------------
  // Item management
  // ---------------------------------------------------

  function addItem() {
    setItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(key: string) {
    setItems((prev) => {
      if (prev.length <= 1) return prev;
      return prev.filter((item) => item.key !== key);
    });
  }

  function updateItem(key: string, field: keyof Omit<ItemForm, "key">, value: string) {
    setItems((prev) =>
      prev.map((item) =>
        item.key === key ? { ...item, [field]: value } : item
      )
    );
  }

  // ---------------------------------------------------
  // Submit
  // ---------------------------------------------------

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedCompanyId) return;
    setFormError("");
    setSaving(true);

    try {
      const proposalItems: ProposalItemInput[] = items.map((item) => ({
        description: item.description,
        quantity: parseFloat(item.quantity) || 0,
        unitPrice: parseFloat(item.unitPrice) || 0,
      }));

      if (editId) {
        await updateProposal(
          {
            id: editId,
            clientId,
            paymentConditions: paymentConditions || undefined,
            validity: validity || undefined,
            observations: observations || undefined,
            items: proposalItems,
          },
          selectedCompanyId
        );
        toast.success("Proposta atualizada com sucesso");
      } else {
        await createProposal(
          {
            clientId,
            paymentConditions: paymentConditions || undefined,
            validity: validity || undefined,
            observations: observations || undefined,
            items: proposalItems,
          },
          selectedCompanyId
        );
        toast.success("Proposta salva como rascunho");
      }

      router.push("/comercial/propostas");
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Erro ao salvar proposta"
      );
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------
  // Filtered clients
  // ---------------------------------------------------

  const filteredClients = clientSearch
    ? clients.filter((c) =>
        c.name.toLowerCase().includes(clientSearch.toLowerCase())
      )
    : clients;

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------

  if (!selectedCompanyId) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Selecione uma empresa para criar uma proposta.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        Carregando proposta...
      </div>
    );
  }

  const total = calculateTotal(items);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push("/comercial/propostas")}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {editId ? "Editar Proposta" : "Nova Proposta"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {editId
              ? "Altere os dados da proposta."
              : "Preencha os dados para criar uma nova proposta."}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Client & basic info */}
        <Card>
          <CardHeader>
            <CardTitle>Dados da Proposta</CardTitle>
            <CardDescription>Selecione o cliente e preencha as condições.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Client selector */}
            <div className="space-y-2">
              <Label>Cliente *</Label>
              <Select
                value={clientId}
                onValueChange={setClientId}
                disabled={saving}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um cliente" />
                </SelectTrigger>
                <SelectContent>
                  <div className="p-2">
                    <Input
                      placeholder="Buscar cliente..."
                      value={clientSearch}
                      onChange={(e) => setClientSearch(e.target.value)}
                      className="mb-2"
                    />
                  </div>
                  {filteredClients.length === 0 ? (
                    <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                      Nenhum cliente encontrado.{" "}
                      <button
                        type="button"
                        className="text-primary underline"
                        onClick={() => router.push("/comercial/clientes")}
                      >
                        Cadastrar novo cliente
                      </button>
                    </div>
                  ) : (
                    filteredClients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {/* Payment conditions */}
              <div className="space-y-2">
                <Label htmlFor="paymentConditions">Condições de Pagamento</Label>
                <Input
                  id="paymentConditions"
                  value={paymentConditions}
                  onChange={(e) => setPaymentConditions(e.target.value)}
                  placeholder="Ex: 30/60/90 dias"
                  disabled={saving}
                />
              </div>

              {/* Validity */}
              <div className="space-y-2">
                <Label htmlFor="validity">Validade da Proposta</Label>
                <Input
                  id="validity"
                  type="date"
                  value={validity}
                  onChange={(e) => setValidity(e.target.value)}
                  disabled={saving}
                />
              </div>
            </div>

            {/* Observations */}
            <div className="space-y-2">
              <Label htmlFor="observations">Observações</Label>
              <Textarea
                id="observations"
                value={observations}
                onChange={(e) => setObservations(e.target.value)}
                placeholder="Observações adicionais..."
                rows={3}
                disabled={saving}
              />
            </div>
          </CardContent>
        </Card>

        {/* Items */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Itens da Proposta</CardTitle>
                <CardDescription>
                  Adicione os itens com descrição, quantidade e preço unitário.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addItem}
                disabled={saving}
              >
                <Plus className="mr-1 h-4 w-4" />
                Adicionar Item
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Descrição</TableHead>
                    <TableHead className="w-[15%]">Quantidade</TableHead>
                    <TableHead className="w-[20%]">Preço Unitário (R$)</TableHead>
                    <TableHead className="w-[15%] text-right">Subtotal</TableHead>
                    <TableHead className="w-[10%]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.key}>
                      <TableCell>
                        <Input
                          value={item.description}
                          onChange={(e) =>
                            updateItem(item.key, "description", e.target.value)
                          }
                          placeholder="Descrição do item"
                          disabled={saving}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={item.quantity}
                          onChange={(e) =>
                            updateItem(item.key, "quantity", e.target.value)
                          }
                          disabled={saving}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) =>
                            updateItem(item.key, "unitPrice", e.target.value)
                          }
                          placeholder="0.00"
                          disabled={saving}
                        />
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatBRL(calculateItemTotal(item))}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItem(item.key)}
                          disabled={saving || items.length <= 1}
                          title="Remover item"
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Total */}
            <div className="mt-4 flex justify-end">
              <div className="rounded-lg bg-muted px-6 py-3 text-right">
                <p className="text-sm text-muted-foreground">Total da Proposta</p>
                <p className="text-2xl font-bold">{formatBRL(total)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Error message */}
        {formError && (
          <p className="text-sm text-destructive">{formError}</p>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/comercial/propostas")}
            disabled={saving}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={saving}>
            {saving
              ? "Salvando..."
              : editId
                ? "Salvar Alterações"
                : "Salvar como Rascunho"}
          </Button>
        </div>
      </form>
    </div>
  );
}
