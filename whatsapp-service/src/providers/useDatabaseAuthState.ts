import {
  AuthenticationCreds,
  AuthenticationState,
  initAuthCreds,
  BufferJSON,
  SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

/**
 * Database-backed auth state for Baileys.
 *
 * Replaces `useMultiFileAuthState` by persisting credentials in PostgreSQL
 * via Prisma instead of individual files (which cause high I/O).
 *
 * Adapted from the Baileys official implementation:
 * @see https://github.com/WhiskeySockets/Baileys/blob/master/src/Utils/use-multi-file-auth-state.ts
 */

export async function useDatabaseAuthState(companyId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
}> {
  // In-memory cache for performance
  const memoryCache = new Map<string, unknown>();

  // ============================================
  // HELPER: Read Key
  // ============================================

  const readKey = async (keyId: string): Promise<unknown> => {
    if (memoryCache.has(keyId)) {
      return memoryCache.get(keyId);
    }

    try {
      const row = await prisma.baileysAuthState.findFirst({
        where: { companyId, keyId },
        select: { keyData: true },
      });

      if (!row) {
        return null;
      }

      const value = row.keyData;
      memoryCache.set(keyId, value);
      return value;
    } catch (err) {
      console.error("[useDatabaseAuthState] Error reading key", {
        companyId,
        keyId,
        error: err instanceof Error ? err.message : err,
      });
      return null;
    }
  };

  // ============================================
  // HELPER: Write Key
  // ============================================

  const writeKey = async (keyId: string, value: unknown): Promise<void> => {
    try {
      memoryCache.set(keyId, value);

      // Determine keyType based on keyId
      let keyType = "other";
      if (keyId === "creds") {
        keyType = "creds";
      } else if (keyId.startsWith("app-state-sync-key-")) {
        keyType = "app-state-sync-key";
      } else if (keyId.startsWith("app-state-sync-version-")) {
        keyType = "app-state-sync-version";
      } else if (keyId.startsWith("session-")) {
        keyType = "session";
      } else if (keyId.startsWith("pre-key-")) {
        keyType = "pre-key";
      } else if (keyId.startsWith("sender-key-")) {
        keyType = "sender-key";
      } else if (keyId.startsWith("sender-key-memory-")) {
        keyType = "sender-key-memory";
      }

      await prisma.baileysAuthState.upsert({
        where: {
          companyId_keyType_keyId: { companyId, keyType, keyId },
        },
        update: {
          keyData: value as Prisma.InputJsonValue,
        },
        create: {
          companyId,
          keyType,
          keyId,
          keyData: value as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      console.error("[useDatabaseAuthState] Error writing key", {
        companyId,
        keyId,
        error: err instanceof Error ? err.message : err,
      });
    }
  };

  // ============================================
  // HELPER: Remove Key
  // ============================================

  const removeKey = async (keyId: string): Promise<void> => {
    try {
      memoryCache.delete(keyId);

      await prisma.baileysAuthState.deleteMany({
        where: { companyId, keyId },
      });
    } catch (err) {
      console.error("[useDatabaseAuthState] Error removing key", {
        companyId,
        keyId,
        error: err instanceof Error ? err.message : err,
      });
    }
  };

  // ============================================
  // Load or initialize credentials
  // ============================================

  const credsData = await readKey("creds");
  const creds: AuthenticationCreds = credsData
    ? JSON.parse(JSON.stringify(credsData), BufferJSON.reviver)
    : initAuthCreds();

  // ============================================
  // AUTH STATE
  // ============================================

  return {
    state: {
      creds,
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[]
        ) => {
          const data: { [id: string]: SignalDataTypeMap[T] } = {};

          // LID mappings stored in dedicated table
          if (type === "lid-mapping") {
            try {
              const lidMappings = await prisma.lidMapping.findMany({
                where: {
                  companyId,
                  lid: { in: ids },
                },
                select: { lid: true, phoneNumber: true },
              });

              for (const mapping of lidMappings) {
                (data as Record<string, unknown>)[mapping.lid] =
                  mapping.phoneNumber;
              }
            } catch (err) {
              console.error(
                "[useDatabaseAuthState] Error fetching LID mappings",
                {
                  companyId,
                  error: err instanceof Error ? err.message : err,
                }
              );
            }

            return data;
          }

          // For all other types, use baileys_auth_state
          await Promise.all(
            ids.map(async (id) => {
              const keyId = `${type}.${id}`;
              const value = await readKey(keyId);
              if (value) {
                // Reconstruct Buffers for binary key types
                if (
                  type === "pre-key" ||
                  type === "session" ||
                  type === "sender-key" ||
                  type === "sender-key-memory" ||
                  type === "tctoken" ||
                  type === "device-list"
                ) {
                  (data as Record<string, unknown>)[id] = JSON.parse(
                    JSON.stringify(value),
                    BufferJSON.reviver
                  );
                } else {
                  (data as Record<string, unknown>)[id] = value;
                }
              }
            })
          );

          return data;
        },

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        set: async (data: any) => {
          const promises: Promise<void>[] = [];

          for (const type in data) {
            const category = data[type];

            // LID mappings stored in dedicated table
            if (type === "lid-mapping") {
              for (const lid in category) {
                const phoneNumber = category[lid];

                if (phoneNumber === null || phoneNumber === undefined) {
                  promises.push(
                    (async () => {
                      try {
                        await prisma.lidMapping.deleteMany({
                          where: { companyId, lid },
                        });
                      } catch (err) {
                        console.error(
                          "[useDatabaseAuthState] Error removing LID mapping",
                          {
                            companyId,
                            lid,
                            error: err instanceof Error ? err.message : err,
                          }
                        );
                      }
                    })()
                  );
                } else {
                  promises.push(
                    (async () => {
                      try {
                        await prisma.lidMapping.upsert({
                          where: {
                            companyId_lid: { companyId, lid },
                          },
                          update: { phoneNumber: phoneNumber as string },
                          create: {
                            companyId,
                            lid,
                            phoneNumber: phoneNumber as string,
                          },
                        });
                      } catch (err) {
                        console.error(
                          "[useDatabaseAuthState] Error saving LID mapping",
                          {
                            companyId,
                            lid,
                            error: err instanceof Error ? err.message : err,
                          }
                        );
                      }
                    })()
                  );
                }
              }
              continue;
            }

            // For all other types, use baileys_auth_state
            for (const id in category) {
              const value = category[id];
              const keyId = `${type}.${id}`;

              if (value === null || value === undefined) {
                promises.push(removeKey(keyId));
              } else {
                // Serialize Buffers correctly
                const serialized = JSON.parse(
                  JSON.stringify(value, BufferJSON.replacer)
                );
                promises.push(writeKey(keyId, serialized));
              }
            }
          }

          await Promise.all(promises);
        },
      },
    },

    saveCreds: async () => {
      const serialized = JSON.parse(
        JSON.stringify(creds, BufferJSON.replacer)
      );
      await writeKey("creds", serialized);
    },
  };
}
