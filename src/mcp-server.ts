import { loadEnvConfig } from "@next/env";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildMcpServer } from "@/lib/mcp/server";
import { PROJECT_BRAND } from "@/lib/brand";

loadEnvConfig(process.cwd());

const port = Number(process.env.MCP_PORT ?? 3001);
const host = process.env.MCP_HOST ?? "0.0.0.0";

const app = createMcpExpressApp({ host });

app.post("/mcp", async (req, res) => {
  const server = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error(`[${PROJECT_BRAND.slug}-mcp] Error handling MCP request:`, error);
    if (!res.headersSent) {
      res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal error." }, id: null });
    }
  } finally {
    res.on("close", () => {
      transport.close().catch(() => undefined);
      server.close().catch(() => undefined);
    });
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Use POST /mcp." }, id: null });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed. Use POST /mcp." }, id: null });
});

app.listen(port, host, () => {
  console.log(`[${PROJECT_BRAND.slug}-mcp] MCP server listening on http://${host}:${port}/mcp`);
  console.log(`[${PROJECT_BRAND.slug}-mcp] Talking to ${PROJECT_BRAND.displayName} at ${process.env.APP_URL ?? "http://localhost:3000"}`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
