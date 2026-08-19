# ESP32 便捷 IDE —— 实施方案

## 技术架构

```
┌──────────────────────────────────────┐
│         Electron 应用壳              │
│  ┌──────────┐  ┌──────────────────┐  │
│  │ Monaco   │  │  UI 界面         │  │
│  │ Editor   │  │  菜单/按钮/状态栏 │  │
│  └──────────┘  └──────────────────┘  │
├──────────────────────────────────────┤
│         Node.js 主进程               │
│  • 项目文件管理 (fs)                 │
│  • 编译调度 (child_process → pio)    │
│  • 串口通信 (serialport)            │
│  • 配置管理 (platformio.ini 生成)   │
├──────────────────────────────────────┤
│      PlatformIO Core (Python)        │
│  • pio run — 编译                    │
│  • pio run -t upload — 烧录         │
│  • pio device monitor — 串口        │
├──────────────────────────────────────┤
│    本地预装工具链 (无需联网)         │
│  • xtensa-esp-elf-gcc 14.2.0       │
│  • esptool 5.3.0                    │
│  • Arduino ESP32 3.3.9 / ESP-IDF   │
└──────────────────────────────────────┘
```

## 目录结构

```
esp32-ide/
├── src/                        # Electron 前端源码
│   ├── main/                   # 主进程
│   │   ├── index.js            # 入口
│   │   ├── pio-bridge.js       # PlatformIO 调用封装
│   │   ├── serial.js           # 串口管理
│   │   └── project.js          # 项目管理
│   ├── renderer/               # 渲染进程
│   │   ├── index.html
│   │   ├── editor.js           # Monaco Editor 集成
│   │   ├── toolbar.js          # 工具栏（编译/烧录/串口）
│   │   ├── filetree.js         # 文件树
│   │   ├── console.js          # 编译输出/串口监视
│   │   └── styles/
│   └── templates/              # 项目模板
│       ├── blink/
│       ├── wifi/
│       └── serial/
├── platformio-core/            # 嵌入的 PlatformIO（可选）
├── toolchain/                  # 预装工具链（打包时放入）
├── package.json
├── electron-builder.yml        # 打包配置
└── build/                      # 打包输出
```

## 关键模块实现

### 1. PlatformIO 封装 (pio-bridge.js)

```javascript
// 核心：调用 pio 命令，解析输出
const { spawn } = require('child_process');

function pioRun(projectDir, args = []) {
  return new Promise((resolve, reject) => {
    const pio = spawn('pio', args, { cwd: projectDir });
    let output = '';
    pio.stdout.on('data', d => { output += d; /* 实时推送到前端 */ });
    pio.stderr.on('data', d => { output += d; });
    pio.on('close', code => code === 0 ? resolve(output) : reject(output));
  });
}

// 编译
function build(projectDir) { return pioRun(projectDir, ['run']); }
// 烧录
function upload(projectDir, port) { return pioRun(projectDir, ['run', '-t', 'upload', '--upload-port', port]); }
// 清理
function clean(projectDir) { return pioRun(projectDir, ['run', '-t', 'clean']); }
```

### 2. 平台配置文件生成 (project.js)

```javascript
// 根据用户选择的芯片，自动生成 platformio.ini
function generateConfig(projectDir, options) {
  const ini = `
[env:${options.board}]
platform = espressif32
board = ${options.board}  // esp32-s3-devkitc-1
framework = ${options.framework}  // arduino 或 espidf
monitor_speed = 115200
board_build.flash_mode = dio
`;
  fs.writeFileSync(path.join(projectDir, 'platformio.ini'), ini);
}
```

### 3. 预装工具链目录

打包时包含的文件：

| 组件 | 路径 | 大小约 |
|------|------|--------|
| xtensa-esp-elf-gcc | packages/toolchain-xtensa-esp-elf/ | ~200MB |
| esptool | packages/tool-esptoolpy/ | ~15MB |
| Arduino ESP32 框架 | packages/framework-arduinoespressif32/ | ~150MB |
| PlatformIO Core | platformio/ | ~30MB |
| Python embedded | python/ | ~30MB |
| **合计** | | **~425MB** |

## 打包方案

### Windows 离线包
```
ESP32-IDE-v1.0.zip
├── ESP32-IDE.exe          # 主程序
├── platformio/            # PlatformIO Core
├── python/                # Python embedded
├── packages/              # 工具链 + 框架
├── templates/             # 项目模板
└── README.txt             # 使用说明
```

### 分发渠道
1. **Gitee Release** —— 主要渠道，国内访问快
2. **百度网盘** —— 备用，覆盖更多用户
3. **蓝奏云** —— 小文件快速分发

## 开发里程碑

| 阶段 | 内容 | 周期 |
|------|------|------|
| M1 | Electron 脚手架 + Monaco Editor + 基础 UI | 3天 |
| M2 | PlatformIO 封装 + 编译/烧录功能 | 4天 |
| M3 | 串口监视器 + 文件树 + 项目模板 | 3天 |
| M4 | 首次启动引导 + 错误跳转 + 打磨 | 4天 |
| M5 | Windows 离线包制作 + 测试 + 发布 | 3天 |

**总计约 2.5 周，可出 MVP 离线包。**
