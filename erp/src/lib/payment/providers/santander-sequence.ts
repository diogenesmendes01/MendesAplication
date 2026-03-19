import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'

const MAX_BANK_NUMBER = 9_999_999_999_999 // 13 digits max
const BANK_NUMBER_PATTERN = /^[0-9]{1,13}$/

/**
 * Atomically increments and returns the next bank number (nosso número)
 * for a given company + covenant combination.
 *
 * Uses Prisma interactive transaction with Serializable isolation
 * to prevent race conditions on concurrent boleto creation.
 *
 * @returns The next bank number as a numeric string (1–13 digits)
 * @throws Error if the sequence exceeds 13 digits
 */
export async function getNextBankNumber(
  companyId: string,
  covenantCode: string,
): Promise<string> {
  const MAX_RETRIES = 3
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const existing = await tx.santanderSequence.findUnique({
            where: {
              companyId_covenantCode: { companyId, covenantCode },
            },
          })

          let nextNumber: number

          if (existing) {
            nextNumber = existing.lastNumber + 1

            if (nextNumber > MAX_BANK_NUMBER) {
              throw new Error(
                `Sequência de nosso número esgotada para convênio ${covenantCode} (máximo: ${MAX_BANK_NUMBER})`,
              )
            }

            await tx.santanderSequence.update({
              where: {
                companyId_covenantCode: { companyId, covenantCode },
              },
              data: { lastNumber: nextNumber },
            })
          } else {
            nextNumber = 1

            await tx.santanderSequence.create({
              data: {
                companyId,
                covenantCode,
                lastNumber: nextNumber,
              },
            })
          }

          return String(nextNumber)
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      )
    } catch (err) {
      // Retry on serialization failure (P2034)
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2034' &&
        attempt < MAX_RETRIES - 1
      ) {
        continue
      }
      throw err
    }
  }
  // Unreachable, but TypeScript needs it
  throw new Error('getNextBankNumber: max retries exceeded')
}

/**
 * Manually sets the last bank number for a given company + covenant.
 * Useful for companies migrating from an existing numbering sequence.
 *
 * @param number - The last used bank number (next generated will be number + 1)
 * @throws Error if number is invalid (not 1–13 digit numeric string)
 */
export async function setLastBankNumber(
  companyId: string,
  covenantCode: string,
  number: number,
): Promise<void> {
  if (!Number.isInteger(number) || number < 0 || number > MAX_BANK_NUMBER) {
    throw new Error(
      `Número inválido: ${number}. Deve ser inteiro entre 0 e ${MAX_BANK_NUMBER}.`,
    )
  }

  const numberStr = String(number)
  if (!BANK_NUMBER_PATTERN.test(numberStr) && number !== 0) {
    throw new Error(
      `Número inválido: ${number}. Deve conter apenas dígitos (1–13).`,
    )
  }

  await prisma.santanderSequence.upsert({
    where: {
      companyId_covenantCode: { companyId, covenantCode },
    },
    create: {
      companyId,
      covenantCode,
      lastNumber: number,
    },
    update: {
      lastNumber: number,
    },
  })
}
