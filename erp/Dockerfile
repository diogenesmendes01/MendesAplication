# Stage 1: deps
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Stage 2: builder
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Dummy URL for prisma generate (only generates client, no DB connection needed)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN mkdir -p public
RUN npx prisma generate
RUN npm run build

# Stage 3: runner
FROM node:20-alpine AS runner
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public/
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
# Prisma CLI + config for migrate deploy at runtime
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=builder /app/node_modules/effect ./node_modules/effect
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts

USER nextjs
EXPOSE 3000
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 CMD wget -q --spider http://localhost:3000/api/health || exit 1

# Use project's prisma (not npx which fetches latest)
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && node server.js"]
