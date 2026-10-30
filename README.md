# fortnox-mcp

A read-only MCP server (Streamable HTTP) that exposes Fortnox data to AI clients.

## Tools
- `list_customers`
- `list_invoices` (optional status filter)
- `get_invoice` (by document number)
- `list_supplier_invoices`
- `list_accounts`

## Setup
1. Get API access from Fortnox (developer portal) and note your client ID and secret.
2. Complete the OAuth authorization once to obtain a refresh token.
3. `cp .env.example .env` and fill in the values. Generate `MCP_AUTH_TOKEN` with `openssl rand -hex 32`.
4. Run `docker compose up -d --build`, or deploy the repo as a stack in Portainer and set the same variables there.
5. The MCP endpoint is `http://<host>:3100/mcp`. Clients must send `Authorization: Bearer <MCP_AUTH_TOKEN>`.

## Notes
- Fortnox rotates refresh tokens. The server saves the newest one in the `/data` volume, so keep that volume.
- Put the server behind HTTPS (for example via a reverse proxy) before exposing it outside your network.
- Write operations are not implemented on purpose.

## Local development
```
npm install
npm run build
MCP_AUTH_TOKEN=test FORTNOX_CLIENT_ID=x FORTNOX_CLIENT_SECRET=y FORTNOX_REFRESH_TOKEN=z npm start
```
