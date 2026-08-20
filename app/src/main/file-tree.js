/**
 * ESP32 IDE - 文件树模块
 * 提供目录递归列出、文件/目录操作、目录监听功能
 */
const { ipcMain, dialog } = require('electron')
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')

// 目录监听器管理
const watchers = new Map()
const fileTreeEmitter = new EventEmitter()

// H1: 当前项目路径，用于路径校验
let currentProjectPath = null

// H1: 路径安全校验 — 确保操作在项目目录内（Windows 大小写不敏感）
function isPathSafe(filePath) {
  if (!currentProjectPath) return true // 无项目时不限制（菜单打开等场景）
  try {
    const resolved = path.resolve(filePath)
    const base = path.resolve(currentProjectPath)
    if (process.platform === 'win32') {
      const r = resolved.toLowerCase()
      const b = base.toLowerCase()
      return r === b || r.startsWith(b + path.sep)
    }
    return resolved === base || resolved.startsWith(base + path.sep)
  } catch (e) {
    return false
  }
}

// Bug 4: 排除的目录列表（构建产物/缓存）
const EXCLUDED_DIRS = new Set([
  '.pio', '.pioenvs', '.piolibdeps',
  'node_modules', '__pycache__',
  '.git', '.vscode', '.idea'
])

// Bug 4: 默认最大递归深度
const DEFAULT_MAX_DEPTH = 10

/**
 * 异步递归列出目录结构（Bug 4: 改为 async，避免阻塞主线程）
 * @param {string} dirPath - 目录路径
 * @param {number} maxDepth - 最大递归深度
 * @param {number} currentDepth - 当前深度
 * @returns {Promise<Array<object>>} 树结构数组
 */
async function listDirectory(dirPath, maxDepth = DEFAULT_MAX_DEPTH, currentDepth = 0) {
  // Bug 4: 深度限制
  if (currentDepth >= maxDepth) {
    return []
  }

  try {
    const stat = await fs.promises.stat(dirPath)
    if (!stat.isDirectory()) {
      return []  // 不是目录，返回空数组（而非 null）
    }

    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true })

    // 过滤隐藏文件、系统文件和构建产物目录（Bug 4）
    const filtered = entries.filter(e => {
      if (e.name.startsWith('.')) return false
      if (EXCLUDED_DIRS.has(e.name)) return false
      return true
    })

    // 分离目录和文件，各自按名称排序
    const dirs = filtered.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))
    const files = filtered.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name))

    const children = []

    // 并行读取子目录，提升大项目加载速度
    const dirPromises = dirs.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name)
      const item = {
        name: entry.name,
        path: fullPath,
        type: 'directory'
      }

      try {
        item.children = await listDirectory(fullPath, maxDepth, currentDepth + 1)
      } catch (err) {
        item.children = []
      }
      item.expanded = false
      return item
    })

    const resolvedDirs = await Promise.all(dirPromises)

    for (const entry of files) {
      const fullPath = path.join(dirPath, entry.name)
      children.push({
        name: entry.name,
        path: fullPath,
        type: 'file',
        ext: path.extname(entry.name).toLowerCase()
      })
    }

    // 目录在前，文件在后
    return [...resolvedDirs, ...children]
  } catch (err) {
    console.error('列出目录失败:', dirPath, err.message)
    return []
  }
}

/**
 * 启动目录监听
 * Bug 5: fs.watch 失败时 fallback 到 fs.watchFile
 */
function startWatching(dirPath, webContents) {
  if (watchers.has(dirPath)) {
    return // 已在监听
  }

  const notifyChange = (eventType, filename) => {
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('file-tree-changed', { dirPath, eventType, filename })
    }
  }

  const createDebouncedNotify = () => {
    let debounceTimer = null
    return (eventType, filename) => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      debounceTimer = setTimeout(() => {
        notifyChange(eventType, filename)
        debounceTimer = null
      }, 200)
    }
  }

  const debouncedNotify = createDebouncedNotify()

  try {
    // Bug 5: 尝试使用 fs.watch（支持 recursive 选项）
    const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
      debouncedNotify(eventType, filename)
    })

    watcher.on('error', (err) => {
      console.error('fs.watch 出错，尝试 fallback 到 fs.watchFile:', dirPath, err.message)
      // Bug 5: fs.watch 失败时 fallback 到 fs.watchFile
      watchers.delete(dirPath)
      startWatchingFallback(dirPath, webContents)
    })

    watchers.set(dirPath, watcher)
  } catch (err) {
    console.error('fs.watch 启动失败，fallback 到 fs.watchFile:', dirPath, err.message)
    startWatchingFallback(dirPath, webContents)
  }
}

/**
 * Bug 5: fs.watch 的 fallback 实现
 * 使用 fs.watchFile 监听目录本身的变化
 */
function startWatchingFallback(dirPath, webContents) {
  if (watchers.has(dirPath)) {
    return
  }

  const debouncedNotify = (() => {
    let debounceTimer = null
    return (eventType, filename) => {
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
      debounceTimer = setTimeout(() => {
        if (webContents && !webContents.isDestroyed()) {
          webContents.send('file-tree-changed', { dirPath, eventType, filename })
        }
        debounceTimer = null
      }, 500) // fallback 模式使用更长的去抖动
    }
  })()

  try {
    // fs.watchFile 对目录进行轮询监听（每 5 秒）
    fs.watchFile(dirPath, { interval: 5000 }, (curr, prev) => {
      if (curr.mtimeMs !== prev.mtimeMs) {
        debouncedNotify('change', path.basename(dirPath))
      }
    })

    // 用对象包装以模拟 watcher.close() 接口
    const fallbackWatcher = {
      close: () => {
        fs.unwatchFile(dirPath)
      },
      _isFallback: true
    }

    watchers.set(dirPath, fallbackWatcher)
  } catch (err) {
    console.error('fs.watchFile 也失败了，放弃监听:', dirPath, err.message)
  }
}

/**
 * 停止目录监听
 */
function stopWatching(dirPath) {
  const watcher = watchers.get(dirPath)
  if (watcher) {
    try {
      if (watcher._isFallback) {
        fs.unwatchFile(dirPath)
      } else {
        watcher.close()
      }
    } catch (e) {
      // 忽略关闭错误
    }
    watchers.delete(dirPath)
  }
}

/**
 * 删除文件或目录
 */
function deleteItem(itemPath) {
  // Bug 4: 防御性错误处理，避免异常传播到主进程
  try {
    const stat = fs.statSync(itemPath)
    if (stat.isDirectory()) {
      fs.rmSync(itemPath, { recursive: true, force: true })
    } else {
      fs.unlinkSync(itemPath)
    }
  } catch (err) {
    throw new Error(`删除失败: ${err.message}`)
  }
}

/**
 * 重命名文件或目录
 */
function renameItem(oldPath, newPath) {
  fs.renameSync(oldPath, newPath)
}

/**
 * 创建目录
 */
function createDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true })
}

/**
 * 创建文件
 */
function createFile(filePath) {
  fs.writeFileSync(filePath, '', 'utf-8')
}

/**
 * 注册文件树 IPC 处理器
 * @param {Electron.Main} ipcMain
 * @param {Function} getWindow - 返回当前 mainWindow 的闭包函数
 */
function registerFileTreeIpc(ipcMain, getWindow) {
  // 递归列出目录（Bug 4: 异步）
  ipcMain.handle('file-tree-list', async (event, dirPath) => {
    return await listDirectory(dirPath)
  })

  // 启动目录监听
  ipcMain.handle('file-tree-watch', (event, dirPath) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) {
      startWatching(dirPath, win.webContents)
      return { success: true }
    }
    return { success: false, error: '窗口不可用' }
  })

  // 停止目录监听
  ipcMain.handle('file-tree-unwatch', (event, dirPath) => {
    stopWatching(dirPath)
    return { success: true }
  })

  // H1: 设置项目路径（用于路径校验）
  ipcMain.handle('file-tree-set-project', (event, projectPath) => {
    currentProjectPath = projectPath
    return { success: true }
  })

  // 删除文件/目录（带确认对话框）
  ipcMain.handle('file-delete', async (event, filePath) => {
    // H1: 路径校验
    if (!isPathSafe(filePath)) {
      return { success: false, error: '路径超出项目目录范围' }
    }
    const win = getWindow()
    const itemName = path.basename(filePath)

    if (win && !win.isDestroyed()) {
      const result = await dialog.showMessageBox(win, {
        type: 'warning',
        buttons: ['删除', '取消'],
        defaultId: 1,
        title: '确认删除',
        message: `确定删除 "${itemName}"？`,
        detail: '此操作不可撤销。'
      })

      if (result.response === 1) {
        return { success: false, canceled: true }
      }
    }

    try {
      deleteItem(filePath)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 重命名
  ipcMain.handle('file-rename', (event, oldPath, newPath) => {
    // H1: 路径校验
    if (!isPathSafe(oldPath) || !isPathSafe(newPath)) {
      return { success: false, error: '路径超出项目目录范围' }
    }
    try {
      renameItem(oldPath, newPath)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 创建目录
  ipcMain.handle('file-mkdir', (event, dirPath) => {
    // H1: 路径校验
    if (!isPathSafe(dirPath)) {
      return { success: false, error: '路径超出项目目录范围' }
    }
    try {
      createDirectory(dirPath)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 创建文件
  ipcMain.handle('file-create', (event, filePath) => {
    // H1: 路径校验
    if (!isPathSafe(filePath)) {
      return { success: false, error: '路径超出项目目录范围' }
    }
    try {
      createFile(filePath)
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 读取文件内容（M7: GBK 编码回退）
  ipcMain.handle('file-read', (event, filePath) => {
    // H1: 路径校验
    if (!isPathSafe(filePath)) {
      return { success: false, error: '路径超出项目目录范围' }
    }
    try {
      let content
      let encodingWarning = null
      try {
        content = fs.readFileSync(filePath, 'utf-8')
        if (content.includes('\uFFFD')) {
          throw new Error('UTF-8 decode produced replacement characters')
        }
      } catch (decodeErr) {
        // M7: 回退到 latin1 读取并检测中文字符
        const raw = fs.readFileSync(filePath, 'latin1')
        const hasChinese = /[\u4e00-\u9fff]/.test(raw)
        if (hasChinese) {
          encodingWarning = '该文件可能使用 GBK/GB2312 编码。当前以 latin1 方式读取，中文字符可能显示异常。建议转换为 UTF-8。'
        }
        content = raw
      }
      return { success: true, content, encodingWarning }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 保存文件内容
  ipcMain.handle('file-write', (event, filePath, content) => {
    // H1: 路径校验
    if (!isPathSafe(filePath)) {
      return { success: false, error: '路径超出项目目录范围' }
    }
    try {
      fs.writeFileSync(filePath, content, 'utf-8')
      return { success: true }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 获取文件信息（判断是文件还是目录）
  ipcMain.handle('file-stat', (event, filePath) => {
    // H1: 路径校验
    if (!isPathSafe(filePath)) {
      return { success: false, error: '路径超出项目目录范围' }
    }
    try {
      const stat = fs.statSync(filePath)
      return {
        success: true,
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory()
      }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 窗口关闭时清理所有监听器
  const win = getWindow()
  if (win) {
    win.on('closed', () => {
      for (const [dirPath] of watchers) {
        stopWatching(dirPath)
      }
    })
  }
}

module.exports = {
  listDirectory,
  registerFileTreeIpc,
  stopWatching
}
