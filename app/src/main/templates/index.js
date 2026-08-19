/**
 * ESP32 IDE - 项目模板模块
 * 提供 Blink、WiFi Scanner、Serial Echo 三种预置模板
 */
const fs = require('fs')
const path = require('path')

/**
 * 模板定义
 * 每个模板包含：name, description, files (相对路径 → 文件内容)
 */
const TEMPLATES = {
  blink: {
    name: 'Blink',
    description: 'LED 闪烁 - 入门经典程序，验证开发板是否正常工作',
    icon: '💡',
    files: {
      'platformio.ini': (chip) => getBlinkPlatformioIni(chip),
      'src/main.cpp': (chip) => getBlinkMainCpp(chip)
    }
  },
  wifi_scanner: {
    name: 'WiFi Scanner',
    description: 'WiFi 扫描 - 扫描周围所有 WiFi 网络并显示信号强度',
    icon: '📡',
    files: {
      'platformio.ini': (chip) => getWifiScannerPlatformioIni(chip),
      'src/main.cpp': () => getWifiScannerMainCpp()
    }
  },
  serial_echo: {
    name: 'Serial Echo',
    description: '串口回显 - 通过串口接收数据并原样返回，测试串口通信',
    icon: '💬',
    files: {
      'platformio.ini': (chip) => getSerialEchoPlatformioIni(chip),
      'src/main.cpp': () => getSerialEchoMainCpp()
    }
  }
}

// ═══════════════════════════════════════════════
// 模板内容生成函数
// ═══════════════════════════════════════════════

function getChipConfig(chipType) {
  const chips = {
    'esp32-s3': { board: 'esp32-s3-devkitc-1', name: 'ESP32-S3' },
    'esp32': { board: 'esp32dev', name: 'ESP32' },
    'esp32-c3': { board: 'esp32-c3-devkitm-1', name: 'ESP32-C3' }
  }
  return chips[chipType] || chips['esp32-s3']
}

function makePlatformioIni(chipType, extraBuildFlags = '') {
  const chip = getChipConfig(chipType)
  return `; PlatformIO 项目配置文件
; ESP32 IDE 自动生成 - ${chip.name}

[env:${chip.board}]
platform = espressif32
board = ${chip.board}
framework = arduino

monitor_speed = 115200
upload_speed = 921600
${extraBuildFlags ? 'build_flags =\n    ' + extraBuildFlags : ''}
`
}

function getBlinkPlatformioIni(chipType) {
  return makePlatformioIni(chipType)
}

function getBlinkMainCpp(chipType) {
  const chip = getChipConfig(chipType)
  // ESP32-S3 的内置 LED 引脚
  const ledPin = chipType === 'esp32-s3' ? 48 :
                 chipType === 'esp32-c3' ? 8 : 2

  return `/**
 * ESP32 Blink - LED 闪烁程序
 * 芯片: ${chip.name}
 * LED 引脚: GPIO ${ledPin}
 *
 * 这是 ESP32 的经典入门程序
 * 如果 LED 按 1 秒间隔闪烁，说明开发板工作正常！
 */

#include <Arduino.h>

// 内置 LED 引脚定义
#define LED_PIN ${ledPin}

void setup() {
  // 初始化串口
  Serial.begin(115200);
  Serial.println("${chip.name} Blink 程序启动！");

  // 设置 LED 引脚为输出模式
  pinMode(LED_PIN, OUTPUT);

  Serial.print("LED 引脚: GPIO ");
  Serial.println(LED_PIN);
}

void loop() {
  digitalWrite(LED_PIN, HIGH);   // 点亮 LED
  Serial.println("LED 亮");
  delay(1000);                   // 等待 1 秒

  digitalWrite(LED_PIN, LOW);    // 熄灭 LED
  Serial.println("LED 灭");
  delay(1000);                   // 等待 1 秒
}
`
}

function getWifiScannerPlatformioIni(chipType) {
  return makePlatformioIni(chipType, '-DCORE_DEBUG_LEVEL=3')
}

function getWifiScannerMainCpp() {
  return `/**
 * ESP32 WiFi Scanner - WiFi 网络扫描程序
 *
 * 扫描周围所有可见的 WiFi 网络
 * 并在串口监视器中显示网络名称、信号强度、加密方式
 *
 * 使用方法：打开串口监视器，波特率 115200
 */

#include <Arduino.h>
#include <WiFi.h>

void setup() {
  // 初始化串口
  Serial.begin(115200);
  Serial.println();
  Serial.println("=== ESP32 WiFi Scanner ===");
  Serial.println();

  // 设置 WiFi 为站模式
  WiFi.mode(WIFI_STA);
  // 断开之前的连接
  WiFi.disconnect();
  delay(100);

  Serial.println("WiFi 已初始化，开始扫描...");
  Serial.println();
}

void loop() {
  // 扫描 WiFi 网络
  Serial.println("────────────────────────────────");
  Serial.print("扫描时间: ");
  Serial.print(millis() / 1000);
  Serial.println(" 秒");
  Serial.println("────────────────────────────────");

  int n = WiFi.scanNetworks();

  if (n == 0) {
    Serial.println("未发现任何 WiFi 网络");
  } else {
    Serial.print("发现 ");
    Serial.print(n);
    Serial.println(" 个 WiFi 网络：");
    Serial.println();

    for (int i = 0; i < n; i++) {
      // 序号
      Serial.print("  [");
      Serial.print(i + 1);
      Serial.print("] ");

      // 网络名称
      Serial.print(WiFi.SSID(i));

      // 信号强度
      Serial.print(" (");
      Serial.print(WiFi.RSSI(i));
      Serial.print(" dBm) ");

      // 加密方式
      switch (WiFi.encryptionType(i)) {
        case WIFI_AUTH_OPEN:            Serial.print("🔓 开放"); break;
        case WIFI_AUTH_WEP:             Serial.print("🔒 WEP"); break;
        case WIFI_AUTH_WPA_PSK:         Serial.print("🔒 WPA"); break;
        case WIFI_AUTH_WPA2_PSK:        Serial.print("🔒 WPA2"); break;
        case WIFI_AUTH_WPA2_ENTERPRISE: Serial.print("🔒 WPA2-EAP"); break;
        case WIFI_AUTH_WPA3_PSK:        Serial.print("🔒 WPA3"); break;
        case WIFI_AUTH_WPA2_WPA3_PSK:   Serial.print("🔒 WPA2/WPA3"); break;
        case WIFI_AUTH_WAPI_PSK:        Serial.print("🔒 WAPI"); break;
        default:                        Serial.print("🔒 未知"); break;
      }
      Serial.println();
    }
  }

  // 清除扫描结果释放内存
  WiFi.scanDelete();

  Serial.println();
  Serial.println("下次扫描将在 10 秒后开始...");
  Serial.println();

  // 等待 10 秒
  delay(10000);
}
`
}

function getSerialEchoPlatformioIni(chipType) {
  return makePlatformioIni(chipType)
}

function getSerialEchoMainCpp() {
  return `/**
 * ESP32 Serial Echo - 串口回显程序
 *
 * 通过 USB 串口接收数据并原样返回
 * 可用于测试串口通信是否正常
 *
 * 使用方法：
 *   1. 打开串口监视器，波特率 115200
 *   2. 输入任意文字并发送
 *   3. ESP32 会将收到的内容原样返回
 */

#include <Arduino.h>

#define BAUD_RATE 115200

void setup() {
  Serial.begin(BAUD_RATE);

  // 等待串口连接（某些开发板需要）
  while (!Serial) {
    delay(10);
  }

  Serial.println("╔══════════════════════════════╗");
  Serial.println("║   ESP32 Serial Echo 程序     ║");
  Serial.println("║   输入任意内容并回车发送     ║");
  Serial.println("╚══════════════════════════════╝");
  Serial.println();
  Serial.print("就绪> ");
}

void loop() {
  // 检查是否有数据可读
  if (Serial.available() > 0) {
    // 读取一行数据
    String input = Serial.readStringUntil('\\n');
    input.trim(); // 去除首尾空白

    if (input.length() > 0) {
      // 显示收到的内容
      Serial.println();
      Serial.print("收到: ");
      Serial.println(input);

      // 显示字符数
      Serial.print("长度: ");
      Serial.print(input.length());
      Serial.println(" 字符");

      // 显示 HEX 格式
      Serial.print("HEX:  ");
      for (unsigned int i = 0; i < input.length(); i++) {
        if (input[i] < 0x10) Serial.print("0");
        Serial.print((uint8_t)input[i], HEX);
        Serial.print(" ");
      }
      Serial.println();
      Serial.println();
    }

    Serial.print("就绪> ");
  }
}
`
}

// ═══════════════════════════════════════════════
// 公共接口
// ═══════════════════════════════════════════════

/**
 * 获取所有可用模板列表
 * @returns {Array<{id: string, name: string, description: string, icon: string}>}
 */
function getTemplateList() {
  return Object.entries(TEMPLATES).map(([id, t]) => ({
    id,
    name: t.name,
    description: t.description,
    icon: t.icon
  }))
}

/**
 * 创建项目
 * @param {string} projectDir - 项目目录（父目录）
 * @param {string} projectName - 项目名称
 * @param {string} templateId - 模板 ID
 * @param {string} chipType - 芯片类型
 * @returns {{success: boolean, projectPath: string, error?: string}}
 */
function createProject(projectDir, projectName, templateId, chipType) {
  const template = TEMPLATES[templateId]
  if (!template) {
    return { success: false, error: `未知模板: ${templateId}` }
  }

  const projectPath = path.join(projectDir, projectName)

  // 检查目录是否已存在
  if (fs.existsSync(projectPath)) {
    return { success: false, error: `目录已存在: ${projectPath}` }
  }

  try {
    // 创建项目目录
    fs.mkdirSync(projectPath, { recursive: true })

    // 创建 src 目录
    const srcDir = path.join(projectPath, 'src')
    fs.mkdirSync(srcDir, { recursive: true })

    // 写入模板文件
    for (const [relativePath, contentFn] of Object.entries(template.files)) {
      const filePath = path.join(projectPath, relativePath)
      const dir = path.dirname(filePath)

      // 确保父目录存在
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      const content = typeof contentFn === 'function' ? contentFn(chipType) : contentFn
      fs.writeFileSync(filePath, content, 'utf-8')
    }

    return {
      success: true,
      projectPath,
      template: template.name,
      chipType
    }
  } catch (err) {
    return { success: false, error: err.message }
  }
}

module.exports = {
  TEMPLATES,
  getTemplateList,
  createProject
}
