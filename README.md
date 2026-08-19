# ESP32 IDE

> 面向新手的 ESP32 一站式开发工具 —— 代码编写、编译烧录、串口监视，开箱即用。

![ESP32 IDE](https://img.shields.io/badge/ESP32%20IDE-v1.0.0-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

---

## ✨ 功能特点

1. **代码编辑器** — 基于 Monaco Editor，支持语法高亮、智能补全、错误提示
2. **PlatformIO 编译** — 内置 PlatformIO 桥接，一键编译 ESP32 项目
3. **一键烧录** — 自动检测串口，支持 USB 和 JTAG 烧录
4. **串口监视器** — 实时查看串口输出，支持波特率调节
5. **文件树管理** — 可视化项目文件结构，支持新建/删除/重命名
6. **项目模板** — 内置 Arduino/ESP-IDF/MicroPython 模板，快速开始
7. **多芯片支持** — 支持 ESP32 / ESP32-S3 / ESP32-C3 全系列
8. **离线打包** — 支持工具链打包，无网络环境也能开发

## 🎯 支持芯片

| 芯片 | 核心 | 工具链 | 状态 |
|------|------|--------|------|
| ESP32 | Xtensa LX6 双核 | xtensa-esp32-elf-gcc | ✅ 支持 |
| ESP32-S3 | Xtensa LX7 双核 | xtensa-esp32s3-elf-gcc | ✅ 支持 |
| ESP32-C3 | RISC-V 单核 | riscv32-esp-elf-gcc | ✅ 支持 |

## 🚀 快速开始

### 前置条件

- **Node.js** >= 18
- **PlatformIO** >= 6.0（推荐通过 `pip install platformio` 安装）

### 5 步上手

```bash
# 1. 克隆项目
git clone https://github.com/your-username/esp32-ide.git
cd esp32-ide

# 2. 安装依赖
cd app
npm install

# 3. 启动开发模式
npm run electron:dev

# 4. 创建项目
# 在界面中点击「新建项目」，选择芯片和模板

# 5. 编译 & 烧录
# 点击底部工具栏的「编译」和「烧录」按钮
```

### 构建生产版本

```bash
cd app

# 仅构建前端
npm run build

# 打包 Electron 应用
npm run package

# 完整离线打包（含工具链）
node tools/package-offline.js
```

## 💻 系统要求

| 项目 | 最低要求 |
|------|----------|
| 操作系统 | Windows 10+ / macOS 12+ / Ubuntu 20.04+ |
| Node.js | >= 18.x |
| 内存 | >= 4 GB RAM |
| 磁盘空间 | >= 2 GB（含工具链） |
| PlatformIO | >= 6.0（`pip install platformio`）|

### 首次使用

1. 安装 Node.js 和 PlatformIO
2. 运行 `npm install` 安装依赖
3. 运行 `npm run electron:dev` 启动 IDE
4. IDE 会自动检测已安装的工具链

## ❓ 常见问题

### Q: 编译时报 "xtensa-esp32s3-elf-gcc: command not found"

**A:** 工具链未安装。确保 PlatformIO 已正确安装并初始化：

```bash
pip install platformio
pio --version
pio project init --board esp32-s3-devkitc-1
```

IDE 在首次编译时会自动下载所需工具链。

### Q: 无法检测到串口设备

**A:** 请检查：
1. USB 数据线是否支持数据传输（非纯充电线）
2. 已安装对应串口驱动（CP2102/CH340/FTDI）
3. Windows: 安装 [CP210x 驱动](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers)
4. Linux: 将用户添加到 `dialout` 组：`sudo usermod -aG dialout $USER`

### Q: 支持 MicroPython 吗？

**A:** 当前版本主要支持 Arduino 和 ESP-IDF 开发。MicroPython 支持计划在未来版本中加入。

### Q: 如何在无网络环境下使用？

**A:** 使用离线打包脚本：
```bash
# 在有网环境下打包
node tools/download-toolchain.js
node tools/package-offline.js
```
生成的 `release/` 目录包含完整工具链，可拷贝到离线机器使用。

### Q: macOS 安装后提示"无法验证开发者"

**A:** 这是 macOS 安全机制。请在「系统设置 → 隐私与安全性」中点击「仍要打开」，或在终端执行：
```bash
xattr -cr /Applications/ESP32\ IDE.app
```

## 📥 下载地址

| 平台 | 下载 |
|------|------|
| Windows (x64) | [ESP32-IDE-Setup-1.0.0.exe](https://github.com/your-username/esp32-ide/releases/download/v1.0.0/ESP32-IDE-Setup-1.0.0.exe) |
| macOS (arm64) | [ESP32-IDE-1.0.0-arm64.dmg](https://github.com/your-username/esp32-ide/releases/download/v1.0.0/ESP32-IDE-1.0.0-arm64.dmg) |
| Linux (x64) | [ESP32-IDE-1.0.0.AppImage](https://github.com/your-username/esp32-ide/releases/download/v1.0.0/ESP32-IDE-1.0.0.AppImage) |
| 离线包 | [ESP32-IDE-offline.zip](https://github.com/your-username/esp32-ide/releases/download/v1.0.0/ESP32-IDE-offline.zip) |

> ⚠️ 以上链接为占位符，请替换为实际发布地址。

## 📁 项目结构

```
esp32-ide/
├── app/                    # Electron 应用
│   ├── src/
│   │   ├── main/           # Electron 主进程
│   │   │   ├── index.js        # 主入口
│   │   │   ├── preload.js      # 预加载脚本
│   │   │   ├── pio-bridge.js   # PlatformIO 桥接
│   │   │   ├── serial-manager.js # 串口管理
│   │   │   ├── file-tree.js    # 文件树操作
│   │   │   ├── project.js      # 项目管理
│   │   │   └── templates/      # 项目模板
│   │   └── renderer/       # 前端 React 应用
│   ├── tools/              # 打包工具脚本
│   ├── electron-builder.yml # 打包配置
│   ├── vite.config.js      # Vite 配置
│   └── package.json
├── README.md
└── PHASE6-REPORT.md
```

## 🤝 参与贡献

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📄 许可证

本项目采用 [MIT License](LICENSE) 许可证。

```
MIT License

Copyright (c) 2026 ESP32 IDE Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
