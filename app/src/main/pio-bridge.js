/**
 * ESP32 IDE - PlatformIO 桥接模块
 * 封装 PlatformIO CLI 调用，通过 IPC 实时推送输出到渲染进程
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { app } = require('electron')

const BUILD_TIMEOUT = 10 * 60 * 1000 // 10 分钟编译超时

// 活跃的编译进程
let activeProcess = null
let buildTimeoutTimer = null
let isBuilding = false
let buildLockToken = 0  // 防穿透锁：快速连续调用时保证原子性

/**
 * 获取 PlatformIO 可执行文件路径
 * 优先使用内置 PlatformIO（完整离线版），否则 fallback 到系统 PATH
 */
function getPioCommand() {
  // 获取应用根目录
  const appDir = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : path.resolve(__dirname, '../..')

  // 检测内置 PlatformIO
  const embeddedPio = path.join(appDir, 'platformio', 'bin', 'platformio')
  const embeddedPioWin = path.join(appDir, 'platformio', 'Scripts', 'platformio.exe')

  if (process.platform !== 'win32' && fs.existsSync(embeddedPio)) {
    return embeddedPio
  }
  if (process.platform === 'win32' && fs.existsSync(embeddedPioWin)) {
    return embeddedPioWin
  }

  // Fallback 到系统 pio
  return 'pio'
}

/**
 * 解析 mainWindowGetter 为实际窗口引用
 * 支持函数（闭包）或直接引用两种模式
 */
function resolveWindow(mainWindowGetter) {
  if (typeof mainWindowGetter === 'function') {
    return mainWindowGetter()
  }
  return mainWindowGetter
}

/**
 * 执行 PlatformIO 命令并实时推送输出
 * @param {Function|Electron.BrowserWindow} mainWindowGetter - 获取主窗口的函数或直接引用
 * @param {string} command - pio 子命令，如 'run', 'run -t clean'
 * @param {object} options - 额外选项
 * @param {string} options.cwd - 工作目录（项目路径）
 * @returns {Promise<{success: boolean, code: number}>}
 */
function runPio(mainWindowGetter, command, options = {}) {
  return new Promise((resolve, reject) => {
    if (isBuilding) {
      reject(new Error('已有编译任务在进行中'))
      return
    }

    // 原子性获取锁：防止极快连续调用穿透
    const myToken = ++buildLockToken
    isBuilding = true
    const cwd = options.cwd || process.cwd()
    const args = command.split(/\s+/)

    // 通知渲染进程：编译开始
    const mw = resolveWindow(mainWindowGetter)
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send('pio-status', { status: 'building' })
      mw.webContents.send('pio-output', { type: 'start', command: `pio ${command}` })
    }

    const pio = spawn(getPioCommand(), args, {
      cwd,
      shell: true,
      env: {
        ...process.env,
        PLATFORMIO_CORE_DIR: path.join(os.homedir(), '.platformio'),
      }
    })

    activeProcess = pio

    // 编译超时保护：10 分钟后强制终止
    buildTimeoutTimer = setTimeout(() => {
      if (activeProcess) {
        activeProcess.kill('SIGTERM')
        isBuilding = false
        activeProcess = null
        const mwTimeout = resolveWindow(mainWindowGetter)
        if (mwTimeout && !mwTimeout.isDestroyed()) {
          mwTimeout.webContents.send('pio-output', { type: 'error', message: '编译超时（10分钟），已自动终止' })
          mwTimeout.webContents.send('pio-status', { status: 'error', message: '编译超时' })
        }
      }
      buildTimeoutTimer = null
    }, BUILD_TIMEOUT)

    let stdout = ''
    let stderr = ''

    // 实时推送标准输出
    pio.stdout.on('data', (data) => {
      const text = data.toString()
      stdout += text
      const mwOut = resolveWindow(mainWindowGetter)
      if (mwOut && !mwOut.isDestroyed()) {
        mwOut.webContents.send('pio-output', { type: 'stdout', data: text })
      }
    })

    // 实时推送标准错误
    pio.stderr.on('data', (data) => {
      const text = data.toString()
      stderr += text
      const mwErr = resolveWindow(mainWindowGetter)
      if (mwErr && !mwErr.isDestroyed()) {
        mwErr.webContents.send('pio-output', { type: 'stderr', data: text })
      }
    })

    // 进程结束
    pio.on('close', (code) => {
      if (myToken !== buildLockToken) return  // 已被新任务替换
      isBuilding = false
      activeProcess = null
      if (buildTimeoutTimer) {
        clearTimeout(buildTimeoutTimer)
        buildTimeoutTimer = null
      }

      const success = code === 0
      const status = success ? 'success' : 'error'

      const mwClose = resolveWindow(mainWindowGetter)
      if (mwClose && !mwClose.isDestroyed()) {
        mwClose.webContents.send('pio-output', { type: 'end', code })
        mwClose.webContents.send('pio-status', { status, code })
      }

      resolve({ success, code, stdout, stderr })
    })

    // 进程错误
    pio.on('error', (err) => {
      if (myToken !== buildLockToken) return
      isBuilding = false
      activeProcess = null
      if (buildTimeoutTimer) {
        clearTimeout(buildTimeoutTimer)
        buildTimeoutTimer = null
      }

      const mwErr2 = resolveWindow(mainWindowGetter)
      if (mwErr2 && !mwErr2.isDestroyed()) {
        mwErr2.webContents.send('pio-output', { type: 'error', message: err.message })
        mwErr2.webContents.send('pio-status', { status: 'error', message: err.message })
      }

      reject(err)
    })
  })
}

/**
 * 编译项目
 */
function build(mainWindowGetter, projectPath) {
  return runPio(mainWindowGetter, 'run', { cwd: projectPath })
}

/**
 * 清理构建产物
 */
function clean(mainWindowGetter, projectPath) {
  return runPio(mainWindowGetter, 'run -t clean', { cwd: projectPath })
}

/**
 * 烧录项目（预留接口，Phase 3 使用）
 */
function upload(mainWindowGetter, projectPath, port) {
  return runPio(mainWindowGetter, `run -t upload --upload-port ${port}`, { cwd: projectPath })
}

/**
 * 初始化 PlatformIO 项目
 */
function projectInit(mainWindowGetter, projectPath, options = {}) {
  const board = options.board || 'esp32-s3-devkitc-1'
  const framework = options.framework || 'arduino'
  return runPio(mainWindowGetter, `project init --board ${board} --framework ${framework}`, { cwd: projectPath })
}

/**
 * 获取当前编译状态
 */
function getBuildStatus() {
  return { isBuilding, hasActiveProcess: activeProcess !== null }
}

/**
 * 终止当前编译进程
 */
function killBuild() {
  if (buildTimeoutTimer) {
    clearTimeout(buildTimeoutTimer)
    buildTimeoutTimer = null
  }
  if (activeProcess) {
    activeProcess.kill('SIGTERM')
    isBuilding = false
    activeProcess = null
    return true
  }
  return false
}

/**
 * 注册所有 PIO 相关 IPC 处理器
 * @param {Electron.Main} ipcMain
 * @param {Function} mainWindowGetter - 返回当前 mainWindow 的闭包函数
 */
function registerPioIpc(ipcMain, mainWindowGetter) {
  // 编译
  ipcMain.handle('pio-build', async (event, projectPath) => {
    try {
      const result = await build(mainWindowGetter, projectPath)
      return result
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 清理
  ipcMain.handle('pio-clean', async (event, projectPath) => {
    try {
      const result = await clean(mainWindowGetter, projectPath)
      return result
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 烧录（预留）
  ipcMain.handle('pio-upload', async (event, projectPath, port) => {
    try {
      const result = await upload(mainWindowGetter, projectPath, port)
      return result
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 项目初始化
  ipcMain.handle('pio-init', async (event, projectPath, options) => {
    try {
      const result = await projectInit(mainWindowGetter, projectPath, options)
      return result
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // 获取编译状态
  ipcMain.handle('pio-status-query', () => {
    return getBuildStatus()
  })

  // 终止编译
  ipcMain.handle('pio-kill', () => {
    return killBuild()
  })
}

module.exports = {
  build,
  clean,
  upload,
  projectInit,
  getBuildStatus,
  killBuild,
  registerPioIpc,
  runPio
}
