import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface McpHttpOptions {
  /** when set, every /mcp request must send "Authorization: Bearer <token>" */
  authToken?: string;
  /** URL path of the endpoint (default /mcp) */
  path?: string;
}

/**
 * Remote MCP over Streamable HTTP (stateless, JSON responses): a fresh server + transport per request,
 * so there is no session to lose on restart and it scales behind a load balancer.
 * Web-standard Request/Response, so it can be tested with app.request() and no real socket.
 */
export function createMcpHttpApp(buildServer: () => McpServer, opts: McpHttpOptions = {}) {
  const app = new Hono();
  const path = opts.path ?? "/mcp";

  app.get("/health", (c) => c.json({ ok: true }));

  app.all(path, async (c) => {
    if (opts.authToken && c.req.header("authorization") !== `Bearer ${opts.authToken}`) {
      return c.json({ jsonrpc: "2.0", error: { code: -32001, message: "unauthorized" }, id: null }, 401);
    }
    // stateless mode has no server-initiated stream and no session to delete
    if (c.req.method === "GET" || c.req.method === "DELETE") {
      return c.json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server): use POST" }, id: null }, 405, { Allow: "POST" });
    }
    const server = buildServer();
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void server.close();
    }
  });

  return app;
}
