# VPN/Gluetun Container Management (2025-12-03)

### Problem

The Signal bot uses `network_mode: "service:vpn"` to route all traffic through a Mullvad VPN container (gluetun). This provides IP privacy but introduces several failure modes:

**Common Symptoms:**
- `container for service "vpn" is unhealthy` during deploy
- `Error: connect ECONNREFUSED` to database/redis
- `curl: (6) Could not resolve host` - DNS resolution fails
- `curl: (60) SSL certificate problem` - SSL verification fails through VPN
- Signal CLI: `Connection terminated unexpectedly`

**Root Causes:**
1. VPN connection drops or tunnel fails
2. Mullvad WireGuard server becomes unavailable
3. DNS resolution through Mullvad DNS (10.64.0.1) fails
4. Container IP addresses change after network recreation

### Solution

**Manual VPN Restart:**
```bash
# Check VPN status
docker logs --tail 50 signal-bot-vpn

# Restart VPN and wait for healthy
docker compose restart vpn
sleep 30

# Verify connectivity
docker exec signal-bot-selfhosted curl -s https://api.ipify.org
# Should return VPN IP (e.g., 143.244.47.75)

# Then restart the bot
docker compose up -d signal-bot
```

**Automated VPN Health Check (in deploy script):**
```bash
# Check if VPN is healthy before deploying
VPN_HEALTH=$(docker inspect signal-bot-vpn --format='{{.State.Health.Status}}' 2>/dev/null || echo "none")
if [ "$VPN_HEALTH" != "healthy" ]; then
    echo "⚠️  VPN unhealthy, restarting..."
    docker compose restart vpn
    sleep 30
fi
```

**Docker Compose VPN Configuration:**
```yaml
vpn:
  image: qmcgaw/gluetun:latest
  cap_add:
    - NET_ADMIN
  devices:
    - /dev/net/tun:/dev/net/tun
  environment:
    VPN_SERVICE_PROVIDER: mullvad
    VPN_TYPE: wireguard
    WIREGUARD_PRIVATE_KEY: <key>
    # ... other WireGuard settings
  healthcheck:
    test: ["CMD", "ping", "-c", "1", "1.1.1.1"]
    interval: 30s
    timeout: 10s
    retries: 3
    start_period: 30s

signal-bot:
  network_mode: "service:vpn"  # Routes ALL traffic through VPN
  depends_on:
    vpn:
      condition: service_healthy  # Won't start until VPN healthy
```

### Key Points

1. **Bot uses VPN's network stack** - The signal-bot container has NO direct network access
2. **DNS goes through Mullvad** - Uses 10.64.0.1 instead of system DNS
3. **IP addresses are dynamic** - Container IPs change on network recreation
4. **VPN must be healthy first** - Always ensure VPN is up before starting bot

### Lesson

✅ **Always check VPN health before deploying**
✅ **Restart VPN if DNS or connectivity fails**
✅ **Wait 30+ seconds after VPN restart for connection to stabilize**
✅ **Use `depends_on: condition: service_healthy`** in docker-compose
✅ **Monitor VPN logs for WireGuard timeout errors**

**Files**: `docker-compose.yml`, `deploy-selfhosted.sh`
