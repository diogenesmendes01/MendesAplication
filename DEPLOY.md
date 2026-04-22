# Deploy — MendesERP com Coolify

## Pré-requisitos

- VPS Ubuntu 22.04+ com mínimo 2GB RAM
- Domínio apontando pro IP do VPS
- Coolify instalado

## 1. Instalar Coolify no VPS

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Acesse `http://IP_DO_VPS:8000` e faça o setup inicial.

## 2. Conectar o repositório

No Coolify:

1. New Resource → Application → GitHub
2. Selecionar `diogenesmendes01/MendesAplication`
3. Branch: `main`
4. Build Pack: **Dockerfile**
5. Dockerfile path: `erp/Dockerfile`
6. Port: `3000`

## 3. Criar serviços de banco

No Coolify:

1. New Resource → Database → PostgreSQL 16
2. New Resource → Database → Redis 7

Copiar as connection strings geradas.

## 4. Configurar variáveis de ambiente

No Coolify → sua aplicação → Environment Variables:

```
DATABASE_URL=<connection string do PostgreSQL do Coolify>
REDIS_URL=<connection string do Redis do Coolify>
JWT_SECRET=$(openssl rand -hex 32)
REFRESH_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
WHATSAPP_SERVICE_API_KEY=<chave aleatória>
WHATSAPP_WEBHOOK_SECRET=<chave aleatória>
NODE_ENV=production
```

## 5. Configurar webhook de deploy automático

No Coolify → sua aplicação → Webhooks → copiar a URL.

No GitHub → repo → Settings → Secrets → adicionar:

- `COOLIFY_WEBHOOK_URL`: URL copiada do Coolify
- `COOLIFY_TOKEN`: API token do Coolify (Settings → API Tokens)

## 6. Primeiro deploy

No Coolify → Deploy agora.

Acompanhe os logs em tempo real. O Prisma migrate deploy roda automaticamente.

## Domínio + SSL

No Coolify → sua aplicação → Domains:

- Adicionar `erp.seudominio.com.br`
- Ativar "Generate SSL Certificate" (Let's Encrypt automático)

## WhatsApp Service

Repetir o processo (passos 2-6) para o `whatsapp-service/`:

- Dockerfile path: `whatsapp-service/Dockerfile`
- Port: `3001`
- Variáveis adicionais: `WHATSAPP_SERVICE_PORT`, `WHATSAPP_WEBHOOK_URL`, etc.
