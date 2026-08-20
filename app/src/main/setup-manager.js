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
 * 不使用 shell，避免路径含空格时被 cmd 解析错误
 * 传递 PYTHONIOENCODING=utf-8 避免 Python 中文编码错误
 */
function runCommand(cmd, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONLEGACYWINDOWSSTDIO: '1'
      },
      ...options
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (data) => {
      stdout += data.toString('utf-8')
    })

    proc.stderr.on('data', (data) => {
      stderr += data.toString('utf-8')
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

  const appDir = getEmbeddedDir()

  // P3: 用异步 spawn 替代 execSync，不阻塞主进程
  async function getVersion(cmd, args, timeout = 5000) {
    return new Promise((resolve) => {
      const proc = spawn(cmd, args, {
        timeout,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONIOENCODING: 'utf-8'
        }
      })
      let stdout = ''
      let stderr = ''
      proc.stdout.on('data', (d) => { stdout += d.toString('utf-8') })
      // 注意：python --version 输出到 stderr，必须合并读取，否则系统 Python 永远检测不到
      proc.stderr.on('data', (d) => { stderr += d.toString('utf-8') })
      proc.on('close', () => resolve((stdout + stderr).trim()))
      proc.on('error', () => resolve(null))
    })
  }

  // 检测内置 Python
  const embeddedPython = process.platform === 'win32'
    ? path.join(appDir, 'python', 'python.exe')
    : path.join(appDir, 'python', 'bin', 'python3')

  if (fs.existsSync(embeddedPython)) {
    result.embedded.python = true
    result.python.available = true
    result.python.path = embeddedPython
    const ver = await getVersion(embeddedPython, ['--version'])
    if (ver) result.python.version = ver
  }

  // 检测系统 Python
  if (!result.python.available) {
    const py3 = process.platform === 'win32' ? 'python' : 'python3'
    const ver = await getVersion(py3, ['--version'])
    if (ver) {
      result.python.available = true
      result.python.version = ver
      result.python.path = py3
    }
  }

  // 检测内置 PlatformIO
  const embeddedPio = process.platform === 'win32'
    ? path.join(appDir, 'platformio', 'Scripts', 'platformio.exe')
    : path.join(appDir, 'platformio', 'bin', 'platformio')

  if (fs.existsSync(embeddedPio)) {
    result.embedded.platformio = true
    result.platformio.available = true
    result.platformio.path = embeddedPio
    const ver = await getVersion(embeddedPio, ['--version'])
    if (ver) result.platformio.version = ver
  }

  // 检测系统 PlatformIO
  if (!result.platformio.available) {
    const ver = await getVersion('pio', ['--version'])
    if (ver) {
      result.platformio.available = true
      result.platformio.version = ver
      result.platformio.path = 'pio'
    }
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

  // 判断是否就绪：Python + PlatformIO + 至少一个工具链
  const hasToolchains = Object.values(result.toolchains).some(tc => tc.available)
  result.ready = result.python.available && result.platformio.available && hasToolchains

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

    // BUG-9: 手动模式：验证 pio 是否真的可用
    if (mirror === 'manual') {
      const pioCheck = await getVersion('pio', ['--version'])
      if (pioCheck) {
        sendProgress(mainWindowGetter, {
          progress: 60,
          message: '手动模式：检测到系统 PlatformIO，跳过下载'
        })
        return true
      } else {
        sendProgress(mainWindowGetter, {
          running: false,
          error: '手动模式下未检测到 PlatformIO（pio 命令不可用）。请先安装 PlatformIO：pip install platformio',
          message: '安装失败'
        })
        return false
      }
    }

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
 * 从 GitHub 直接下载工具链（当 dl.espressif.com 不可用时的备用方案）
 * @param {string} toolName - 工具链名称
 * @param {string} pioPackagesDir - PlatformIO 包安装目录
 * @param {Function} onProgress - 进度回调
 */
async function downloadToolchainFromGithub(toolName, pioPackagesDir, onProgress) {
  // GitHub 上的工具链 URL（esp-2021r2-patch5 版本，稳定版）
  // Mirror list: try npmmirror first (fast in China), then GitHub as fallback
  const toolchainMirrors = {
    'toolchain-xtensa-esp32': [
      'https://registry.npmmirror.com/-/binary/espressif-dl/toolchains/xtensa-esp32-elf-gcc8_4_0-esp-2021r2-patch5-win64.zip',
      'https://github.com/espressif/crosstool-NG/releases/download/esp-2021r2-patch5/xtensa-esp32-elf-gcc8_4_0-esp-2021r2-patch5-win64.zip'
    ],
    'toolchain-xtensa-esp32s3': [
      'https://registry.npmmirror.com/-/binary/espressif-dl/toolchains/xtensa-esp32s3-elf-gcc8_4_0-esp-2021r2-patch5-win64.zip',
      'https://github.com/espressif/crosstool-NG/releases/download/esp-2021r2-patch5/xtensa-esp32s3-elf-gcc8_4_0-esp-2021r2-patch5-win64.zip'
    ],
    'toolchain-riscv32-esp': [
      'https://registry.npmmirror.com/-/binary/espressif-dl/toolchains/riscv32-esp-elf-gcc8_4_0-esp-2021r2-patch5-win64.zip',
      'https://github.com/espressif/crosstool-NG/releases/download/esp-2021r2-patch5/riscv32-esp-elf-gcc8_4_0-esp-2021r2-patch5-win64.zip'
    ]
  }

  const urls = toolchainMirrors[toolName]
  if (!urls) {
    throw new Error(`No download URL found for ${toolName}`)
  }

  const targetDir = path.join(pioPackagesDir, toolName)
  const tmpDir = path.join(os.tmpdir(), 'toolchain-download-' + Date.now())

  try {
    fs.mkdirSync(tmpDir, { recursive: true })
    const zipFile = path.join(tmpDir, `${toolName}.zip`)

    // Try each mirror URL in order (npmmirror first, GitHub fallback)
    const https = require('https')
    const http = require('http')
    let lastError = null
    for (let i = 0; i < urls.length; i++) {
      const tryUrl = urls[i]
      const source = tryUrl.includes('npmmirror') ? 'npmmirror' : 'GitHub'
      onProgress(`Trying ${source} (${i + 1}/${urls.length})...`)
      try {
        await new Promise((resolve, reject) => {
          const protocol = tryUrl.startsWith('https') ? https : http
          const doGet = (u) => {
            protocol.get(u, (res) => {
              if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                doGet(res.headers.location)
                return
              }
              if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); return }
              const fileStream = fs.createWriteStream(zipFile)
              res.pipe(fileStream)
              fileStream.on('finish', () => { fileStream.close(); resolve() })
              fileStream.on('error', reject)
            }).on('error', reject)
          }
          doGet(tryUrl)
        })
        lastError = null
        break
      } catch (err) {
        lastError = err
        onProgress(`${source} failed: ${err.message}`)
      }
    }
    if (lastError) throw lastError
    onProgress(`解压 ${toolName}...`)

    // 解压到目标目录
    const { execSync } = require('child_process')
    // 使用 PowerShell 解压 ZIP
    execSync(`powershell -Command "Expand-Archive -Path '${zipFile}' -DestinationPath '${tmpDir}\\extracted' -Force"`)

    // 移动到正确位置
    // GitHub 下载的 ZIP 内部目录结构：xtensa-esp32-elf/ 或直接是工具链文件
    const extractedDir = path.join(tmpDir, 'extracted')
    const entries = fs.readdirSync(extractedDir)

    fs.mkdirSync(targetDir, { recursive: true })
    for (const entry of entries) {
      const src = path.join(extractedDir, entry)
      const dst = path.join(targetDir, entry)
      fs.cpSync(src, dst, { recursive: true })
    }

    onProgress(`${toolName} 安装完成`)
    return true
  } catch (err) {
    onProgress(`${toolName} 下载失败: ${err.message}`)
    throw err
  } finally {
    // 清理临时目录
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) { /* ignore */ }
  }
}

/**
 * 下载 ESP32 工具链
 * 优先使用 PlatformIO（dl.espressif.com），失败后自动从 GitHub 下载
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

  // 修复：创建临时目录配置 PlatformIO 使用国内镜像
  const os = require('os')
  const tmpDir = path.join(os.tmpdir(), 'pio-install-' + Date.now())
  fs.mkdirSync(tmpDir, { recursive: true })

  // 创建临时 platformio.ini 配置镜像
  const iniContent = `
[platformio]
src_dir = src

[env:esp32]
platform = espressif32
board = esp32dev
framework = arduino
`
  fs.writeFileSync(path.join(tmpDir, 'platformio.ini'), iniContent)
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true })

  // 尝试通过 pio pkg install 安装
  const pioCmd = setupStatus.environment?.platformio?.path || 'pio'

  try {
    const failures = []
    const pioPackagesDir = path.join(os.homedir(), '.platformio', 'packages')

    for (let i = 0; i < TOOLCHAIN_PACKAGES.length; i++) {
      const tc = TOOLCHAIN_PACKAGES[i]
      const progress = 70 + Math.floor((i / TOOLCHAIN_PACKAGES.length) * 28)

      sendProgress(mainWindowGetter, {
        progress,
        message: `安装 ${tc.description}...`
      })

      // 检查是否已安装
      const targetDir = path.join(pioPackagesDir, tc.name)
      if (fs.existsSync(targetDir)) {
        sendProgress(mainWindowGetter, { message: `✅ ${tc.description} 已存在，跳过` })
        continue
      }

      let installed = false

      // 方案 1：尝试 PlatformIO 自动安装（30 秒超时）
      try {
        sendProgress(mainWindowGetter, { message: `尝试 PlatformIO 安装 ${tc.description}...` })
        await runCommand(pioCmd, ['pkg', 'install', '-g', '-t', tc.name], {
          cwd: tmpDir,
          timeout: 30000  // 30 秒超时
        })
        installed = true
        sendProgress(mainWindowGetter, { message: `✅ ${tc.description} 安装完成（PlatformIO）` })
      } catch (pioErr) {
        // PlatformIO 失败，尝试 GitHub 备用下载
        sendProgress(mainWindowGetter, { message: `PlatformIO 安装失败，尝试从 GitHub 下载...` })
      }

      // 方案 2：从 GitHub 直接下载
      if (!installed) {
        try {
          await downloadToolchainFromGithub(tc.name, pioPackagesDir, (msg) => {
            sendProgress(mainWindowGetter, { message: msg })
          })
          installed = true
          sendProgress(mainWindowGetter, { message: `✅ ${tc.description} 安装完成（GitHub）` })
        } catch (ghErr) {
          failures.push(tc.name)
          sendProgress(mainWindowGetter, {
            message: `⚠️ ${tc.description} 安装失败: ${ghErr.message}`
          })
        }
      }
    }

    setupStatus.toolchainFailures = failures

    // 全部失败才算安装失败，并给出手动安装命令作为补救措施
    if (failures.length === TOOLCHAIN_PACKAGES.length) {
      sendProgress(mainWindowGetter, {
        running: false,
        error: `工具链全部安装失败（${failures.join('、')}）。请检查网络后重试，或手动执行：\n${failures.map(tc => `pio pkg install -g -t ${tc}`).join('\n')}`,
        message: '安装失败'
      })
      return false
    }

    sendProgress(mainWindowGetter, {
      progress: 98,
      message: failures.length > 0 ? `工具链部分安装完成（失败 ${failures.length} 项，可稍后重试）` : '工具链安装完成'
    })

    return true
  } catch (err) {
    sendProgress(mainWindowGetter, {
      running: false,
      error: `工具链安装失败: ${err.message}`,
      message: '安装失败'
    })
    return false
  } finally {
    // 清理临时目录
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch (e) { /* ignore */ }
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

    // 步骤 2：安装工具链（全部失败时返回失败，避免误报"安装完成"）
    const tcOk = await installToolchains(mirror, mainWindowGetter)
    if (!tcOk) {
      setupStatus.running = false
      return { success: false, error: setupStatus.error || '工具链安装失败' }
    }

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
  downloadToolchainFromGithub,
  getSetupStatus,
  registerSetupIpc,
  getEmbeddedDir,
  MIRRORS,
  TOOLCHAIN_PACKAGES
}
