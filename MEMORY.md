# MEMORY.md - Vex Index

## Quick References
- `memory/knowledge/coolify-vps-infrastructure.md` — Complete Coolify & VPS infrastructure docs
- `memory/2026-04-18-vps-monitor.md` — VPS monitoring investigation notes

## Last Updated
2026-04-18

## Infrastructure Summary

| Server | IP | Purpose |
|---|---|---|
| srv1455611 | 69.62.93.243 | OpenClaw gateway, monitoring scripts |
| VPS | 168.231.92.229 | Coolify, Docker containers |

### Critical Credentials
- **VPS SSH**: root@168.231.92.229 / 741952863@Julho15
- **Coolify API Token**: 3|icmbWqhbtxiXUDuW3xv8gMyXtL6MIytaLuasq13b2cddf2b7
- **Telegram Bot**: 8665179749:AAEb6AMQO9AIHgCYxjO-RA-CzNR2BKsjcc0

## Key Decisions Made

1. **VPS cron**: Changed from */5 to 0 * * * * (hourly)
2. **Coolify native notifications**: Disabled via DB
3. **Container monitoring**: Uses PREFIX not exact ID ( survives deploys)
4. **Sub-agents**: All set to MiniMax-M2.7-highspeed model
5. **Telegram group**: Bot responds to all topics EXCEPT topic 11

## Coolify Traefik Bug
- **Bug**: `Host(``)` empty in Traefik labels — blocks domain routing
- **Workaround**: Manual YAML at `/traefik/dynamic/{uuid}.yaml` in coolify-proxy
- **Full doc**: `control-plane/shared/knowledge/coolify-traefik-host-empty-bug.md`

## Q10 Jack API
- **Docs**: `memory/knowledge/Q10-JACK-API.md` — 179 operations documented
- **Source**: https://developer.q10.com/api-details#api=jack-api
- **Auth**: API Key (header `Api-Key`), subscription required
