"use server";

import { prisma } from "@/lib/prisma";
import type { AdditionalContact } from "@prisma/client";
import { requireCompanyAccess } from "@/lib/rbac";
import { requireSession } from "@/lib/session";
import { logAuditEvent } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdditionalContactRow {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  whatsapp: string | null;
  createdAt: string;
}

export interface CreateAdditionalContactInput {
  clientId: string;
  companyId: string;
  name: string;
  role?: string;
  email?: string;
  whatsapp?: string;
}

export interface UpdateAdditionalContactInput {
  contactId: string;
  companyId: string;
  name?: string;
  role?: string | null;
  email?: string | null;
  whatsapp?: string | null;
}

// ---------------------------------------------------------------------------
// Server Actions
// ---------------------------------------------------------------------------

export async function listAdditionalContacts(
  clientId: string,
  companyId: string
): Promise<AdditionalContactRow[]> {
  await requireCompanyAccess(companyId);

  const client = await prisma.client.findFirst({
    where: { id: clientId, companyId },
    select: { id: true },
  });

  if (!client) {
    throw new Error("Cliente não encontrado");
  }

  const contacts = await prisma.additionalContact.findMany({
    where: { clientId },
    orderBy: { name: "asc" },
  });

  return contacts.map((c: AdditionalContact) => ({
    id: c.id,
    name: c.name,
    role: c.role,
    email: c.email,
    whatsapp: c.whatsapp,
    createdAt: c.createdAt.toISOString(),
  }));
}

export async function createAdditionalContact(
  input: CreateAdditionalContactInput
): Promise<AdditionalContactRow> {
  const session = await requireSession();
  await requireCompanyAccess(input.companyId);

  // Validate at least email or whatsapp
  if (!input.email && !input.whatsapp) {
    throw new Error("Informe pelo menos email ou WhatsApp");
  }

  if (!input.name.trim()) {
    throw new Error("Nome é obrigatório");
  }

  // Validate client belongs to company
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, companyId: input.companyId },
    select: { id: true },
  });

  if (!client) {
    throw new Error("Cliente não encontrado");
  }

  const contact = await prisma.additionalContact.create({
    data: {
      clientId: input.clientId,
      name: input.name.trim(),
      role: input.role?.trim() || null,
      email: input.email?.trim() || null,
      whatsapp: input.whatsapp?.trim() || null,
    },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "CREATE",
    entity: "AdditionalContact",
    entityId: contact.id,
    dataAfter: {
      clientId: contact.clientId,
      name: contact.name,
      role: contact.role,
      email: contact.email,
      whatsapp: contact.whatsapp,
    },
    companyId: input.companyId,
  });

  return {
    id: contact.id,
    name: contact.name,
    role: contact.role,
    email: contact.email,
    whatsapp: contact.whatsapp,
    createdAt: contact.createdAt.toISOString(),
  };
}

export async function updateAdditionalContact(
  input: UpdateAdditionalContactInput
): Promise<AdditionalContactRow> {
  const session = await requireSession();
  await requireCompanyAccess(input.companyId);

  // Find existing contact and verify access
  const existing = await prisma.additionalContact.findFirst({
    where: { id: input.contactId },
    include: { client: { select: { companyId: true } } },
  });

  if (!existing || existing.client.companyId !== input.companyId) {
    throw new Error("Contato não encontrado");
  }

  // Build update data
  const updateData: {
    name?: string;
    role?: string | null;
    email?: string | null;
    whatsapp?: string | null;
  } = {};

  if (input.name !== undefined) updateData.name = input.name.trim();
  if (input.role !== undefined) updateData.role = input.role?.trim() || null;
  if (input.email !== undefined) updateData.email = input.email?.trim() || null;
  if (input.whatsapp !== undefined) updateData.whatsapp = input.whatsapp?.trim() || null;

  // Validate at least email or whatsapp after update
  const finalEmail = input.email !== undefined ? updateData.email : existing.email;
  const finalWhatsapp = input.whatsapp !== undefined ? updateData.whatsapp : existing.whatsapp;

  if (!finalEmail && !finalWhatsapp) {
    throw new Error("Informe pelo menos email ou WhatsApp");
  }

  const contact = await prisma.additionalContact.update({
    where: { id: input.contactId },
    data: updateData,
  });

  await logAuditEvent({
    userId: session.userId,
    action: "UPDATE",
    entity: "AdditionalContact",
    entityId: contact.id,
    dataBefore: {
      name: existing.name,
      role: existing.role,
      email: existing.email,
      whatsapp: existing.whatsapp,
    },
    dataAfter: {
      name: contact.name,
      role: contact.role,
      email: contact.email,
      whatsapp: contact.whatsapp,
    },
    companyId: input.companyId,
  });

  return {
    id: contact.id,
    name: contact.name,
    role: contact.role,
    email: contact.email,
    whatsapp: contact.whatsapp,
    createdAt: contact.createdAt.toISOString(),
  };
}

export async function deleteAdditionalContact(
  contactId: string,
  companyId: string
): Promise<void> {
  const session = await requireSession();
  await requireCompanyAccess(companyId);

  const existing = await prisma.additionalContact.findFirst({
    where: { id: contactId },
    include: { client: { select: { companyId: true } } },
  });

  if (!existing || existing.client.companyId !== companyId) {
    throw new Error("Contato não encontrado");
  }

  await prisma.additionalContact.delete({
    where: { id: contactId },
  });

  await logAuditEvent({
    userId: session.userId,
    action: "DELETE",
    entity: "AdditionalContact",
    entityId: contactId,
    dataBefore: {
      clientId: existing.clientId,
      name: existing.name,
      role: existing.role,
      email: existing.email,
      whatsapp: existing.whatsapp,
    },
    companyId,
  });
}
