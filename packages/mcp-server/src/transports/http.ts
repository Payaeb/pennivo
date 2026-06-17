// Loopback HTTP transport (Streamable HTTP) for remote/headless agent use.
// Binds to 127.0.0.1 by default with DNS-rebinding protection on. Each MCP
// session gets its own server instance (built by the injected factory) and its
// own transport, keyed by the session id the SDK assigns at initialize.

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface HttpOptions {
  host?: string;
  port?: number;
  /** Override the path the MCP endpoint is served at. Default "/mcp". */
  path?: string;
}

export interface RunningHttpServer {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

const SESSION_HEADER = "mcp-session-id";

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return undefined;
  return JSON.parse(raw);
}

function sendJsonError(
  res: ServerResponse,
  status: number,
  message: string,
): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: status === 404 ? -32001 : -32000, message },
      id: null,
    }),
  );
}

/**
 * Start a loopback Streamable-HTTP MCP server. `makeServer` is called once per
 * new session to build a fresh `McpServer`.
 */
export async function runHttp(
  makeServer: () => McpServer,
  opts: HttpOptions = {},
): Promise<RunningHttpServer> {
  const host = opts.host ?? "127.0.0.1";
  const endpoint = opts.path ?? "/mcp";
  const transports = new Map<string, StreamableHTTPServerTransport>();

  const allowedHostsFor = (port: number) => [
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    "127.0.0.1",
    "localhost",
  ];

  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
    port: number,
  ): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://${host}:${port}`);
    if (url.pathname !== endpoint) {
      sendJsonError(res, 404, "Not found");
      return;
    }

    const sessionId = req.headers[SESSION_HEADER];
    const sid = Array.isArray(sessionId) ? sessionId[0] : sessionId;

    if (req.method === "POST") {
      const body = await readJsonBody(req).catch(() => undefined);
      let transport = sid ? transports.get(sid) : undefined;

      if (!transport && isInitializeRequest(body)) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          enableDnsRebindingProtection: true,
          allowedHosts: allowedHostsFor(port),
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
          },
        });
        transport.onclose = () => {
          if (transport!.sessionId) transports.delete(transport!.sessionId);
        };
        await makeServer().connect(transport);
      }

      if (!transport) {
        sendJsonError(
          res,
          400,
          "No valid session. Send an initialize request first.",
        );
        return;
      }
      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      const transport = sid ? transports.get(sid) : undefined;
      if (!transport) {
        sendJsonError(res, 400, "Unknown or missing session id.");
        return;
      }
      await transport.handleRequest(req, res);
      return;
    }

    sendJsonError(res, 405, "Method not allowed");
  };

  const httpServer = createServer((req, res) => {
    const addr = httpServer.address();
    const port =
      typeof addr === "object" && addr ? addr.port : (opts.port ?? 0);
    void handle(req, res, port).catch((err) => {
      if (!res.headersSent) {
        sendJsonError(
          res,
          500,
          err instanceof Error ? err.message : String(err),
        );
      } else {
        res.end();
      }
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port ?? 0, host, () => {
      const addr = httpServer.address();
      resolve(typeof addr === "object" && addr ? addr.port : (opts.port ?? 0));
    });
  });

  return {
    host,
    port,
    url: `http://${host}:${port}${endpoint}`,
    close: async () => {
      for (const transport of transports.values()) {
        await transport.close().catch(() => {});
      }
      transports.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
