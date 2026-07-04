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
