import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { FortnoxClient } from "./fortnox.js";

const env = (name: string, fallback?: string): string => {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") throw new Error(`Missing env var ${name}`);
  return v;
};

const PORT = Number(process.env.PORT ?? 3000);
const MCP_AUTH_TOKEN = env("MCP_AUTH_TOKEN");
const fortnox = new FortnoxClient(
  env("FORTNOX_CLIENT_ID"),
  env("FORTNOX_CLIENT_SECRET"),
  process.env.FORTNOX_TOKEN_FILE ?? "/data/fortnox-tokens.json",
  process.env.FORTNOX_REFRESH_TOKEN,
);

// Read-only tools only. Write operations are intentionally not exposed.
function buildServer(): McpServer {
  const server = new McpServer({ name: "fortnox-mcp", version: "0.1.0" });

  const asText = (data: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  });

  server.tool(
    "list_customers",
    "List customers in Fortnox (read-only).",
    { limit: z.number().int().min(1).max(500).default(20) },
    async ({ limit }) => asText(await fortnox.get("/customers", { limit })),
  );

  server.tool(
    "list_invoices",
    "List customer invoices in Fortnox (read-only). Optional filter by status: unpaid, unpaidoverdue, paid, cancelled, fullypaid.",
    {
      limit: z.number().int().min(1).max(500).default(20),
      status: z.enum(["unpaid", "unpaidoverdue", "paid", "cancelled", "fullypaid"]).optional(),
    },
    async ({ limit, status }) => asText(await fortnox.get("/invoices", { limit, filter: status })),
  );

  server.tool(
    "get_invoice",
    "Get one customer invoice by its document number (read-only).",
    { documentNumber: z.string().min(1) },
    async ({ documentNumber }) => asText(await fortnox.get(`/invoices/${encodeURIComponent(documentNumber)}`)),
  );

  server.tool(
    "list_supplier_invoices",
    "List supplier invoices (leverantörsfakturor) in Fortnox (read-only).",
    { limit: z.number().int().min(1).max(500).default(20) },
    async ({ limit }) => asText(await fortnox.get("/supplierinvoices", { limit })),
  );

  server.tool(
    "list_accounts",
    "List accounts in the chart of accounts (kontoplan) (read-only).",
    { limit: z.number().int().min(1).max(500).default(100) },
    async ({ limit }) => asText(await fortnox.get("/accounts", { limit })),
  );

  return server;
}

const sessions = new Map<string, StreamableHTTPServerTransport>();

function authorized(req: IncomingMessage): boolean {
  return req.headers.authorization === `Bearer ${MCP_AUTH_TOKEN}`;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url !== "/mcp") {
    res.writeHead(404).end();
    return;
  }
  if (!authorized(req)) {
    res.writeHead(401).end("Unauthorized");
    return;
  }

  try {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? sessions.get(sessionId) : undefined;

    if (!transport && req.method === "POST") {
      const body = await readBody(req);
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, transport!),
      });
      transport.onclose = () => {
        if (transport?.sessionId) sessions.delete(transport.sessionId);
      };
      await buildServer().connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (!transport) {
      res.writeHead(400).end("Missing or unknown mcp-session-id");
      return;
    }
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500).end("Internal error");
  }
});

httpServer.listen(PORT, () => {
  console.log(`fortnox-mcp listening on :${PORT}/mcp`);
});
