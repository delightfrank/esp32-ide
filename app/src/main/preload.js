/**
 * ESP32 IDE - Preload 脚本
 * 安全地暴露 IPC 通信接口给渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  // ─── 文件操作 ───
  sendEditorContent: (content) => {
    ipcRenderer.send('get-editor-content-response', { content })
  },
  reportModified: (modified) => {
    ipcRenderer.send('editor-modified', modified)
  },
  saveFile: () => ipcRenderer.invoke('save-file'),
  saveFileAs: () => ipcRenderer.invoke('save-file-as'),

  // ─── 监听主进程事件 ───
  onNewFile: (callback) => {
    ipcRenderer.on('menu-new-file', callback)
  },
  onFileOpened: (callback) => {
    ipcRenderer.on('file-opened', (event, data) => callback(data))
  },
  onGetEditorContent: (callback) => {
    ipcRenderer.on('get-editor-content', callback)
  },

  // ─── 项目管理 ───
  selectProjectFolder: () => ipcRenderer.invoke('select-project-folder'),
  getProjectPath: () => ipcRenderer.invoke('get-project-path'),
  setProjectPath: (path) => ipcRenderer.invoke('set-project-path', path),

  // ─── PlatformIO 操作 ───
  pioBuild: (projectPath) => ipcRenderer.invoke('pio-build', projectPath),
  pioClean: (projectPath) => ipcRenderer.invoke('pio-clean', projectPath),
  pioUpload: (projectPath, port) => ipcRenderer.invoke('pio-upload', projectPath, port),
  pioInit: (projectPath, options) => ipcRenderer.invoke('pio-init', projectPath, options),
  pioStatusQuery: () => ipcRenderer.invoke('pio-status-query'),
  pioKill: () => ipcRenderer.invoke('pio-kill'),

  // ─── PIO 实时输出监听 ───
  onPioOutput: (callback) => {
    ipcRenderer.on('pio-output', (event, data) => callback(data))
  },
  onPioStatus: (callback) => {
    ipcRenderer.on('pio-status', (event, data) => callback(data))
  },

  // ─── 芯片与项目配置 ───
  getSupportedChips: () => ipcRenderer.invoke('get-supported-chips'),
  generatePioIni: (projectPath, chipType) => ipcRenderer.invoke('generate-pio-ini', projectPath, chipType),

  // ─── 错误跳转 ───
  gotoError: (errorInfo) => {
    ipcRenderer.send('goto-error', errorInfo)
  },
  onGotoError: (callback) => {
    ipcRenderer.on('goto-error', (event, data) => callback(data))
  },

  // ─── 串口管理 ───
  serialList: () => ipcRenderer.invoke('serial-list'),
  serialRefresh: () => ipcRenderer.invoke('serial-refresh'),
  serialCheck: (portPath) => ipcRenderer.invoke('serial-check', portPath),
  serialListEsp: () => ipcRenderer.invoke('serial-list-esp'),

  // ─── 串口监视器 ───
  serialMonitorConnect: (portPath, baudRate) => ipcRenderer.invoke('serial-monitor-connect', portPath, baudRate),
  serialMonitorDisconnect: () => ipcRenderer.invoke('serial-monitor-disconnect'),
  serialMonitorSend: (data) => ipcRenderer.invoke('serial-monitor-send', data),
  serialMonitorStatus: () => ipcRenderer.invoke('serial-monitor-status-query'),
  serialMonitorPreUpload: () => ipcRenderer.invoke('serial-monitor-pre-upload'),
  serialMonitorPostUpload: () => ipcRenderer.invoke('serial-monitor-post-upload'),

  // 串口监视器数据事件
  onSerialMonitorData: (callback) => {
    ipcRenderer.on('serial-monitor-data', (event, data) => callback(data))
  },
  onSerialMonitorStatus: (callback) => {
    ipcRenderer.on('serial-monitor-status', (event, data) => callback(data))
  },
  onSerialMonitorReconnectRequest: (callback) => {
    ipcRenderer.on('serial-monitor-reconnect-request', callback)
  },

  // ─── 项目模板 ───
  getTemplateList: () => ipcRenderer.invoke('get-template-list'),
  createProject: (projectDir, projectName, templateId, chipType) =>
    ipcRenderer.invoke('create-project', projectDir, projectName, templateId, chipType),

  // ─── 文件夹选择（新建项目用）───
  selectDirectory: () => ipcRenderer.invoke('select-directory'),

  // ─── 文件树操作 ───
  fileSaveNotify: () => ipcRenderer.send('file-save-notify'),
  fileTreeList: (dirPath) => ipcRenderer.invoke('file-tree-list', dirPath),
  fileTreeWatch: (dirPath) => ipcRenderer.invoke('file-tree-watch', dirPath),
  fileTreeUnwatch: (dirPath) => ipcRenderer.invoke('file-tree-unwatch', dirPath),
  fileDelete: (filePath) => ipcRenderer.invoke('file-delete', filePath),
  fileRename: (oldPath, newPath) => ipcRenderer.invoke('file-rename', oldPath, newPath),
  fileMkdir: (dirPath) => ipcRenderer.invoke('file-mkdir', dirPath),
  fileCreate: (filePath) => ipcRenderer.invoke('file-create', filePath),
  fileRead: (filePath) => ipcRenderer.invoke('file-read', filePath),
  // Bug 3: fileWrite 已移除 — 文件保存只通过 save-file IPC，防止渲染进程任意写文件
  fileStat: (filePath) => ipcRenderer.invoke('file-stat', filePath),
  // M1: 同步当前文件路径到主进程
  syncCurrentFilePath: (filePath) => ipcRenderer.send('sync-current-file-path', filePath),

  // ─── 文件树事件监听 ───
  onFileTreeChanged: (callback) => {
    ipcRenderer.on('file-tree-changed', (event, data) => callback(data))
  },

  // ─── 文件保存事件（编辑器保存后通知文件树刷新）───
  onFileSaved: (callback) => {
    ipcRenderer.on('file-saved', (event, data) => callback(data))
  },
  removeFileSavedListener: (callback) => {
    ipcRenderer.removeListener('file-saved', callback)
  },

  // ─── 自动保存 ───
  autoSave: (data) => ipcRenderer.invoke('auto-save', data),
  requestAutoSave: () => ipcRenderer.send('request-auto-save'),

  // ─── 崩溃恢复 ───
  onRecoverAvailable: (callback) => {
    ipcRenderer.on('recover-available', (event, data) => callback(data))
  },
  recoverResponse: (choice) => {
    ipcRenderer.send('recover-response', choice)
  },

  // ─── 应用退出通知（清理定时器等）───
  onAppQuit: (callback) => {
    ipcRenderer.on('app-quit', callback)
  },
  removeAppQuitListener: (callback) => {
    ipcRenderer.removeListener('app-quit', callback)
  },

  // ─── 首次启动向导 IPC ───
  setupCheckEnvironment: () => ipcRenderer.invoke('setup-check-env'),
  setupInstall: (mirror) => ipcRenderer.invoke('setup-install', mirror),
  setupGetStatus: () => ipcRenderer.invoke('setup-get-status'),
  onSetupProgress: (callback) => {
    ipcRenderer.on('setup-progress', (event, data) => callback(data))
  },
  onShowSetupWizard: (callback) => {
    ipcRenderer.on('show-setup-wizard', (event, data) => callback(event, data))
  },
})
