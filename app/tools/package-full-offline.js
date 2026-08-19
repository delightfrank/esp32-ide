#!/usr/bin/env node

/**
 * ESP32 IDE 完整离线版打包脚本
 * 功能：下载便携版 Python + PlatformIO + ESP32 工具链，打包成开箱即用的离线版
 *
 * 用法：node tools/package-full-offline.js [--platform win32] [--arch x64]
 *
 * 输出：release/ESP32-IDE-full-{platform}-{arch}/
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')
const os = require('os')

// ── 常量 ──

const ROOT = path.resolve(__dirname, '..')
const RELEASE_DIR = path.join(ROOT, 'release')
const TEMP_DIR = path.join(ROOT, '.package-temp')
const PLATFORMIO_CACHE = path.join(os.homedir(), '.platformio')

// 便携版 Python 版本
const PYTHON_VERSION = '3.11.9'

// 便携版 Python 下载地址
const PYTHON_URLS = {
  'win32-x64': `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`,
  'linux-x64': `https://github.com/indygreg/python-build-standalone/releases/download/20240415/cpython-${PYTHON_VERSION}+20240415-x86_64-unknown-linux-gnu-install_only.tar.gz`,
  'darwin-x64': `https://github.com/indygreg/python-build-standalone/releases/download/20240415/cpython-${PYTHON_VERSION}+20240415-x86_64-apple-darwin-install_only.tar.gz`,
  'darwin-arm64': `https://github.com/indygreg/python-build-standalone/releases/download/20240415/cpython-${PYTHON_VERSION}+20240415-aarch64-apple-darwin-install_only.tar.gz`
}

// ESP-IDF 工具链包名（PlatformIO 风格）
const TOOLCHAIN_PACKAGES = [
  'toolchain-xtensa-esp32s3',
  'toolchain-xtensa-esp32',
  'toolchain-riscv32-esp',
  'tool-esptoolpy'
]

// ── 日志 ──

function log(msg) {
  console.log(`[full-pack] ${msg}`)
}

function error(msg) {
  console.error(`[full-pack] ❌ ${msg}`)
  process.exit(1)
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ── 下载工具（支持重试） ──

function downloadFile(url, destPath, retries = 3) {
  return new Promise((resolve, reject) => {
    const tempPath = `${destPath}.tmp`

    const doDownload = (downloadUrl) => {
      const protocol = downloadUrl.startsWith('https') ? https : http
      protocol.get(downloadUrl, (res) => {
        // 处理重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          log(`  重定向到: ${res.headers.location}`)
          doDownload(res.headers.location)
          return
        }

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusText || 'Unknown error'}`))
          return
        }

        const contentLength = parseInt(res.headers['content-length'] || '0', 10)
        let downloaded = 0

        const fileStream = fs.createWriteStream(tempPath)

        res.on('data', (chunk) => {
          downloaded += chunk.length
          fileStream.write(chunk)
          if (contentLength > 0) {
            const pct = ((downloaded / contentLength) * 100).toFixed(1)
            process.stdout.write(`\r  下载进度: ${pct}% (${formatBytes(downloaded)}/${formatBytes(contentLength)})`)
          }
        })

        res.on('end', () => {
          fileStream.end(() => {
            process.stdout.write('\n')
            if (contentLength > 0 && downloaded < contentLength) {
              reject(new Error(`下载不完整: ${formatBytes(downloaded)}/${formatBytes(contentLength)}`))
            } else {
              fs.renameSync(tempPath, destPath)
              resolve()
            }
          })
        })

        res.on('error', (err) => {
          fileStream.end()
          reject(err)
        })
      }).on('error', (err) => {
        reject(err)
      })
    }

    // 重试逻辑
    const tryDownload = (attempt) => {
      doDownload(url).catch((err) => {
        if (attempt < retries) {
          log(`  下载失败，${attempt + 1}/${retries} 次重试...`)
          setTimeout(() => tryDownload(attempt + 1), 2000 * attempt)
        } else {
          reject(err)
        }
      })
    }

    tryDownload(0)
  })
}

// ── 解压 ──

function extractFile(archivePath, destDir) {
  log(`解压: ${path.basename(archivePath)}`)
  fs.mkdirSync(destDir, { recursive: true })

  if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'inherit' })
  } else if (archivePath.endsWith('.tar.xz')) {
    execSync(`tar -xJf "${archivePath}" -C "${destDir}"`, { stdio: 'inherit' })
  } else if (archivePath.endsWith('.zip')) {
    if (process.platform === 'win32') {
      execSync(`powershell -Command "Expand-Archive -Path '${archivePath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'inherit' })
    } else {
      execSync(`unzip -o "${archivePath}" -d "${destDir}"`, { stdio: 'inherit' })
    }
  } else {
    log(`  跳过未知格式: ${archivePath}`)
  }
}

// ── 检测当前系统 ──

function detectPlatform() {
  const platform = process.platform // win32, linux, darwin
  const arch = process.arch // x64, arm64

  if (platform === 'win32' && arch === 'x64') return { platform: 'win32', arch: 'x64', tag: 'win32-x64' }
  if (platform === 'linux' && arch === 'x64') return { platform: 'linux', arch: 'x64', tag: 'linux-x64' }
  if (platform === 'darwin' && arch === 'x64') return { platform: 'darwin', arch: 'x64', tag: 'darwin-x64' }
  if (platform === 'darwin' && arch === 'arm64') return { platform: 'darwin', arch: 'arm64', tag: 'darwin-arm64' }

  error(`不支持的平台: ${platform}/${arch}`)
}

// ── 1. 下载便携版 Python ──

async function downloadPython(targetDir, platformTag) {
  log('下载便携版 Python...')

  const url = PYTHON_URLS[platformTag]
  if (!url) {
    log(`  ⚠️ 无 ${platformTag} 的 Python 预编译包，跳过`)
    log('  用户需自行安装 Python')
    return false
  }

  const filename = url.split('/').pop()
  const archivePath = path.join(TEMP_DIR, filename)
  const pythonDir = path.join(targetDir, 'python')

  fs.mkdirSync(pythonDir, { recursive: true })

  try {
    log(`  下载 Python ${PYTHON_VERSION} (${platformTag})...`)
    log(`  来源: ${url}`)
    await downloadFile(url, archivePath)
    extractFile(archivePath, pythonDir)

    // Windows embeddable 包需要解压子目录，验证 python.exe 存在
    if (platformTag.startsWith('win32')) {
      // embeddable 包直接解压就是文件，检查 python.exe 是否存在
      const pythonExe = path.join(pythonDir, 'python.exe')
      if (!fs.existsSync(pythonExe)) {
        log('  ⚠️ 未找到 python.exe，可能解压路径不正确')
      }
    }

    log('  ✅ Python 下载完成')
    return true
  } catch (err) {
    log(`  ❌ Python 下载失败: ${err.message}`)
    return false
  }
}

// ── 2. 安装 PlatformIO Core 到本地目录 ──

function installPlatformIOLocal(targetDir, platformTag) {
  log('安装 PlatformIO Core 到本地目录...')

  const platformioDir = path.join(targetDir, 'platformio')

  // 尝试使用已下载的 Python 安装
  let pipCmd
  if (platformTag.startsWith('win32')) {
    pipCmd = path.join(targetDir, 'python', 'python.exe')
  } else {
    // Linux/Mac 使用系统 Python 或已下载的便携版
    pipCmd = 'python3'
  }

  try {
    // 使用 pip install --target 安装到本地目录（不污染系统环境）
    const pipArgs = [
      'pip', 'install',
      '--target', `"${platformioDir}"`,
      '--quiet',
      '--no-warn-script-location',
      'platformio'
    ]

    const cmd = `"${pipCmd}" ${pipArgs.join(' ')}`
    log(`  执行: ${cmd}`)
    execSync(cmd, { stdio: 'inherit', timeout: 300000 })
    log('  ✅ PlatformIO Core 安装完成')
    return true
  } catch (err) {
    log(`  ❌ PlatformIO 安装失败: ${err.message}`)
    log('  提示：需要网络连接来安装 PlatformIO')
    return false
  }
}

// ── 3. 从 PlatformIO 缓存复制工具链 ──

function copyToolchains(targetDir) {
  log('复制 ESP32 工具链...')

  const packagesDir = path.join(PLATFORMIO_CACHE, 'packages')
  const targetToolchainsDir = path.join(targetDir, 'toolchain')

  fs.mkdirSync(targetToolchainsDir, { recursive: true })

  let copiedCount = 0

  for (const pkg of TOOLCHAIN_PACKAGES) {
    const src = path.join(packagesDir, pkg)
    if (fs.existsSync(src)) {
      const dest = path.join(targetToolchainsDir, pkg)
      log(`  复制 ${pkg}...`)
      try {
        execSync(`cp -r "${src}" "${dest}"`, { stdio: 'pipe' })
        copiedCount++
        log(`    ✅ ${pkg}`)
      } catch (err) {
        log(`    ❌ ${pkg} 复制失败: ${err.message}`)
      }
    } else {
      log(`  ⚠️ ${pkg} 未找到（需先运行 pio pkg install）`)
    }
  }

  if (copiedCount === 0) {
    log('  ⚠️ 未复制到任何工具链，请确保 PlatformIO 已安装工具链')
    return false
  }

  log(`  ✅ 共复制 ${copiedCount} 个工具链包`)
  return true
}

// ── 4. Vite 构建 ──

function buildVite() {
  log('构建前端资源...')
  execSync('npx vite build', { cwd: ROOT, stdio: 'inherit' })
  log('  ✅ Vite 构建完成')
}

// ── 5. Electron Builder 打包 ──

function buildElectron(platform, arch) {
  log(`打包 Electron (${platform}/${arch})...`)

  const args = []
  if (platform !== process.platform) args.push(`--${platform}`)
  if (arch !== process.arch) args.push(`--${arch}`)

  execSync(`npx electron-builder --config electron-builder.yml ${args.join(' ')}`, {
    cwd: ROOT,
    stdio: 'inherit'
  })
  log('  ✅ Electron 打包完成')
}

// ── 6. 生成启动脚本 ──

function generateLaunchScripts(targetDir, platform, arch) {
  log('生成启动脚本...')

  // ── Windows 启动脚本 ──
  const batContent = `@echo off
title ESP32 IDE
setlocal EnableDelayedExpansion

:: ESP32 IDE 启动脚本（完整离线版）
:: 设置 Python 环境
set "PYTHON_DIR=%~dp0python"
set "PLATFORMIO_DIR=%~dp0platformio"
set "TOOLCHAIN_DIR=%~dp0toolchain"

:: 设置 PATH（Python + PlatformIO 优先）
set "PATH=%PYTHON_DIR%;%PYTHON_DIR%\\Scripts;%PATH%"

:: 设置 PlatformIO 环境变量
set "PLATFORMIO_CORE_DIR=%APPDATA%\\.platformio"
set "PLATFORMIO_PACKAGES_DIR=%TOOLCHAIN_DIR%"

:: 启动 Electron 应用
echo ╔══════════════════════════════════╗
echo ║       ESP32 IDE 启动中...        ║
echo ╚══════════════════════════════════╝
"%~dp0ESP32 IDE.exe" %*
endlocal
`

  const batPath = path.join(targetDir, 'ESP32 IDE.bat')
  fs.writeFileSync(batPath, batContent, 'utf-8')
  log(`  ✅ ${batPath}`)

  // ── Linux/Mac 启动脚本 ──
  const shContent = `#!/bin/bash
# ESP32 IDE 启动脚本（完整离线版）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 设置 Python 环境
export PATH="$SCRIPT_DIR/python/bin:$PATH"

# 设置 PlatformIO 环境变量
export PLATFORMIO_CORE_DIR="$HOME/.platformio"
export PLATFORMIO_PACKAGES_DIR="$SCRIPT_DIR/toolchain"

# 启动 Electron 应用
echo "╔══════════════════════════════════╗"
echo "║       ESP32 IDE 启动中...        ║"
echo "╚══════════════════════════════════╝"
exec "$SCRIPT_DIR/ESP32 IDE" "$@"
`

  const shPath = path.join(targetDir, 'ESP32 IDE.sh')
  fs.writeFileSync(shPath, shContent, 'utf-8')
  execSync(`chmod +x "${shPath}"`)
  log(`  ✅ ${shPath}`)
}

// ── 7. 写入版本信息 ──

function writePackageInfo(targetDir, platform, arch) {
  const info = {
    version: require(path.join(ROOT, 'package.json')).version,
    buildTime: new Date().toISOString(),
    platform,
    arch,
    components: {
      python: PYTHON_VERSION,
      platformio: 'latest',
      toolchains: TOOLCHAIN_PACKAGES
    }
  }

  fs.writeFileSync(
    path.join(targetDir, 'package-info.json'),
    JSON.stringify(info, null, 2)
  )
}

// ── 主流程 ──

async function main() {
  // 解析命令行参数
  const args = process.argv.slice(2)
  const platformIdx = args.indexOf('--platform')
  const archIdx = args.indexOf('--arch')

  let target
  if (platformIdx !== -1 && archIdx !== -1) {
    target = {
      platform: args[platformIdx + 1],
      arch: args[archIdx + 1],
      tag: `${args[platformIdx + 1]}-${args[archIdx + 1]}`
    }
  } else {
    target = detectPlatform()
  }

  log('═══════════════════════════════════════')
  log('  ESP32 IDE 完整离线版打包')
  log('═══════════════════════════════════════')
  log(`目标平台: ${target.platform}/${target.arch}`)
  log(`Python 版本: ${PYTHON_VERSION}`)
  log('')

  // 准备临时目录
  fs.mkdirSync(TEMP_DIR, { recursive: true })

  // 输出目录
  const outputName = `ESP32-IDE-full-${target.platform}-${target.arch}`
  const outputDir = path.join(RELEASE_DIR, outputName)

  try {
    // 步骤 1：构建前端
    buildVite()

    // 步骤 2：Electron 打包
    buildElectron(target.platform, target.arch)

    // 步骤 3：下载 Python
    const pythonOk = await downloadPython(outputDir, target.tag)
    if (!pythonOk) {
      log('⚠️ Python 下载失败，离线版将需要用户自行安装 Python')
    }

    // 步骤 4：安装 PlatformIO
    const pioOk = installPlatformIOLocal(outputDir, target.tag)
    if (!pioOk) {
      log('⚠️ PlatformIO 安装失败，离线版可能需要联网安装')
    }

    // 步骤 5：复制工具链
    const tcOk = copyToolchains(outputDir)
    if (!tcOk) {
      log('⚠️ 工具链复制失败，离线版可能需要手动安装工具链')
    }

    // 步骤 6：生成启动脚本
    generateLaunchScripts(outputDir, target.platform, target.arch)

    // 步骤 7：写入版本信息
    writePackageInfo(outputDir, target.platform, target.arch)

    log('\n═══════════════════════════════════════')
    log('  🎉 完整离线版打包完成！')
    log(`  输出目录: ${outputDir}`)
    log('  使用方法：')
    if (target.platform === 'win32') {
      log(`    双击 "ESP32 IDE.bat" 启动`)
    } else {
      log(`    运行 ./ESP32 IDE.sh 启动`)
    }
    log('═══════════════════════════════════════')
  } finally {
    // 清理临时目录
    try {
      if (fs.existsSync(TEMP_DIR)) {
        fs.rmSync(TEMP_DIR, { recursive: true, force: true })
        log('已清理临时文件')
      }
    } catch (e) { /* 忽略清理错误 */ }
  }
}

main().catch((err) => {
  error(`打包过程出错: ${err.message}`)
})
