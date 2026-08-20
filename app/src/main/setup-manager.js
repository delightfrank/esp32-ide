/**
 * ESP32 IDE - 安装管理器（主进程侧）
 * 负责检测环境、安装 PlatformIO 和 ESP32 工具链
 * 通过 IPC 实时推送进度到渲染进程
 */
const { app, ipcMain } = require('electron')
const { spawn, execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const https = require('https')
const http = require('http')
const os = require('os')

// ── 镜像源配置 ──

const MIRRORS = {
  tsinghua: {
    name: '清华大学镜像（推荐）',
    pipIndex: 'https://pypi.tuna.tsinghua.edu.cn/simple',
    description: '国内速度最快'
  },
  aliyun: {
    name: '阿里云镜像',
    pipIndex: 'https://mirrors.aliyun.com/pypi/simple/',
    description: '稳定可靠'
  },
  github: {
    name: 'GitHub 原始源',
    pipIndex: 'https://pypi.org/simple',
    description: '官方源，需要良好网络'
  },
  manual: {
    name: '手动指定路径',
    pipIndex: null,
    description: '已有 Python/PlatformIO 的用户跳过下载'
  }
}

// ESP32 工具链包列表
const TOOLCHAIN_PACKAGES = [
  { name: 'toolchain-xtensa-esp32s3', description: 'ESP32-S3 编译器' },
  { name: 'toolchain-xtensa-esp32', description: 'ESP32 编译器' },
  { name: 'toolchain-riscv32-esp', description: 'ESP32-C3 编译器' },
  { name: 'tool-esptoolpy', description: '烧录工具' }
]

// 安装状态
let setupStatus = {
  running: false,
  step: '',        // 当前步骤名
  progress: 0,     // 0-100
  message: '',     // 当前消息
  error: null,     // 错误信息
  environment: null // 环境检测结果
}

// ── 工具函数 ──

/**
 * 向渲染进程推送进度
 */
function sendProgress(mainWindowGetter, data) {
  setupStatus = { ...setupStatus, ...data }
  const mw = typeof mainWindowGetter === 'function' ? mainWindowGetter() : mainWindowGetter
  if (mw && !mw.isDestroyed()) {
    mw.webContents.send('setup-progress', setupStatus)
  }
}

/**
 * 下载文件
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const doDownload = (downloadUrl) => {
      const protocol = downloadUrl.startsWith('https') ? https : http
      protocol.get(downloadUrl, (res) => {
        // 处理重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doDownload(res.headers.location)
          return
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }

        const contentLength = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0

        const fileStream = fs.createWriteStream(destPath)

        res.on('data', (chunk) => {
          downloaded += chunk.length
          fileStream.write(chunk)
          if (onProgress && contentLength > 0) {
            onProgress(downloaded, contentLength)
          }
        })

        res.on('end', () => {
          fileStream.end(() => {
            resolve(destPath)
          })
        })

        res.on('error', (err) => {
          fileStream.end()
          reject(err)
        })
      }).on('error', reject)
    }

    doDownload(downloadUrl)
  })
}

/**
 * 执行命令并返回输出
 */
function runCommand(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code })
      } else {
        reject(new Error(`命令失败 (code ${code}): ${stderr || stdout}`))
      }
    })

    proc.on('error', reject)
  })
}

/**
 * 获取应用内置目录
 */
function getEmbeddedDir() {
  // 开发模式下：应用根目录
  // 打包后：app.asar 同级
  const appDir = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : path.resolve(__dirname, '../..')
  return appDir
}

// ── 环境检测 ──

/**
 * 检测 Python、PlatformIO、ESP32 工具链是否可用
 */
async function checkEnvironment() {
  const result = {
    python: { available: false, path: null, version: null },
    platformio: { available: false, path: null, version: null },
    toolchains: {},
    embedded: { python: false, platformio: false },
    ready: false
  }

  // 检测内置 Python
  const appDir = getEmbeddedDir()
  const embeddedPython = process.platform === 'win32'
    ? path.join(appDir, 'python', 'python.exe')
    : path.join(appDir, 'python', 'bin', 'python3')

  if (fs.existsSync(embeddedPython)) {
    result.embedded.python = true
    result.python.available = true
    result.python.path = embeddedPython
    try {
      const ver = execSync(`"${embeddedPython}" --version`, { encoding: 'utf8', timeout: 5000 }).trim()
      result.python.version = ver
    } catch { /* 忽略 */ }
  }

  // 检测系统 Python
  if (!result.python.available) {
    try {
      const ver = execSync('python3 --version || python --version', { encoding: 'utf8', timeout: 5000 }).trim()
      result.python.available = true
      result.python.version = ver
      result.python.path = process.platform === 'win32' ? 'python' : 'python3'
    } catch { /* 忽略 */ }
  }

  // 检测内置 PlatformIO
  const embeddedPio = process.platform === 'win32'
    ? path.join(appDir, 'platformio', 'Scripts', 'platformio.exe')
    : path.join(appDir, 'platformio', 'bin', 'platformio')

  if (fs.existsSync(embeddedPio)) {
    result.embedded.platformio = true
    result.platformio.available = true
    result.platformio.path = embeddedPio
    try {
      const ver = execSync(`"${embeddedPio}" --version`, { encoding: 'utf8', timeout: 5000 }).trim()
      result.platformio.version = ver
    } catch { /* 忽略 */ }
  }

  // 检测系统 PlatformIO
  if (!result.platformio.available) {
    try {
      const ver = execSync('pio --version', { encoding: 'utf8', timeout: 5000 }).trim()
      result.platformio.available = true
      result.platformio.version = ver
      result.platformio.path = 'pio'
    } catch { /* 忽略 */ }
  }

  // 检测工具链
  const packagesDir = path.join(appDir, 'toolchain')
  const systemPackagesDir = path.join(os.homedir(), '.platformio', 'packages')

  for (const tc of TOOLCHAIN_PACKAGES) {
    const embeddedPath = path.join(packagesDir, tc.name)
    const systemPath = path.join(systemPackagesDir, tc.name)

    if (fs.existsSync(embeddedPath) || fs.existsSync(systemPath)) {
      result.toolchains[tc.name] = {
        available: true,
        path: fs.existsSync(embeddedPath) ? embeddedPath : systemPath,
        embedded: fs.existsSync(embeddedPath)
      }
    } else {
      result.toolchains[tc.name] = { available: false }
    }
  }

  // 判断是否就绪
  result.ready = result.python.available && result.platformio.available

  setupStatus.environment = result
  return result
}

/**
 * 安装 PlatformIO
 */
async function installPlatformio(mirror, mainWindowGetter) {
  sendProgress(mainWindowGetter, {
    running: true,
    step: 'platformio',
    progress: 10,
    message: '正在安装 PlatformIO Core...',
    error: null
  })

  // 检查 Python 是否可用
  if (!setupStatus.environment?.python?.available) {
    sendProgress(mainWindowGetter, {
      running: false,
      error: '未找到 Python，请先安装 Python 3.8+',
      message: '安装失败：缺少 Python'
    })
    return false
  }

  const pythonCmd = setupStatus.environment.python.path || 'python3'
  const mirrorConfig = MIRRORS[mirror] || MIRRORS.github

  try {
    sendProgress(mainWindowGetter, {
      progress: 20,
      message: `使用 ${mirrorConfig.name} 安装 PlatformIO...`
    })

    // 使用 pip 安装 PlatformIO
    const pipArgs = [
      '-m', 'pip', 'install',
      '-i', mirrorConfig.pipIndex,
      '--quiet',
      'platformio'
    ]

    await runCommand(pythonCmd, pipArgs, { timeout: 300000 })

    sendProgress(mainWindowGetter, {
      progress: 60,
      message: 'PlatformIO Core 安装完成'
    })

    return true
  } catch (err) {
    sendProgress(mainWindowGetter, {
      running: false,
      error: `PlatformIO 安装失败: ${err.message}`,
      message: '安装失败'
    })
    return false
  }
}

/**
 * 下载 ESP32 工具链
 */
async function installToolchains(mirror, mainWindowGetter) {
  sendProgress(mainWindowGetter, {
    running: true,
    step: 'toolchains',
    progress: 70,
    message: '正在下载 ESP32 工具链...',
    error: null
  })

  const mirrorConfig = MIRRORS[mirror] || MIRRORS.github

  // 尝试通过 pio pkg install 安装
  const pioCmd = setupStatus.environment?.platformio?.path || 'pio'

  try {
    for (let i = 0; i < TOOLCHAIN_PACKAGES.length; i++) {
      const tc = TOOLCHAIN_PACKAGES[i]
      const progress = 70 + Math.floor((i / TOOLCHAIN_PACKAGES.length) * 28)

      sendProgress(mainWindowGetter, {
        progress,
        message: `安装 ${tc.description}...`
      })

      try {
        await runCommand(pioCmd, ['pkg', 'install', '-g', '-l', tc.name, '--no-interaction'], {
          timeout: 180000
        })
        sendProgress(mainWindowGetter, {
          message: `✅ ${tc.description} 安装完成`
        })
      } catch (err) {
        sendProgress(mainWindowGetter, {
          message: `⚠️ ${tc.description} 安装失败: ${err.message}`
        })
      }
    }

    sendProgress(mainWindowGetter, {
      progress: 98,
      message: '工具链安装完成'
    })

    return true
  } catch (err) {
    sendProgress(mainWindowGetter, {
      running: false,
      error: `工具链安装失败: ${err.message}`,
      message: '安装失败'
    })
    return false
  }
}

/**
 * 获取当前安装状态
 */
function getSetupStatus() {
  return { ...setupStatus }
}

/**
 * 注册 setup-manager 的 IPC 处理器
 */
function registerSetupIpc(ipcMain, mainWindowGetter) {
  // 环境检测
  ipcMain.handle('setup-check-env', async () => {
    return await checkEnvironment()
  })

  // 开始安装（M3: 并发保护）
  ipcMain.handle('setup-install', async (event, mirror) => {
    if (setupStatus.running) {
      return { success: false, error: '安装任务已在进行中' }
    }
    setupStatus.running = true
    setupStatus.error = null

    sendProgress(mainWindowGetter, {
      running: true,
      step: 'start',
      progress: 0,
      message: '开始安装环境...'
    })

    // 步骤 1：安装 PlatformIO
    const pioOk = await installPlatformio(mirror, mainWindowGetter)
    if (!pioOk && mirror !== 'manual') {
      setupStatus.running = false
      return { success: false, error: setupStatus.error }
    }

    // 步骤 2：安装工具链
    const tcOk = await installToolchains(mirror, mainWindowGetter)

    // 步骤 3：重新检测环境
    sendProgress(mainWindowGetter, {
      progress: 95,
      message: '重新检测环境...'
    })

    const newEnv = await checkEnvironment()
    sendProgress(mainWindowGetter, {
      running: false,
      progress: 100,
      message: '安装完成！',
      environment: newEnv
    })

    return { success: true, environment: newEnv }
  })

  // 获取状态
  ipcMain.handle('setup-get-status', () => {
    return getSetupStatus()
  })
}

module.exports = {
  checkEnvironment,
  installPlatformio,
  installToolchains,
  getSetupStatus,
  registerSetupIpc,
  getEmbeddedDir,
  MIRRORS,
  TOOLCHAIN_PACKAGES
}
