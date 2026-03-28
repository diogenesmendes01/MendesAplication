"use client";

import {
  FileText,
  FileType,
  Pencil,
  Trash2,
  Layers,
  History,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { KBDocument } from "../actions";

interface DocumentListProps {
  documents: KBDocument[];
  onEdit: (doc: KBDocument) => void;
  onDelete: (doc: KBDocument) => void;
  onViewChunks: (doc: KBDocument) => void;
  onViewVersions: (doc: KBDocument) => void;
}

function statusBadge(status: string) {
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
    default:
      return <Badge variant="secondary">{status}</Badge>;
  }
}

function mimeIcon(mimeType: string) {
  if (mimeType === "application/pdf")
    return <FileType className="h-4 w-4 text-red-500" />;
  return <FileText className="h-4 w-4 text-blue-500" />;
}

function formatDate(date: Date) {
  return new Date(date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function DocumentList({
  documents,
  onEdit,
  onDelete,
  onViewChunks,
  onViewVersions,
}: DocumentListProps) {
  if (documents.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-muted-foreground">
        Nenhum documento encontrado.
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Documento</TableHead>
          <TableHead>Categoria / Tags</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Chunks</TableHead>
          <TableHead>Versão</TableHead>
          <TableHead>Atualizado</TableHead>
          <TableHead className="w-12" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {documents.map((doc) => (
          <TableRow key={doc.id} className={!doc.isActive ? "opacity-50" : ""}>
            <TableCell>
              <div className="flex items-center gap-2">
                {mimeIcon(doc.mimeType)}
                <div>
                  <span className="font-medium">{doc.name}</span>
                  {doc.sourceFile && doc.sourceType === "upload" && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      (upload)
                    </span>
                  )}
                </div>
              </div>
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-1">
                {doc.category && (
                  <Badge variant="outline" className="text-xs">
                    {doc.category}
                  </Badge>
                )}
                {doc.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    #{tag}
                  </Badge>
                ))}
              </div>
            </TableCell>
            <TableCell>{statusBadge(doc.status)}</TableCell>
            <TableCell className="text-muted-foreground">
              {doc._count?.chunks ?? "—"}
            </TableCell>
            <TableCell className="text-muted-foreground">v{doc.version}</TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatDate(doc.updatedAt)}
            </TableCell>
            <TableCell>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onEdit(doc)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Editar
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onViewChunks(doc)}>
                    <Layers className="mr-2 h-4 w-4" />
                    Ver Chunks
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => onViewVersions(doc)}>
                    <History className="mr-2 h-4 w-4" />
                    Versões
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => onDelete(doc)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remover
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
