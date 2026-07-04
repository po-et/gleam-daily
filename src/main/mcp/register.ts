// MCP 相关 IPC 注册（风格对齐 src/main/ipc.ts）。
//
// 【接线出口】集成者在主进程装配时调用 registerMcpIpc() 一次即可（放 ipc.ts 的 registerIpcHandlers()
// 末尾，或 index.ts 里与 registerIpcHandlers() 并列）。仅注册两个只读查询通道，无副作用。
//   - mcp:getStatus -> McpStatus
//   - mcp:getLogs   -> McpLogEntry[]（最新在前）
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import type { McpLogEntry, McpStatus } from '../../shared/types';
import { getLogs } from './log';
import { getMcpStatus } from './server';

export function registerMcpIpc(): void {
  ipcMain.handle(IPC_CHANNELS.mcp.getStatus, async (): Promise<McpStatus> => getMcpStatus());
  ipcMain.handle(IPC_CHANNELS.mcp.getLogs, async (): Promise<McpLogEntry[]> => getLogs());
}
