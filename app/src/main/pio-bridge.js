/**
 * ESP32 IDE - PlatformIO 桥接模块
 * 封装 PlatformIO CLI 调用，通过 IPC 实时推送输出到渲染进程
 */
const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { app } = require('electron')
const { downloadToolchainFromGithub } = require('./setup-manager')

const BUILD_TIMEOUT = 10 * 60 * 1000 // 10 分钟编译超时

// 活跃的编译进程
let activeProcess = null
let buildTimeoutTimer = null
let isBuilding = false
let buildLockToken = 0  // 防穿透锁：快速连续调用时保证原子性
let downloadDetected = false  // 检测是否在下载依赖

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
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONLEGACYWINDOWSSTDIO: '1',
        PYTHONHTTPSVERIFY: '0',
        PLATFORMIO_CORE_DIR: path.join(os.homedir(), '.platformio'),
      }
    })

    activeProcess = pio

    // 编译超时保护：10 分钟后强制终止
    buildTimeoutTimer = setTimeout(() => {
      if (activeProcess) {
        timedOut = true
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
    let timedOut = false  // M5: 超时标记，防止 close 重复报错
    const MAX_OUTPUT_BYTES = 2 * 1024 * 1024  // M5: 输出截断到 2MB

    // 实时推送标准输出
    pio.stdout.on('data', (data) => {
      const text = data.toString('utf-8')
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += text
      const mwOut = resolveWindow(mainWindowGetter)
      if (mwOut && !mwOut.isDestroyed()) {
        mwOut.webContents.send('pio-output', { type: 'stdout', data: text })
      }

      // 检测下载状态，给用户实时反馈
      if (text.includes('Downloading') || text.includes('下载')) {
        downloadDetected = true
      }
    })

    // 实时推送标准错误
    pio.stderr.on('data', (data) => {
      const text = data.toString('utf-8')
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += text
      const mwErr = resolveWindow(mainWindowGetter)
      if (mwErr && !mwErr.isDestroyed()) {
        mwErr.webContents.send('pio-output', { type: 'stderr', data: text })
      }

      // 检测下载错误
      if (text.includes('ConnectionError') || text.includes('TimeoutError') || text.includes('超时')) {
        const mwErr2 = resolveWindow(mainWindowGetter)
        if (mwErr2 && !mwErr2.isDestroyed()) {
          mwErr2.webContents.send('pio-output', {
            type: 'stderr',
            data: '\n[提示] 下载超时，可能是 dl.espressif.com 访问受限。请配置代理或使用国内镜像。'
          })
        }
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

      // M5: 超时已发过 error，跳过 close 的重复报错
      if (timedOut) {
        resolve({ success: false, code, stdout, stderr })
        return
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
 * 编译项目（编译前检查工具链，缺失时自动从 GitHub 下载）
 */
async function build(mainWindowGetter, projectPath) {
  // 编译前检查：验证工具链是否已安装
  const pioPackagesDir = path.join(os.homedir(), '.platformio', 'packages')

  // 读取 platformio.ini 检查需要哪个芯片的工具链
  const iniPath = path.join(projectPath, 'platformio.ini')
  let needsEsp32 = true
  let needsEsp32s3 = false
  let needsEsp32c3 = false

  try {
    const iniContent = fs.readFileSync(iniPath, 'utf-8').toLowerCase()
    if (iniContent.includes('esp32-s3') || iniContent.includes('esp32s3')) {
      needsEsp32s3 = true
      needsEsp32 = false
    } else if (iniContent.includes('esp32-c3') || iniContent.includes('esp32c3')) {
      needsEsp32c3 = true
      needsEsp32 = false
    }
  } catch (e) { /* 文件不存在或读取失败，继续尝试编译 */ }

  // 检查必要的工具链是否已安装
  const missingTools = []
  if (needsEsp32 && !fs.existsSync(path.join(pioPackagesDir, 'toolchain-xtensa-esp32'))) {
    missingTools.push('toolchain-xtensa-esp32')
  }
  if (needsEsp32s3 && !fs.existsSync(path.join(pioPackagesDir, 'toolchain-xtensa-esp32s3'))) {
    missingTools.push('toolchain-xtensa-esp32s3')
  }
  if (needsEsp32c3 && !fs.existsSync(path.join(pioPackagesDir, 'toolchain-riscv32-esp'))) {
    missingTools.push('toolchain-riscv32-esp')
  }

  if (missingTools.length > 0) {
    const mw = resolveWindow(mainWindowGetter)

    // 尝试自动下载缺失的工具链
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send('pio-output', {
        type: 'stdout',
        data: `\n📦 检测到缺少工具链，正在自动下载...\n`
      })
    }

    for (const toolName of missingTools) {
      try {
        if (mw && !mw.isDestroyed()) {
          mw.webContents.send('pio-output', {
            type: 'stdout',
            data: `  ⬇️ 下载 ${toolName}...\n`
          })
        }

        await downloadToolchainFromGithub(toolName, pioPackagesDir, (msg) => {
          if (mw && !mw.isDestroyed()) {
            mw.webContents.send('pio-output', { type: 'stdout', data: `  ${msg}\n` })
          }
        })

        if (mw && !mw.isDestroyed()) {
          mw.webContents.send('pio-output', {
            type: 'stdout',
            data: `  ✅ ${toolName} 安装完成\n`
          })
        }
      } catch (err) {
        if (mw && !mw.isDestroyed()) {
          mw.webContents.send('pio-output', {
            type: 'stdout',
            data: `  ❌ ${toolName} 下载失败: ${err.message}\n`
          })
        }
        // 下载失败，返回错误
        if (mw && !mw.isDestroyed()) {
          mw.webContents.send('pio-output', {
            type: 'stdout',
            data: '\n请手动安装工具链：\n'
          })
          mw.webContents.send('pio-output', {
            type: 'stdout',
            data: '  工具 → 首次启动向导 → 选择国内镜像 → 开始安装\n'
          })
          mw.webContents.send('pio-status', { status: 'error', message: '工具链下载失败' })
        }
        return { success: false, code: 1, error: `工具链下载失败: ${err.message}` }
      }
    }

    // 下载成功，继续编译
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send('pio-output', {
        type: 'stdout',
        data: '\n🔨 工具链就绪，开始编译...\n\n'
      })
    }
  }

  return runPio(mainWindowGetter, 'run', { cwd: projectPath })
}

/**
 * 清理构建产物
 */
function clean(mainWindowGetter, projectPath) {
  return runPio(mainWindowGetter, 'run -t clean', { cwd: projectPath })
}

/**
 * 烧录项目
 */
function upload(mainWindowGetter, projectPath, port) {
  // H2: 端口号白名单校验（无 shell 的 spawn 已消除命令注入，这里再挡一层参数污染）
  const p = String(port || '').trim()
  if (!/^(COM\d+|\/dev\/[^\s/]+)$/i.test(p)) {
    return Promise.reject(new Error(`无效的串口端口号: ${p}`))
  }
  return runPio(mainWindowGetter, `run -t upload --upload-port ${p}`, { cwd: projectPath })
}

/**
 * 初始化 PlatformIO 项目
 */
function projectInit(mainWindowGetter, projectPath, options = {}) {
  const board = String(options.board || 'esp32-s3-devkitc-1')
  const framework = String(options.framework || 'arduino')
  // H2: board/framework 枚举校验
  if (!/^[A-Za-z0-9_-]+$/.test(board) || !/^[A-Za-z0-9_-]+$/.test(framework)) {
    return Promise.reject(new Error('无效的 board/framework 参数'))
  }
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
