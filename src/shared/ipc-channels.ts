// 【契约】IPC 通道名常量。preload/ipc.ts 双方都从这里取通道名，禁止在两端各写各的字符串字面量。
// 命名格式：'<namespace>:<action>'。事件通道（main -> renderer 推送）也在此登记。

export const IPC_CHANNELS = {
  tracker: {
    getStatus: 'tracker:getStatus',
    setEnabled: 'tracker:setEnabled',
    setScreenshotEnabled: 'tracker:setScreenshotEnabled',
    /** 事件：main -> renderer 推送 TrackerStatus */
    statusEvent: 'tracker:status',
  },
  data: {
    getSessions: 'data:getSessions',
    getDayStats: 'data:getDayStats',
    getScreenshotAnalyses: 'data:getScreenshotAnalyses',
    addNote: 'data:addNote',
    listNotes: 'data:listNotes',
    deleteNote: 'data:deleteNote',
    collectCommits: 'data:collectCommits',
    // v1.3 手动记录 + 自动 session 编辑 + 传图识别（SPEC §17.C）
    addManualRecord: 'data:addManualRecord',
    listManualRecords: 'data:listManualRecords',
    updateManualRecord: 'data:updateManualRecord',
    deleteManualRecord: 'data:deleteManualRecord',
    updateSessionCategory: 'data:updateSessionCategory',
    deleteSession: 'data:deleteSession',
    importImage: 'data:importImage',
  },
  // v1.3 统计（SPEC §17.B）
  stats: {
    getOverview: 'stats:getOverview',
    getHeatmap: 'stats:getHeatmap',
    getHourMatrix: 'stats:getHourMatrix',
    getTopApps: 'stats:getTopApps',
    getCategoryTotals: 'stats:getCategoryTotals',
    // v1.4 应用记录（SPEC §18.A）
    getAppUsage: 'stats:getAppUsage',
  },
  // v1.3 记忆（SPEC §17.A）
  memory: {
    get: 'memory:get',
    update: 'memory:update',
    refresh: 'memory:refresh',
    refreshPreview: 'memory:refreshPreview',
  },
  // v1.3 导出导入（SPEC §17.D）
  dataMgmt: {
    exportAll: 'dataMgmt:exportAll',
    importAll: 'dataMgmt:importAll',
  },
  // v1.3 定时日报（SPEC §17.E）
  scheduledReport: {
    getStatus: 'scheduledReport:getStatus',
    runNow: 'scheduledReport:runNow',
  },
  // v1.3 识别当前屏幕（SPEC §17.F）
  capture: {
    analyzeNow: 'capture:analyzeNow',
  },
  // v1.3 MCP（SPEC §17.G）
  mcp: {
    getStatus: 'mcp:getStatus',
    getLogs: 'mcp:getLogs',
  },
  reports: {
    preview: 'reports:preview',
    generate: 'reports:generate',
    /** 事件：main -> renderer 推送 ReportProgress */
    progressEvent: 'reports:progress',
    list: 'reports:list',
    get: 'reports:get',
    update: 'reports:update',
    remove: 'reports:remove',
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
    setSecret: 'settings:setSecret',
    testProvider: 'settings:testProvider',
    pickDirectory: 'settings:pickDirectory',
  },
  app: {
    getVersion: 'app:getVersion',
    openExternal: 'app:openExternal',
    openPermissionSettings: 'app:openPermissionSettings',
    clearAllData: 'app:clearAllData',
    isClaudeCliAvailable: 'app:isClaudeCliAvailable',
    isCodexCliAvailable: 'app:isCodexCliAvailable',
    getDataDir: 'app:getDataDir',
    showDataDir: 'app:showDataDir',
  },
} as const;
