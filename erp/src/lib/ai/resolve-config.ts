import { prisma } from "@/lib/prisma";
import type { ChannelType } from "@prisma/client";

/**
 * Resolve the effective AI config for a company + channel.
 * Tries channel-specific config first, falls back to global (channel=null).
 * Returns null if no config exists at all.
 *
 * Accepts an optional Prisma select clause to narrow the returned fields
 * (useful in workers that only need a subset of columns).
 */
export async function resolveAiConfig(
  companyId: string,
  channel?: ChannelType | null,
) {
  if (channel) {
    const channelConfig = await prisma.aiConfig.findFirst({
      where: { companyId, channel },
    });
    if (channelConfig) return channelConfig;
  }

  return prisma.aiConfig.findFirst({
    where: { companyId, channel: null },
  });
}

/**
 * Variant that accepts a Prisma `select` clause for narrowing fields.
 * Used by workers that only need a subset of columns.
 */
export async function resolveAiConfigSelect<T extends Record<string, boolean>>(
  companyId: string,
  channel: ChannelType,
  select: T,
) {
  const channelConfig = await prisma.aiConfig.findFirst({
    where: { companyId, channel },
    select,
  });

  if (channelConfig) return channelConfig;

  return prisma.aiConfig.findFirst({
    where: { companyId, channel: null },
    select,
  });
}
