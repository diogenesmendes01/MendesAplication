"use client";

import { useState, useEffect, useCallback, type FormEvent } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  listSharingGroups,
  listAvailableCompanies,
  createSharingGroup,
  updateSharingGroup,
  deleteSharingGroup,
  type SharingGroup,
  type CompanyOption,
} from "./actions";

export default function CompartilhamentoPage() {
  const [groups, setGroups] = useState<SharingGroup[]>([]);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Delete confirm dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<SharingGroup | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [groupsData, companiesData] = await Promise.all([
        listSharingGroups(),
        listAvailableCompanies(),
      ]);
      setGroups(groupsData);
      setCompanies(companiesData);
    } catch {
      toast.error("Erro ao carregar dados de compartilhamento");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function openCreate() {
    setEditingId(null);
    setFormName("");
    setSelectedCompanyIds([]);
    setDialogOpen(true);
  }

  function openEdit(group: SharingGroup) {
    setEditingId(group.id);
    setFormName(group.name);
    setSelectedCompanyIds(group.companies.map((c) => c.id));
    setDialogOpen(true);
  }

  function openDelete(group: SharingGroup) {
    setDeletingGroup(group);
    setDeleteDialogOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (selectedCompanyIds.length < 2) {
      toast.error("Selecione pelo menos 2 empresas");
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        await updateSharingGroup(editingId, formName, selectedCompanyIds);
        toast.success("Grupo atualizado com sucesso");
      } else {
        await createSharingGroup(formName, selectedCompanyIds);
        toast.success("Grupo criado com sucesso");
      }
      setDialogOpen(false);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar grupo");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deletingGroup) return;
    try {
      await deleteSharingGroup(deletingGroup.id);
      toast.success("Grupo removido com sucesso");
      setDeleteDialogOpen(false);
      setDeletingGroup(null);
      await loadData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao remover grupo"
      );
    }
  }

  function toggleCompany(companyId: string) {
    setSelectedCompanyIds((prev) =>
      prev.includes(companyId)
        ? prev.filter((id) => id !== companyId)
        : [...prev, companyId]
    );
  }

  // Determine which companies are available for selection
  // (not in another group, or in the current group being edited)
  function isCompanyAvailable(company: CompanyOption): boolean {
    if (!company.sharedClientGroupId) return true;
    if (editingId && company.sharedClientGroupId === editingId) return true;
    // Check if the company is in a group that's currently being edited
    return false;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Compartilhamento de Clientes</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure quais empresas compartilham a base de clientes entre si
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" />
          Novo Grupo
        </Button>
      </div>

      {loading ? (
        <p className="text-muted-foreground">Carregando...</p>
      ) : groups.length === 0 ? (
        <div className="text-center py-12 border rounded-md">
          <Users className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">
            Nenhum grupo de compartilhamento
          </h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Crie um grupo para permitir que empresas compartilhem seus clientes
          </p>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            Criar Grupo
          </Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Grupo</TableHead>
                <TableHead>Empresas</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((group) => (
                <TableRow key={group.id}>
                  <TableCell className="font-medium">{group.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {group.companies.map((c) => (
                        <Badge key={c.id} variant="secondary">
                          {c.nomeFantasia}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(group)}
                        title="Editar"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openDelete(group)}
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Editar Grupo" : "Novo Grupo de Compartilhamento"}
            </DialogTitle>
            <DialogDescription>
              Empresas no mesmo grupo compartilham a base de clientes. Cada
              empresa só pode pertencer a um grupo.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="groupName">Nome do Grupo</Label>
              <Input
                id="groupName"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ex: Grupo Mendes"
                required
              />
            </div>
            <div className="space-y-2">
              <Label>
                Empresas ({selectedCompanyIds.length} selecionadas)
              </Label>
              <div className="border rounded-md p-3 space-y-2 max-h-[300px] overflow-y-auto">
                {companies.map((company) => {
                  const available = isCompanyAvailable(company);
                  const checked = selectedCompanyIds.includes(company.id);
                  return (
                    <div
                      key={company.id}
                      className="flex items-center space-x-2"
                    >
                      <Checkbox
                        id={`company-${company.id}`}
                        checked={checked}
                        disabled={!available && !checked}
                        onCheckedChange={() => toggleCompany(company.id)}
                      />
                      <label
                        htmlFor={`company-${company.id}`}
                        className={`text-sm cursor-pointer flex-1 ${
                          !available && !checked
                            ? "text-muted-foreground"
                            : ""
                        }`}
                      >
                        {company.nomeFantasia}{" "}
                        <span className="text-muted-foreground">
                          ({company.cnpj})
                        </span>
                        {!available && !checked && (
                          <span className="text-xs text-orange-500 ml-2">
                            (já em outro grupo)
                          </span>
                        )}
                      </label>
                    </div>
                  );
                })}
                {companies.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Nenhuma empresa ativa encontrada
                  </p>
                )}
              </div>
              {selectedCompanyIds.length > 0 &&
                selectedCompanyIds.length < 2 && (
                  <p className="text-sm text-destructive">
                    Selecione pelo menos 2 empresas
                  </p>
                )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={saving || selectedCompanyIds.length < 2}
              >
                {saving ? "Salvando..." : editingId ? "Salvar" : "Criar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja excluir o grupo &quot;{deletingGroup?.name}
              &quot;? As empresas deixarão de compartilhar clientes, mas os
              clientes existentes não serão removidos.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Excluir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
