---
name: coolify-compose
description: Convert Docker Compose files to Coolify templates. Use when creating Coolify services, converting docker-compose.yml for Coolify deployment, working with SERVICE_URL/SERVICE_PASSWORD magic variables, or troubleshooting Coolify compose errors.
---

# Coolify Docker Compose

Convert standard Docker Compose files into Coolify-compatible templates with automatic credential generation, dynamic URLs, and one-click deployment.

## Quick Start

Every Coolify template needs a header and magic variables:

```yaml
# documentation: https://example.com/docs
# slogan: Brief description of the service
# category: backend
# tags: api, database, docker
# logo: svgs/myservice.svg
# port: 3000

services:
  app:
    image: myapp:latest
    environment:
      - SERVICE_URL_APP_3000           # Generates URL, routes proxy to port 3000
      - DATABASE_URL=postgres://${SERVICE_USER_POSTGRES}:${SERVICE_PASSWORD_POSTGRES}@db:5432/mydb
    depends_on:
      db:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:3000/health"]
      interval: 5s
      timeout: 10s
      retries: 10

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=$SERVICE_USER_POSTGRES
      - POSTGRES_PASSWORD=$SERVICE_PASSWORD_POSTGRES
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"]
      interval: 5s
      timeout: 10s
      retries: 10
```

## Conversion Checklist

When converting a standard `docker-compose.yml`:

### 1. Add Header Metadata

```yaml
# documentation: https://...    # Required: URL to official docs
# slogan: ...                   # Required: One-line description  
# category: ...                 # Required: backend, cms, monitoring, etc.
# tags: ...                     # Required: Comma-separated search terms
# logo: svgs/....svg            # Required: Path in Coolify's svgs/ folder
# port: ...                     # Recommended: Main service port
```

### 2. Replace Hardcoded Credentials

```yaml
# ❌ Before
POSTGRES_PASSWORD=mysecretpassword
POSTGRES_USER=admin

# ✅ After  
POSTGRES_PASSWORD=$SERVICE_PASSWORD_POSTGRES
POSTGRES_USER=$SERVICE_USER_POSTGRES
```

### 3. Replace URLs with Magic Variables

```yaml
# ❌ Before
APP_URL=https://myapp.example.com

# ✅ After
- SERVICE_URL_APP_3000    # Declares URL + proxy routing
- APP_URL=$SERVICE_URL_APP  # References it
```

### 4. Remove `ports:` for Proxied Services

Coolify's Traefik proxy handles routing. Only keep `ports:` for SSH, UDP, or proxy bypass.

```yaml
# ❌ Before
ports:
  - "3000:3000"

# ✅ After
environment:
  - SERVICE_URL_APP_3000  # Proxy routes to container port 3000
# No ports: needed
```

### 5. Add Health Checks

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
  interval: 5s
  timeout: 10s
  retries: 10
```

### 6. Use `depends_on` with Conditions

```yaml
depends_on:
  db:
    condition: service_healthy
```

## Magic Variables Reference

Coolify generates values using `SERVICE_<TYPE>_<IDENTIFIER>`:

| Type | Example | Result |
|------|---------|--------|
| `PASSWORD` | `SERVICE_PASSWORD_DB` | Random password |
| `PASSWORD_64` | `SERVICE_PASSWORD_64_KEY` | 64-char password |
| `USER` | `SERVICE_USER_ADMIN` | Random 16-char string |
| `BASE64_64` | `SERVICE_BASE64_64_SECRET` | 64-char random string |
| `REALBASE64_64` | `SERVICE_REALBASE64_64_JWT` | Actual base64-encoded string |
| `HEX_32` | `SERVICE_HEX_32_KEY` | 64-char hex string |
| `URL` | `SERVICE_URL_APP_3000` | `https://app-uuid.example.com` + proxy |
| `FQDN` | `SERVICE_FQDN_APP` | `app-uuid.example.com` (no scheme) |

**⚠️ Important:** Use hyphens, not underscores, before port numbers:
```yaml
SERVICE_URL_MY_SERVICE_3000  # ❌ Breaks parsing
SERVICE_URL_MY-SERVICE_3000  # ✅ Works
```

See [references/magic-variables.md](references/magic-variables.md) for complete list.

## Coolify-Specific Extensions

### Create Directory

```yaml
volumes:
  - type: bind
    source: ./data
    target: /app/data
    is_directory: true  # Coolify creates this
```

### Create File with Content

```yaml
volumes:
  - type: bind
    source: ./config.json
    target: /app/config.json
    content: |
      {"key": "${SERVICE_PASSWORD_APP}"}
```

### Exclude from Health Checks

For migration/init containers that exit after running:

```yaml
services:
  migrate:
    command: ["npm", "run", "migrate"]
    exclude_from_hc: true
```

## Common Patterns

### Database Connection

```yaml
environment:
  - DATABASE_URL=postgres://${SERVICE_USER_POSTGRES}:${SERVICE_PASSWORD_POSTGRES}@db:5432/${POSTGRES_DB:-myapp}
```

### Shared Credentials

Same `SERVICE_PASSWORD_*` identifier = same value across all services:

```yaml
services:
  app:
    environment:
      - DB_PASS=$SERVICE_PASSWORD_POSTGRES
  db:
    environment:
      - POSTGRES_PASSWORD=$SERVICE_PASSWORD_POSTGRES  # Same value
```

### Multi-Service URLs

```yaml
services:
  frontend:
    environment:
      - SERVICE_URL_FRONTEND_3000
      - API_URL=$SERVICE_URL_API
  api:
    environment:
      - SERVICE_URL_API_8080=/api  # Path suffix
```

## Health Check Patterns

```yaml
# HTTP
test: ["CMD", "wget", "--spider", "-q", "http://localhost:8080"]

# PostgreSQL
test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]

# MySQL/MariaDB  
test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]

# Redis
test: ["CMD", "redis-cli", "ping"]

# Always pass (use sparingly)
test: ["CMD", "echo", "ok"]
```

## Environment Variable Syntax

```yaml
environment:
  - NODE_ENV=production           # Hardcoded, hidden from UI
  - API_KEY=${API_KEY}            # Editable in UI (empty)
  - LOG_LEVEL=${LOG_LEVEL:-info}  # Editable with default
  - SECRET=${SECRET:?}            # Required - blocks deploy if empty
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "No Available Server" error | Check `docker ps` for unhealthy containers; verify healthcheck passes |
| Variables not in Coolify UI | Use `${VAR}` syntax; hardcoded `VAR=value` won't appear |
| Magic variables not generating | Check spelling; ensure `SERVICE_` prefix; verify Coolify v4.0.0-beta.411+ |
| Port routing broken | Use `SERVICE_URL_NAME_PORT`; avoid underscores before port; remove `ports:` |

## Examples

When the user pastes a compose file, analyze it and use the matching example:

| Compose file has... | Use example |
|---------------------|-------------|
| 1 service, no database | [examples/simple/](examples/simple/) |
| 2 services: app + database (postgres/mysql/mariadb) | [examples/with-database/](examples/with-database/) |
| 3+ services, or mounted config files, or multiple databases | [examples/multi-service/](examples/multi-service/) |

**Quick analysis:**
- Count the `services:` — if just 1, use `simple/`
- Look for `postgres`, `mysql`, `mariadb`, `mongo` images — if 1 database, use `with-database/`
- Look for mounted `.xml`, `.json`, `.yml` config files — if present, use `multi-service/`
- Look for `clickhouse`, `redis`, multiple databases — use `multi-service/`

## References

- [references/magic-variables.md](references/magic-variables.md) — Complete variable type reference
- [references/categories.md](references/categories.md) — Valid category values
- [Coolify Docs](https://coolify.io/docs/knowledge-base/docker/compose)
