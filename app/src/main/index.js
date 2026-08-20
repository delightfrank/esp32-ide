/**
 * ESP32 IDE - Electron 主进程
 * 负责创建窗口、菜单栏、IPC 通信、PlatformIO 集成
 */
const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const { registerPioIpc, killBuild } = require('./pio-bridge')
const { generatePlatformioIni, generatePlatformioIniContent, getSupportedChips } = require('./project')
const { registerSerialIpc } = require('./serial-manager')
const { getTemplateList, createProject } = require('./templates')
const { registerFileTreeIpc } = require('./file-tree')
const { registerSetupIpc, checkEnvironment } = require('./setup-manager')

// 开发模式下加载 Vite dev server，生产模式加载打包文件
const isDev = !app.isPackaged

let mainWindow = null

// ═══════════════════════════════════════════════════
// Bug 1: 中文路径检测辅助函数
// ═══════════════════════════════════════════════════
function hasChineseOrSpace(str) {
  return /[\u4e00-\u9fff]/.test(str) || /\s/.test(str)
}

// 当前打开的文件路径
let currentFilePath = null
// 编辑器内容是否已修改
let isModified = false
// 当前项目路径（用于编译）
// 项目路径（持久化到磁盘）
const projectPathFile = path.join(app.getPath('userData'), '.last-project-path')
let currentProjectPath = null
try { currentProjectPath = fs.readFileSync(projectPathFile, 'utf-8').trim() || null } catch(e) {}

// ═══════════════════════════════════════════════════
// Bug 1: 自动保存辅助函数
// ═══════════════════════════════════════════════════

/**
 * 获取自动保存路径
 * 有项目目录 → 项目目录/.autosave
 * 无项目目录 → ~/.esp32ide-autosave/.autosave
 */
function getAutosavePath() {
  if (currentProjectPath) {
    return path.join(currentProjectPath, '.autosave')
  }
  const homeDir = process.env.HOME || process.env.USERPROFILE || path.join(require('os').homedir())
  const dir = path.join(homeDir, '.esp32ide-autosave')
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (e) { /* ignore */ }
  return path.join(dir, '.autosave')
}

/**
 * 自动保存内容到 .autosave 文件
 */
async function doAutoSave(content) {
  try {
    const savePath = getAutosavePath()
    fs.writeFileSync(savePath, content, 'utf-8')
    return { success: true, path: savePath }
  } catch (err) {
    console.error('自动保存失败:', err.message)
    return { success: false, error: err.message }
  }
}

/**
 * 检查是否有崩溃恢复文件
 */
function checkAutosaveRecovery() {
  try {
    const savePath = getAutosavePath()
    if (fs.existsSync(savePath)) {
      const content = fs.readFileSync(savePath, 'utf-8')
      if (content && content.trim().length > 0) {
        return { available: true, content, path: savePath }
      }
    }
  } catch (e) { /* ignore */ }
  return { available: false }
}

/**
 * 删除自动保存文件
 */
function removeAutosaveFile() {
  try {
    const savePath = getAutosavePath()
    if (fs.existsSync(savePath)) {
      fs.unlinkSync(savePath)
    }
  } catch (e) { /* ignore */ }
}

/**
 * 创建主窗口
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'ESP32 IDE - 未命名',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // 开发模式加载 Vite dev server
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    // mainWindow.webContents.openDevTools() // 开发时可打开 DevTools
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  // 窗口关闭前确认未保存内容
  mainWindow.on('close', (e) => {
    if (isModified) {
      const choice = dialog.showMessageBoxSync(mainWindow, {
        type: 'question',
        buttons: ['保存', '不保存', '取消'],
        defaultId: 0,
        title: '未保存的更改',
        message: '当前文件已修改但未保存。是否保存？'
      })
      if (choice === 0) {
        e.preventDefault()
        handleSave().then(() => {
          mainWindow.destroy()
        })
      } else if (choice === 2) {
        e.preventDefault()
      }
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * 更新窗口标题
 */
function updateTitle() {
  if (!mainWindow) return
  const fileName = currentFilePath ? path.basename(currentFilePath) : '未命名'
  const prefix = isModified ? '*' : ''
  mainWindow.setTitle(`${prefix}${fileName} - ESP32 IDE`)
}

/**
 * 处理文件保存
 */
async function handleSave() {
  if (!mainWindow) return { success: false }

  const contentPromise = new Promise((resolve) => {
    ipcMain.once('get-editor-content-response', (event, data) => {
      resolve(data)
    })
    mainWindow.webContents.send('get-editor-content')
  })

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('IPC 超时：编辑器内容响应超时')), 5000)
  })

  let result
  try {
    result = await Promise.race([contentPromise, timeoutPromise])
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('保存超时', '保存操作超时，请重试。')
    }
    return { success: false, error: err.message }
  }

  if (!currentFilePath) {
    return await handleSaveAs()
  }

  try {
    fs.writeFileSync(currentFilePath, result.content, 'utf-8')
    isModified = false
    updateTitle()
    return { success: true, filePath: currentFilePath }
  } catch (err) {
    dialog.showErrorBox('保存失败', err.message)
    return { success: false, error: err.message }
  }
}

/**
 * 处理另存为
 */
async function handleSaveAs() {
  if (!mainWindow) return { success: false }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: '另存为',
    defaultPath: currentFilePath || 'untitled.cpp',
    filters: [
      { name: 'C/C++ 源文件', extensions: ['c', 'cpp', 'h', 'hpp', 'ino'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })

  if (result.canceled) return { success: false, canceled: true }

  const contentPromise = new Promise((resolve) => {
    ipcMain.once('get-editor-content-response', (event, data) => {
      resolve(data)
    })
    mainWindow.webContents.send('get-editor-content')
  })

  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('IPC 超时：编辑器内容响应超时')), 5000)
  })

  let contentResult
  try {
    contentResult = await Promise.race([contentPromise, timeoutPromise])
  } catch (err) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      dialog.showErrorBox('保存超时', '保存操作超时，请重试。')
    }
    return { success: false, error: err.message }
  }

  try {
    fs.writeFileSync(result.filePath, contentResult.content, 'utf-8')
    currentFilePath = result.filePath
    isModified = false
    updateTitle()
    return { success: true, filePath: result.filePath }
  } catch (err) {
    dialog.showErrorBox('保存失败', err.message)
    return { success: false, error: err.message }
  }
}

/**
 * 创建菜单栏
 */
function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '新建',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            currentFilePath = null
            isModified = false
            updateTitle()
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('menu-new-file')
            }
          }
        },
        {
          label: '打开',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              title: '打开文件',
              filters: [
                { name: 'C/C++ 源文件', extensions: ['c', 'cpp', 'h', 'hpp', 'ino'] },
                { name: '所有文件', extensions: ['*'] }
              ],
              properties: ['openFile']
            })

            if (!result.canceled && result.filePaths.length > 0) {
              const filePath = result.filePaths[0]
              try {
                let content
                let encodingWarning = null
                try {
                  content = fs.readFileSync(filePath, 'utf-8')
                  // 验证 UTF-8 解码是否有效（检查替换字符）
                  if (content.includes('\uFFFD')) {
                    throw new Error('UTF-8 decode produced replacement characters')
                  }
                } catch (decodeErr) {
                  // Bug 2: 回退到 latin1 读取并检测中文字符
                  const raw = fs.readFileSync(filePath, 'latin1')
                  const hasChinese = /[\u4e00-\u9fff]/.test(raw)
                  if (hasChinese) {
                    encodingWarning = '该文件可能使用 GBK/GB2312 编码。当前以 latin1 方式读取，中文字符可能显示异常。建议使用支持编码转换的编辑器转换为 UTF-8。'
                  }
                  content = raw
                }
                currentFilePath = filePath
                isModified = false
                updateTitle()
                mainWindow.webContents.send('file-opened', { filePath, content })
                if (encodingWarning) {
                  dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    title: '编码提示',
                    message: encodingWarning,
                    buttons: ['我知道了']
                  })
                }
              } catch (err) {
                dialog.showErrorBox('打开失败', err.message)
              }
            }
          }
        },
        { type: 'separator' },
        {
          label: '保存',
          accelerator: 'CmdOrCtrl+S',
          click: () => handleSave()
        },
        {
          label: '另存为',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => handleSaveAs()
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '重置缩放' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}

// ═══════════════════════════════════════════════════
// IPC 处理
// ═══════════════════════════════════════════════════

// 编辑器内容修改状态
ipcMain.on('editor-modified', (event, modified) => {
  isModified = modified
  updateTitle()
})

// 保存文件
ipcMain.handle('save-file', async () => {
  return await handleSave()
})

// 另存为
ipcMain.handle('save-file-as', async () => {
  return await handleSaveAs()
})

// 文件保存后通知文件树刷新
ipcMain.on('file-save-notify', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('file-saved')
  }
})

// M1: 文件树打开文件时同步 currentFilePath，避免保存时弹另存为
ipcMain.on('sync-current-file-path', (event, filePath) => {
  currentFilePath = filePath
  isModified = false
  updateTitle()
})

// H1: 项目路径变更时同步到文件树模块
ipcMain.on('set-file-tree-project', (event, projectPath) => {
  // 通过 file-tree IPC 设置路径（跨模块通信）
})

// 选择项目文件夹
ipcMain.handle('select-project-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择项目文件夹',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true }
  }
  currentProjectPath = result.filePaths[0]
  try { fs.writeFileSync(projectPathFile, currentProjectPath, 'utf-8') } catch(e) {}
  // H1: 同步项目路径到文件树模块
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('file-tree-project-changed', currentProjectPath)
  }
  return { success: true, path: currentProjectPath }
})

// 获取当前项目路径
ipcMain.handle('get-project-path', () => {
  return currentProjectPath
})

// 设置项目路径
ipcMain.handle('set-project-path', (event, projectPath) => {
  currentProjectPath = projectPath
  try { fs.writeFileSync(projectPathFile, projectPath || '', 'utf-8') } catch(e) {}
  return { success: true }
})

// 获取支持的芯片列表
ipcMain.handle('get-supported-chips', () => {
  return getSupportedChips()
})

// 生成 platformio.ini（带覆盖确认）
ipcMain.handle('generate-pio-ini', async (event, projectPath, chipType) => {
  const iniPath = path.join(projectPath, 'platformio.ini')
  const fileExists = fs.existsSync(iniPath)

  if (fileExists) {
    // 弹窗确认是否覆盖
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['覆盖', '取消'],
      defaultId: 1,
      title: 'platformio.ini 已存在',
      message: '项目目录中已存在 platformio.ini 文件。',
      detail: '覆盖将替换现有的项目配置，确定继续吗？'
    })

    if (result.response === 1) {
      // 用户取消
      return { success: false, canceled: true }
    }
  }

  try {
    const result = generatePlatformioIni(projectPath, chipType)
    return { success: true, overwritten: fileExists, ...result }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// 跳转到编译错误位置（通知渲染进程）
ipcMain.on('goto-error', (event, errorInfo) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('goto-error', errorInfo)
  }
})

// 注册 PlatformIO IPC 处理器
// Bug 3: 传入闭包 () => mainWindow，窗口重建后始终获取最新引用
app.whenReady().then(() => {
  createMenu()
  createWindow()

  // ─── Bug 1: 中文路径检测 ───
  const cwd = process.cwd()
  const appDir = __dirname
  const badPaths = []
  if (hasChineseOrSpace(cwd)) badPaths.push(`工作目录: ${cwd}`)
  if (hasChineseOrSpace(appDir) && appDir !== cwd) badPaths.push(`应用目录: ${appDir}`)
  if (badPaths.length > 0) {
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: '路径包含非 ASCII 字符或空格',
      message: '检测到以下路径可能影响 PlatformIO 编译：',
      detail: badPaths.join('\n') + '\n\n建议将项目路径改为纯英文无空格的路径。',
      buttons: ['继续', '退出'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 1) app.quit()
    })
  }

  // ─── Bug 2: 启动时检查崩溃恢复 ───
  const recovery = checkAutosaveRecovery()
  if (recovery.available && mainWindow && !mainWindow.isDestroyed()) {
    // 等窗口加载完成后通知渲染进程
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('recover-available', {
        content: recovery.content,
        path: recovery.path
      })
    })
  }

  // 注册 PlatformIO IPC（Bug 3: 动态引用 mainWindow）
  registerPioIpc(ipcMain, () => mainWindow)

  // 注册串口管理 IPC（Bug 3: 动态引用 mainWindow）
  registerSerialIpc(ipcMain, () => mainWindow)

  // 注册文件树 IPC
  registerFileTreeIpc(ipcMain, () => mainWindow)

  // 注册首次启动向导 IPC
  registerSetupIpc(ipcMain, () => mainWindow)

  // ─── 首次启动检测：缺少必要组件时发送向导事件 ───
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      const env = await checkEnvironment()
      if (!env.ready && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('show-setup-wizard', env)
      }
    } catch (err) {
      console.error('环境检测失败:', err.message)
    }
  })

  // ─── Bug 1: 自动保存 IPC ───
  ipcMain.handle('auto-save', async (event, data) => {
    return await doAutoSave(data.content)
  })

  // 渲染进程请求自动保存（定时器触发）
  ipcMain.on('request-auto-save', async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    try {
      const contentPromise = new Promise((resolve) => {
        ipcMain.once('get-editor-content-response', (event, data) => {
          resolve(data)
        })
        mainWindow.webContents.send('get-editor-content')
      })
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('IPC timeout')), 5000)
      })
      const result = await Promise.race([contentPromise, timeoutPromise])
      if (result?.content) {
        await doAutoSave(result.content)
      }
    } catch (err) {
      console.error('自动保存失败:', err.message)
    }
  })

  // ─── Bug 2: 崩溃恢复 ───
  ipcMain.on('recover-response', (event, choice) => {
    removeAutosaveFile()
  })

  // 注册模板 IPC
  ipcMain.handle('get-template-list', () => {
    return getTemplateList()
  })

  ipcMain.handle('create-project', (event, projectDir, projectName, templateId, chipType) => {
    return createProject(projectDir, projectName, templateId, chipType)
  })

  // 选择目录（用于新建项目）
  ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择项目目录',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }
    return { success: true, path: result.filePaths[0] }
  })
})

// 退出时终止所有编译子进程 + 通知渲染进程清理定时器
app.on('before-quit', () => {
  killBuild()
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('app-quit')
  }
})

// will-quit 双保险，确保子进程清理
app.on('will-quit', () => {
  killBuild()
})

// macOS：点击 dock 图标时重新创建窗口
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// 所有窗口关闭时退出应用（macOS 除外）
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
