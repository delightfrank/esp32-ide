/**
 * ESP32 IDE - 编译错误解析工具
 * 解析 PlatformIO 编译错误输出
 */

/**
 * 解析 PlatformIO 编译错误
 * 格式: 文件路径:行号: 列号: error: 消息
 * @param {string} output - 编译输出文本
 * @returns {Array<{file: string, line: number, column: number, message: string}>}
 */
export function parseBuildErrors(output) {
  const errors = []
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

/**
 * 解析 PlatformIO 编译警告
 * @param {string} output - 编译输出文本
 * @returns {Array<{file: string, line: number, column: number, message: string}>}
 */
export function parseBuildWarnings(output) {
  const warnings = []
  const warningRegex = /^(.+?):(\d+):(\d+):\s*warning:\s*(.+)$/gm
  let match

  while ((match = warningRegex.exec(output)) !== null) {
    warnings.push({
      file: match[1],
      line: parseInt(match[2], 10),
      column: parseInt(match[3], 10),
      message: match[4].trim()
    })
  }

  return warnings
}

/**
 * 判断一行是否为编译错误
 */
export function isErrorLine(line) {
  return /error:\s*.+/.test(line)
}

/**
 * 判断一行是否为编译警告
 */
export function isWarningLine(line) {
  return /warning:\s*.+/.test(line)
}
