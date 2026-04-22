# Coolify & VPS Infrastructure

## Servers

### srv1455611 (This Server)
- **Role**: Main agent server, monitoring hub
- **IP**: 69.62.93.243
- **OS**: Ubuntu, openclaw-gateway running

### VPS (168.231.92.229)
- **Role**: Coolify host, container runtime
- **SSH**: root@168.231.92.229 / password: 741952863@Julho15
- **Coolify**: v4.0.0-beta.444 at http://localhost:8000/api/v1/
- **Coolify DB**: container `coolify-db`, database `coolify`

---

## Coolify Apps

| App | UUID | FQDN | Repo | Status |
|---|---|---|---|---|
| MendesERP (boletoapi) | ygs0kks0sw8w048wcgw8wos0 | https://boletoapi.com | diogenesmendes01/MendesAplication | running:healthy |
| CNPJ API | fko80gc4gkk8k40osw04c0so | https://cnpj.boletoapi.com | diogenesmendes01/api-cnpj-v2 | running:healthy |
| API Boleto | c4kcw048wkwos8ks0ggkwkko | https://api.boletoapi.com | diogenesmendes01/sobre-facil-api | running:healthy |
| WhatsApp Service | zskog8c8gkw0sk4s04gs4goc | - | - | running:healthy |
| Genius Idiomas | wskw8ww4ogk8c8ko0kg8go08 | https://geniusidiomas.com | diogenesmendes01/genius-site | running:healthy |
| Trustcloud | qo4wooccgcokg8sow8wc0w0w | https://trustcloudsystem.com | diogenesmendes01/trustcloud | running:unhealthy |
| Certshift | hcsw8o4gwkg0gscwkoksgosw | https://certshiftsoftware.com.br | diogenesmendes01/front-certshift | running:unhealthy |
| PIXELLIBER | zsg4s0gcog408c48wg0sg00s | http://pixelliber.168.231.92.229.sslip.io | - | - |

---

## Coolify API

- **Token**: `3|icmbWqhbtxiXUDuW3xv8gMyXtL6MIytaLuasq13b2cddf2b7`
- **Endpoint**: `http://localhost:8000/api/v1/`
- **Auth**: `Authorization: Bearer <token>`
- **Note**: API only accessible from within VPS (localhost)

### Useful API Calls

```bash
# List all apps
curl -s -H "Authorization: Bearer <token>" http://localhost:8000/api/v1/applications

# Get single app
curl -s -H "Authorization: Bearer <token>" http://localhost:8000/api/v1/applications/<uuid>

# Get app deployments
curl -s -H "Authorization: Bearer <token>" http://localhost:8000/api/v1/applications/<uuid>/deployments
```

---

## VPS Containers (Docker)

### Core Coolify
- coolify
- coolify-proxy (TRAEFIK)
- coolify-db
- coolify-redis
- coolify-sentinel
- coolify-realtime

### Application Containers
Container names have timestamp suffixes that change on each deploy:

| App Prefix | Example Container Name | Image |
|---|---|---|
| ygs0kks0sw8w048wcgw8wos0 | ygs0kks0sw8w048wcgw8wos0-163014689822 | MendesERP |
| backend-fko80gc4gkk8k40osw04c0so | backend-fko80gc4gkk8k40osw04c0so-005337610922 | CNPJ API |
| frontend-fko80gc4gkk8k40osw04c0so | frontend-fko80gc4gkk8k40osw04c0so-005337627848 | CNPJ Frontend |
| api-boletoapi | api-boletoapi | API Boleto |
| zskog8c8gkw0sk4s04gs4goc | zskog8c8gkw0sk4s04gs4goc-163014892215 | WhatsApp Service |

### Standalone Containers (not via Coolify)
- codewave-site (wordpress:6.9-php8.2-apache) - 3 weeks
- codewave-db (mysql:8.0)
- q10-dashboard, q10-proxy, q10-form
- ghost-genius
- certshift-site

---

## Monitoring Scripts

### Location: /opt/monitoring/

| Script | Server | Purpose |
|---|---|---|
| vps-monitor.sh | VPS (168.231.92.229) | Container health + site HTTP checks |
| coolify-monitor.sh | srv1455611 | App status via Coolify API |
| site-monitor.sh | srv1455611 | External sites HTTP checks |

### Cron Configuration

**VPS (168.231.92.229)**
- File: `/etc/cron.d/vps-monitor`
- Schedule: `0 * * * *` (hourly)
- Note: BEFORE editing, move to `vps-monitor.disabled` then restore

**srv1455611**
- File: `/etc/cron.d/vps-monitor`
- Scripts: coolify-monitor.sh, site-monitor.sh
- Schedule: `0 * * * *` (hourly)

### .env Location: /opt/monitoring/.env (on VPS)

```
BOT_TOKEN=8665179749:AAEb6AMQO9AIHgCYxjO-RA-CzNR2BKsjcc0
CHAT_ID=-1003730685847
TOPIC_ID=19
MONITOR_SSH_HOST=root@168.231.92.229
MONITOR_SSH_PASS=741952863@Julho15
COOLIFY_API_TOKEN=3|icmbWqhbtxiXUDuW3xv8gMyXtL6MIytaLuasq13b2cddf2b7
COOLIFY_HOST=168.231.92.229
```

### Container Monitoring - Use PREFIX not exact ID

Container IDs change on deploy. Use prefix matching:
```
CONTAINER_PREFIXES=coolify,coolify-proxy,coolify-db,coolify-redis,ygs0kks0sw8w048wcgw8wos0,backend-fko80gc4gkk8k40osw04c0so,frontend-fko80gc4gkk8k40osw04c0so,api-boletoapi
```

---

## Telegram Configuration

- **Bot Token**: 8665179749:AAEb6AMQO9AIHgCYxjO-RA-CzNR2BKsjcc0
- **Group**: VOID (-1003730685847)
- **Topic 19**: ⚙️ Infra
- **Topic 13561**: PIXEL LIBER (created 2026-04-18)
- **Topic 11**: Ignored (not responding)

### Bot Permissions
- Bot needs "Manage topics" admin permission to create forum topics

---

## Coolify Native Notifications

- **Status**: DISABLED (via DB update)
- **Table**: coolify.telegram_notification_settings
- **Column**: telegram_enabled = false
- **Reason**: Duplicating alerts with Linux cron scripts

---

## VPS Log Files

- `/var/log/vps-monitor.log` - Container and site checks
- `/var/log/coolify-monitor.log` - Coolify API checks
- `/var/log/site-monitor.log` - External site HTTP checks
