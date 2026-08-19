/**
 * ESP32 IDE - 项目管理模块
 * 自动生成 platformio.ini，支持多种 ESP32 芯片
 */
const fs = require('fs')
const path = require('path')

// 支持的芯片配置
const SUPPORTED_CHIPS = {
  'esp32-s3': {
    name: 'ESP32-S3',
    board: 'esp32-s3-devkitc-1',
    platform: 'espressif32',
    framework: 'arduino',
    monitorSpeed: '115200',
    description: 'ESP32-S3 DevKitC-1 (N8R8)'
  },
  'esp32': {
    name: 'ESP32',
    board: 'esp32dev',
    platform: 'espressif32',
    framework: 'arduino',
    monitorSpeed: '115200',
    description: 'ESP32 Dev Module'
  },
  'esp32-c3': {
    name: 'ESP32-C3',
    board: 'esp32-c3-devkitm-1',
    platform: 'espressif32',
    framework: 'arduino',
    monitorSpeed: '115200',
    description: 'ESP32-C3 DevKitM-1'
  }
}

/**
 * 获取支持的芯片列表
 * @returns {Array<{id: string, name: string, board: string, description: string}>}
 */
function getSupportedChips() {
  return Object.entries(SUPPORTED_CHIPS).map(([id, config]) => ({
    id,
    name: config.name,
    board: config.board,
    description: config.description
  }))
}

/**
 * 生成 platformio.ini 文件内容
 * @param {string} projectPath - 项目目录路径
 * @param {string} chipType - 芯片类型，如 'esp32-s3', 'esp32', 'esp32-c3'
 * @returns {{content: string, filePath: string}}
 */
function generatePlatformioIni(projectPath, chipType = 'esp32-s3') {
  const chip = SUPPORTED_CHIPS[chipType]
  if (!chip) {
    throw new Error(`不支持的芯片类型: ${chipType}。支持的类型: ${Object.keys(SUPPORTED_CHIPS).join(', ')}`)
  }

  const iniContent = `; PlatformIO 项目配置文件
;
; ESP32 IDE 自动生成
; 芯片: ${chip.name} (${chip.description})
; 生成时间: ${new Date().toISOString()}
;

[env:${chip.board}]
platform = ${chip.platform}
board = ${chip.board}
framework = ${chip.framework}

; 串口监视器波特率
monitor_speed = ${chip.monitorSpeed}

; 编译选项
build_flags =
    -DCORE_DEBUG_LEVEL=0

; 上传速度
upload_speed = 921600
`

  // 确保项目目录存在
  if (!fs.existsSync(projectPath)) {
    fs.mkdirSync(projectPath, { recursive: true })
  }

  const iniPath = path.join(projectPath, 'platformio.ini')
  fs.writeFileSync(iniPath, iniContent, 'utf-8')

  // 确保 src 目录存在（PlatformIO 要求）
  const srcDir = path.join(projectPath, 'src')
  if (!fs.existsSync(srcDir)) {
    fs.mkdirSync(srcDir, { recursive: true })
  }

  return {
    content: iniContent,
    filePath: iniPath,
    chipType,
    board: chip.board
  }
}

/**
 * 生成 platformio.ini 内容（仅返回内容，不写文件）
 * 供带确认对话框的调用方使用
 */
function generatePlatformioIniContent(projectPath, chipType = 'esp32-s3') {
  const chip = SUPPORTED_CHIPS[chipType]
  if (!chip) {
    throw new Error(`不支持的芯片类型: ${chipType}。支持的类型: ${Object.keys(SUPPORTED_CHIPS).join(', ')}`)
  }

  const iniContent = `; PlatformIO 项目配置文件
;
; ESP32 IDE 自动生成
; 芯片: ${chip.name} (${chip.description})
; 生成时间: ${new Date().toISOString()}
;

[env:${chip.board}]
platform = ${chip.platform}
board = ${chip.board}
framework = ${chip.framework}

; 串口监视器波特率
monitor_speed = ${chip.monitorSpeed}

; 编译选项
build_flags =
    -DCORE_DEBUG_LEVEL=0

; 上传速度
upload_speed = 921600
`

  const iniPath = path.join(projectPath, 'platformio.ini')

  return {
    content: iniContent,
    filePath: iniPath,
    chipType,
    board: chip.board
  }
}

/**
 * 解析 PlatformIO 编译错误输出
 * PlatformIO 错误格式: 文件路径:行号: 列号: error: 消息
 * @param {string} output - 编译输出文本
 * @returns {Array<{file: string, line: number, column: number, message: string}>}
 */
function parseBuildErrors(output) {
  const errors = []
  // 匹配: /path/to/file.ino:10:5: error: ...
  // 或相对路径: src/main.cpp:25:3: error: ...
  const errorRegex = /^(.+?):(\d+):(\d+):\s*(?:fatal\s+)?error:\s*(.+)$/gm
  let match

  while ((match = errorRegex.exec(output)) !== null) {
    errors.push({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      message: match[4].trim()
    })
  }

  return errors
}

module.exports = {
  SUPPORTED_CHIPS,
  getSupportedChips,
  generatePlatformioIni,
  generatePlatformioIniContent,
  parseBuildErrors
}
