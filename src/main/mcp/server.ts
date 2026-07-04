// MCP Server 生命周期（SPEC §17.G）。
//
// 【接线出口】集成者（M1/主进程装配）需各加一行调用，本模块不碰 ipc.ts/index.ts：
//   1. initMcp()               —— 应用启动、DB 就绪后调用一次（读 settings.mcp 决定是否启动）。建议放 index.ts app.whenReady() 内、registerIpcHandlers() 附近。
//   2. registerMcpIpc()        —— 见 ./register.ts，注册 mcp:getStatus / mcp:getLogs 两个 handle。放 ipc.ts 的 registerIpcHandlers() 或 index.ts。
//   3. syncMcpFromSettings()   —— 每次 settings.mcp 变更后调用（settings:set handler 里 setSettings() 之后加一行 syncMcpFromSettings()），实现热启停。
//
// 隐私红线：默认关闭（settings.mcp.enabled 默认 false，由 M1 落默认值）；仅绑定 127.0.0.1；路径固定 /mcp。
// 端口占用等错误只进状态（McpStatus.error），绝不让主进程崩溃。
// 无状态模式（stateless）：sessionIdGenerator: undefined，每个请求新建 McpServer + Transport，天然隔离、无会话状态。
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpStatus } from '../../shared/types';
import { getSettings } from '../settings';
import { registerTools } from './tools';

const HOST = '127.0.0.1';
const MCP_PATH = '/mcp';
const SERVER_NAME = 'gleam-daily';
const SERVER_VERSION = '1.3.0';
const DEFAULT_PORT = 41414;

interface McpRuntimeState {
  httpServer: http.Server | null;
  running: boolean;
  port: number;
  error: string;
}

const state: McpRuntimeState = {
  httpServer: null,
  running: false,
  port: DEFAULT_PORT,
  error: '',
};

/** 读取 settings.mcp，容错兜底（M1 尚未落默认值 / 旧 settings.json 无此字段时不崩）。 */
function readMcpSettings(): { enabled: boolean; port: number } {
  try {
    const mcp = getSettings().mcp as { enabled?: boolean; port?: number } | undefined;
    return {
      enabled: mcp?.enabled ?? false,
      port: typeof mcp?.port === 'number' && mcp.port > 0 ? mcp.port : DEFAULT_PORT,
    };
  } catch {
    return { enabled: false, port: DEFAULT_PORT };
  }
}

/** 无状态模式：每个请求新建一个装配好工具的 McpServer。 */
function buildMcpServer(): McpServer {
  const mcp = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(mcp);
  return mcp;
}

/** 处理一次 /mcp 请求：新建 server+transport，用完即关（无状态、隔离）。 */
async function handleMcpRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const mcp = buildMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
    enableJsonResponse: true, // 简单请求/响应（不主动开 SSE），便于本地 Agent/脚本直连
  });
  res.on('close', () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res);
}

function writeJsonRpcError(res: http.ServerResponse, httpStatus: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(httpStatus, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32600, message }, id: null }));
}

function createHttpServer(): http.Server {
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (path !== MCP_PATH) {
      writeJsonRpcError(res, 404, 'Not Found');
      return;
    }
    const method = req.method ?? 'GET';
    if (method !== 'POST' && method !== 'GET' && method !== 'DELETE') {
      writeJsonRpcError(res, 405, 'Method Not Allowed');
      return;
    }
    handleMcpRequest(req, res).catch(() => {
      writeJsonRpcError(res, 500, 'Internal server error');
    });
  });
  return server;
}

/** 启动（幂等）：已在同端口运行则直接返回；端口变化则先停再起。 */
export function startMcp(port: number): void {
  if (state.running && state.httpServer && state.port === port && !state.error) {
    return; // 幂等：已在目标端口运行
  }
  // 需要重启（端口变化或此前失败）
  if (state.httpServer) {
    stopMcp();
  }

  state.port = port;
  state.error = '';
  state.running = false;

  const server = createHttpServer();

  server.on('error', (err: NodeJS.ErrnoException) => {
    // 端口占用（EADDRINUSE）等：只记录错误，不崩溃。
    state.error = err.code === 'EADDRINUSE' ? `端口 ${port} 已被占用` : err.message;
    state.running = false;
    state.httpServer = null;
    try {
      server.close();
    } catch {
      /* ignore */
    }
  });

  server.listen(port, HOST, () => {
    state.running = true;
    state.error = '';
  });

  state.httpServer = server;
}

/** 停止（幂等）：关闭 server 并强制断开残留连接，尽快释放端口。 */
export function stopMcp(): void {
  const server = state.httpServer;
  state.httpServer = null;
  state.running = false;
  if (!server) return;
  try {
    // 强制断开 keep-alive 连接，保证端口即时释放（Node 18.2+）。
    server.closeAllConnections?.();
    server.close();
  } catch {
    /* ignore */
  }
}

/** 依据当前 settings.mcp 启停（供设置变更后调用，热启停）。 */
export function syncMcpFromSettings(): void {
  const { enabled, port } = readMcpSettings();
  if (enabled) {
    startMcp(port);
  } else {
    stopMcp();
    state.port = port; // 关闭态也反映用户配置的端口，供状态展示
    state.error = '';
  }
}

/** 应用启动时调用一次：读设置决定是否启动。 */
export function initMcp(): void {
  syncMcpFromSettings();
}

/** 当前状态（供 mcp:getStatus）。 */
export function getMcpStatus(): McpStatus {
  return {
    running: state.running,
    port: state.port,
    url: state.running ? `http://${HOST}:${state.port}${MCP_PATH}` : '',
    error: state.error,
  };
}
