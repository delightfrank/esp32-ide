# ESP32 IDE

> 面向新手的 ESP32 一站式开发工具 —— 代码编写、编译烧录、串口监视，开箱即用。

![ESP32 IDE](https://img.shields.io/badge/ESP32%20IDE-v1.0.0-blue)
![License](https://img.shields.io/badge/License-MIT-green)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

---

## ✨ 功能特点

- **Monaco Editor** — 语法高亮、智能补全、错误跳转
- **一键编译** — 内置 PlatformIO，点击即编译
- **一键烧录** — 自动检测串口，USB/JTAG 烧录
- **串口监视器** — 实时查看输出，ASCII/HEX 切换
- **文件树管理** — 新建/删除/重命名，可视化操作
- **项目模板** — Blink/WiFi/Serial Echo 等模板，快速上手
- **多芯片** — ESP32 / ESP32-S3 / ESP32-C3 全系列
- **自动保存** — 每 30 秒自动保存，崩溃可恢复
- **离线运行** — 完整离线包，无需联网

## 🎯 支持芯片

| 芯片 | 核心 | 工具链 | 状态 |
|------|------|--------|------|
| ESP32 | Xtensa LX6 双核 | xtensa-esp32-elf-gcc | ✅ |
| ESP32-S3 | Xtensa LX7 双核 | xtensa-esp32s3-elf-gcc | ✅ |
| ESP32-C3 | RISC-V 单核 | riscv32-esp-elf-gcc | ✅ |

---

## 🚀 使用方式

### 方式一：下载即用（推荐新手）

> 不需要装任何东西，下载解压双击就能用。

**Windows 用户：**
1. 下载 [ESP32-IDE-full-win32-x64.zip](https://github.com/delightfrank/esp32-ide/releases)
2. 解压到任意目录（路径不要含中文/空格）
3. 双击 `ESP32 IDE.exe`
4. IDE 会自动检测工具链，首次可能需要等待初始化

**macOS / Linux 用户：**
```bash
# 下载解压
unzip ESP32-IDE-full-*.zip
cd ESP32-IDE-full-*

# 启动
./ESP32 IDE
```

### 方式二：从源码运行（开发者）

> 需要先装 Node.js 和 PlatformIO。

**前置条件：**
- [Node.js](https://nodejs.org/) >= 18
- [PlatformIO](https://platformio.org/) >= 6.0

```bash
# 1. 克隆仓库
git clone https://github.com/delightfrank/esp32-ide.git
cd esp32-ide

# 2. 安装依赖
cd app && npm install

# 3. 启动
npm run electron:dev
```

启动后 IDE 会自动检测已安装的工具链。如果提示缺少工具链，在 IDE 内首次编译时 PlatformIO 会自动下载。

### 方式三：首次启动向导（轻量版）

> IDE 本身只有 ~50MB，首次启动自动下载工具链。

1. 下载轻量版安装包
2. 双击运行
3. IDE 弹出设置向导 → 选择国内镜像（清华/阿里）→ 一键安装
4. 等待下载完成（约 300MB）→ 开始使用

---

## 🔨 打包发布

```bash
cd app

# 仅构建前端
npm run build

# 打包 Electron 应用（标准版）
npm run package

# 完整离线打包（含工具链，~600MB）
node tools/package-full-offline.js --platform win32 --arch x64

# 轻量版打包
node tools/package-offline.js
```

---

## 💻 系统要求

| 项目 | 完整离线包 | 从源码运行 |
|------|-----------|-----------|
| 操作系统 | Windows 10+ / macOS 12+ / Ubuntu 20.04+ | 同左 |
| Node.js | 不需要 | >= 18.x |
| PlatformIO | 不需要（内置） | >= 6.0 |
| 内存 | >= 4 GB | >= 4 GB |
| 磁盘 | >= 2 GB | >= 1 GB |

---

## 📁 项目结构

```
esp32-ide/
├── app/                        # Electron 应用
│   ├── src/
│   │   ├── main/               # 主进程
│   │   │   ├── index.js            # 入口 + 窗口管理
│   │   │   ├── preload.js          # 安全 IPC 桥接
│   │   │   ├── pio-bridge.js       # PlatformIO 编译/烧录
│   │   │   ├── serial-manager.js   # 串口管理
│   │   │   ├── file-tree.js        # 文件树操作
│   │   │   ├── project.js          # 项目配置生成
│   │   │   └── templates/          # 项目模板
│   │   └── renderer/           # 前端 React
│   │       ├── App.jsx             # 主界面
│   │       └── components/         # UI 组件
│   ├── tools/                  # 打包脚本
│   │   ├── package-full-offline.js # 完整离线打包
│   │   └── package-offline.js      # 轻量打包
│   ├── electron-builder.yml    # Electron 打包配置
│   └── package.json
├── LICENSE                     # MIT 协议
└── README.md
```

## ❓ 常见问题

### Q: 编译报 "xtensa-esp32s3-elf-gcc: command not found"

**A:** 完整离线包用户不会遇到此问题。从源码运行时，PlatformIO 首次编译会自动下载工具链。如需手动安装：
```bash
pio pkg install -t toolchain-xtensa-esp32s3
```

### Q: 无法检测到串口

**A:**
1. 确认 USB 数据线支持数据传输（非纯充电线）
2. 安装串口驱动：
   - Windows: [CP210x 驱动](https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers) 或 [CH340 驱动](https://www.wch.cn/downloads/CH341SER_EXE.html)
   - Linux: `sudo usermod -aG dialout $USER` 然后重新登录
   - macOS: 通常免驱

### Q: 路径含中文/空格编译失败

**A:** PlatformIO 不支持中文路径。请将项目放在纯英文路径下，如 `D:\esp32-projects\myproject`。

### Q: macOS 提示"无法验证开发者"

**A:** 系统设置 → 隐私与安全性 → 点击「仍要打开」。

---

## 🤝 参与贡献

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/xxx`)
3. 提交更改 (`git commit -m 'feat: xxx'`)
4. 推送分支 (`git push origin feature/xxx`)
5. 创建 Pull Request

## 📄 许可证

[MIT License](LICENSE) - 自由使用、修改、分发。

## 🔗 相关链接

- 仓库地址：https://github.com/delightfrank/esp32-ide
- 问题反馈：https://github.com/delightfrank/esp32-ide/issues
- PlatformIO 官网：https://platformio.org
- ESP32 官方文档：https://docs.espressif.com/projects/esp-idf/
