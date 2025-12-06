# Docker Network IP Address Changes (2025-12-03)

### Problem

After `docker compose down && docker compose up -d`, container IP addresses change. The signal-bot uses hardcoded IPs to reach postgres/redis (because `network_mode: service:vpn` prevents DNS resolution of container names).

**Error Example:**
```
Error: connect ECONNREFUSED 172.24.0.2:5432
```

**What Happened:**
- Before restart: postgres at 172.24.0.2
- After restart: VPN got 172.24.0.2, postgres moved to 172.24.0.3

### Solution

**Check Current IPs:**
```bash
docker network inspect signal-bot-selfhosted_signal-bot-network | grep -E '(Name|IPv4)'
```

**Update docker-compose.yml with new IPs:**
```bash
# Current layout (as of 2025-12-03):
# - VPN: 172.24.0.2
# - Postgres: 172.24.0.3
# - Redis: 172.24.0.4

# Update the environment variables in docker-compose.yml:
DB_HOST: 172.24.0.3     # Was 172.24.0.2
REDIS_HOST: 172.24.0.4
REDIS_URL: redis://172.24.0.4:6379
```

**Better Long-term Fix (TODO):**
Use static IPs in docker-compose.yml:
```yaml
networks:
  signal-bot-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.24.0.0/16

services:
  vpn:
    networks:
      signal-bot-network:
        ipv4_address: 172.24.0.2
  postgres:
    networks:
      signal-bot-network:
        ipv4_address: 172.24.0.3
  redis:
    networks:
      signal-bot-network:
        ipv4_address: 172.24.0.4
```

### Lesson

✅ **Check container IPs after any `docker compose down/up`**
✅ **Update docker-compose.yml if IPs changed**
✅ **Consider using static IP assignments for reliability**
✅ **VPN container always gets first available IP**

**Files**: `docker-compose.yml`
