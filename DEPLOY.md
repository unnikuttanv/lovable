# Deploying Adorable for your team

Adorable ships as a Docker Compose stack (app + Postgres). Identity comes from your
SSO proxy — the app itself has no login screen, it trusts an email header set by the
proxy. **Never expose port 3001 directly to a network without the proxy**: whoever can
reach the port can claim any identity by setting the header.

## 1. Get it running on a VM

Any Linux VM with Docker works (2 vCPU / 4 GB is plenty for ~50 users — previews run
in each user's browser, not on the server).

```bash
git clone <your-internal-repo-url> adorable && cd adorable
cat > .env <<'EOF'
OPENROUTER_API_KEY=sk-or-...
POSTGRES_PASSWORD=<generate-a-strong-one>
DAILY_GENERATION_LIMIT=50
EOF
docker compose up -d --build
curl -s localhost:3001/api/me -H "cf-access-authenticated-user-email: you@company.com"
```

The last command should return your email — the stack is up.

## 2. Put SSO in front

Pick ONE of the two recipes.

### Option A — Cloudflare Access (recommended, no extra containers)

1. Add a DNS record like `adorable.yourcompany.com` in Cloudflare, proxied (orange cloud),
   pointing at the VM. Use a Cloudflare Tunnel if the VM has no public IP:
   `cloudflared tunnel create adorable` and route the hostname to `http://localhost:3001`.
2. In **Zero Trust → Access → Applications**, add a self-hosted app for
   `adorable.yourcompany.com`, with a policy `Allow — Emails ending in @yourcompany.com`
   (or a specific group).
3. Cloudflare Access automatically forwards `Cf-Access-Authenticated-User-Email` on every
   request — which is Adorable's default `AUTH_EMAIL_HEADER`. No app config needed.
4. Firewall the VM so port 3001 only accepts traffic from Cloudflare (or bind the tunnel
   to localhost). This is the step that makes header-spoofing impossible.

### Option B — oauth2-proxy with Google Workspace

Add this service to `docker-compose.yml` and stop publishing the app's port
(change `ports` on `app` to `expose: ["3001"]`):

```yaml
  oauth2-proxy:
    image: quay.io/oauth2-proxy/oauth2-proxy:v7.6.0
    ports:
      - "443:4180"
    environment:
      OAUTH2_PROXY_PROVIDER: google
      OAUTH2_PROXY_CLIENT_ID: <google-oauth-client-id>
      OAUTH2_PROXY_CLIENT_SECRET: <google-oauth-client-secret>
      OAUTH2_PROXY_COOKIE_SECRET: <openssl rand -base64 32 | head -c 32 | base64>
      OAUTH2_PROXY_EMAIL_DOMAINS: yourcompany.com
      OAUTH2_PROXY_UPSTREAMS: http://app:3001
      OAUTH2_PROXY_HTTP_ADDRESS: 0.0.0.0:4180
      OAUTH2_PROXY_PASS_USER_HEADERS: "true"   # sends X-Auth-Request-Email upstream
      OAUTH2_PROXY_REDIRECT_URL: https://adorable.yourcompany.com/oauth2/callback
```

Then set on the `app` service: `AUTH_EMAIL_HEADER: x-auth-request-email`.
Create the OAuth client in Google Cloud Console (type: web application, authorized
redirect URI = the redirect URL above). Terminate TLS at your load balancer or add
a caddy/nginx container in front.

### Small-team alternative — Tailscale, no SSO

Run the stack on a machine in your tailnet, share the machine to the team, set
`DEV_USER` per… no — instead set `AUTH_EMAIL_HEADER` handling aside and use
[tailscale serve](https://tailscale.com/kb/1312/serve) with identity headers:
`tailscale serve --set-path / http://localhost:3001` forwards
`Tailscale-User-Login` — set `AUTH_EMAIL_HEADER: tailscale-user-login`.

## 3. Day-2 operations

- **Cost control:** one OpenRouter key funds everyone; `DAILY_GENERATION_LIMIT` caps
  per-user generations per day (default 50). Watch spend on the OpenRouter dashboard;
  it also supports provisioning sub-keys with hard budgets if you want vendor-side limits.
- **Backups:** `docker compose exec db pg_dump -U adorable adorable > backup.sql`
  (cron it; the `pgdata` volume is the source of truth. `published` holds static builds
  and can be regenerated).
- **Upgrades:** `git pull && docker compose up -d --build`.
- **Key rotation:** update `.env`, `docker compose up -d` (recreates app only).
- **Logs:** `docker compose logs -f app`.

## Security model (read this once)

- Generated code **never executes on the server**. Previews bundle and run in each
  user's browser (Sandpack, sandboxed iframe). Publish runs `vite build`, which
  bundles but does not execute app code; extra npm packages a project declares are
  installed on demand with `--ignore-scripts`, so package install hooks don't run
  either.
- Identity is only as trustworthy as your network path: the SSO proxy must be the
  only way to reach the app.
- Users are isolated per email: they can only list/read/modify their own projects.
- Published apps at `/p/<id>/` are readable by anyone with proxy access (they are
  static files, ids are unguessable 8-char slugs). Treat them as company-internal.
