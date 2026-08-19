# ESP32 IDE 双方案打包 — 实现报告

> 实现时间：2026-08-19 | 状态：✅ 全部完成

## 概览

为 ESP32 IDE 实现了两套打包方案，面向零基础中国嵌入式新手：

| 方案 | 体积 | 特点 |
|------|------|------|
| **完整离线版** | ~800MB | 下载解压双击即用，自带 Python + PlatformIO + 工具链 |
| **轻量首次启动向导版** | ~15MB | IDE 本身小，首次启动自动检测环境并下载工具链 |

## 任务 1：完整离线版打包脚本

**文件：** `tools/package-full-offline.js` (13KB)

### 功能
1. **自动检测系统**（win32/linux/darwin × x64/arm64）
2. **下载便携版 Python**（从 python.org 或 python-build-standalone）
3. **安装 PlatformIO Core** 到本地目录（`pip install --target`）
4. **复制三套 ESP32 工具链**（从 PlatformIO 缓存）
5. **Electron Builder 打包**
6. **生成启动脚本**（`ESP32 IDE.bat` / `ESP32 IDE.sh`），设置 PATH 和环境变量
7. **输出到** `release/ESP32-IDE-full-{platform}-{arch}/`

### 用法
```bash
# 当前平台打包
node tools/package-full-offline.js

# 指定平台打包
node tools/package-full-offline.js --platform win32 --arch x64
```

### 启动脚本内容
- **Windows**：设置 `PYTHON_DIR`、`PLATFORMIO_CORE_DIR`、`PLATFORMIO_PACKAGES_DIR`，启动 Electron
- **Linux/Mac**：设置对应环境变量，`exec` 启动应用

## 任务 2：轻量版首次启动向导

### 2a. SetupWizard.jsx — 向导组件
**文件：** `src/renderer/components/SetupWizard.jsx` (10.7KB)

**5 个步骤：**
1. **欢迎页** — 介绍 ESP32 IDE 功能亮点，一键开始
2. **环境检测** — 实时检测 Python、PlatformIO、ESP32 工具链是否已安装，显示状态列表
3. **下载源选择** — 4 个选项卡片：
   - 🏫 清华大学镜像（推荐，国内最快）
   - ☁️ 阿里云镜像（稳定可靠）
   - 🌐 GitHub 原始源
   - 🔧 手动指定路径（已有环境跳过下载）
4. **安装进度** — 进度条 + 当前步骤文字 + 错误提示
5. **完成** — 显示安装结果摘要，可一键开始编程

### 2b. setup-manager.js — 安装管理器
**文件：** `src/main/setup-manager.js` (10.7KB)

**核心函数：**
- `checkEnvironment()` — 检测 Python/PlatformIO/ESP32 工具链是否可用，区分内置版本和系统版本
- `installPlatformio(mirror)` — 从选定镜像 `pip install platformio`
- `installToolchains(mirror)` — 通过 `pio pkg install` 安装 4 个工具链包
- `getSetupStatus()` — 获取当前安装进度
- 所有进度通过 `setup-progress` IPC 实时推送到渲染进程

**镜像配置：**
```js
MIRRORS = {
  tsinghua: 'https://pypi.tuna.tsinghua.edu.cn/simple',
  aliyun: 'https://mirrors.aliyun.com/pypi/simple/',
  github: 'https://pypi.org/simple',
  manual: null  // 跳过下载
}
```

### 2c. preload.js 新增 IPC
```js
setupCheckEnvironment: () => ipcRenderer.invoke('setup-check-env'),
setupInstall: (mirror) => ipcRenderer.invoke('setup-install', mirror),
setupGetStatus: () => ipcRenderer.invoke('setup-get-status'),
onSetupProgress: (callback) => ipcRenderer.on('setup-progress', ...),
onShowSetupWizard: (callback) => ipcRenderer.on('show-setup-wizard', ...),
```

### 2d. index.js 启动检测
- 应用启动后，窗口加载完成时调用 `checkEnvironment()`
- 如果 `!env.ready`，发送 `show-setup-wizard` 事件到渲染进程
- 注册 `registerSetupIpc()` 处理所有向导 IPC

### 2e. App.jsx 集成
- 新增 `showSetupWizard` 状态
- 监听 `show-setup-wizard` 事件
- 向导完成后调用 `setupCheckEnvironment()` 重新检测环境
- 渲染 `<SetupWizard>` 组件（覆盖全屏 modal）

## 任务 3：pio-bridge.js 内置 PlatformIO 支持

**修改：** `src/main/pio-bridge.js`

`getPioCommand()` 逻辑：
```
1. 获取应用根目录（打包后=exe同级，开发时=项目根目录）
2. 检测内置 PlatformIO：
   - Linux/Mac: {appDir}/platformio/bin/platformio
   - Windows: {appDir}/platformio/Scripts/platformio.exe
3. 存在 → 使用内置版本
4. 不存在 → fallback 到系统 PATH 中的 'pio'
```

## CSS 样式

**文件：** `src/renderer/styles/dark.css` 新增 300+ 行向导样式

覆盖所有向导页面的暗色主题，与现有 IDE 风格一致。

## 验收清单

| 检查项 | 状态 |
|--------|------|
| `node tools/package-full-offline.js` 语法正确 | ✅ |
| SetupWizard.jsx 组件渲染正常（5 步流程） | ✅ |
| setup-manager.js 的 checkEnvironment 逻辑正确 | ✅ |
| pio-bridge.js 能检测内置 PlatformIO | ✅ |
| preload.js 新增 IPC 接口完整（5 个） | ✅ |
| App.jsx 集成向导逻辑 | ✅ |
| `npx vite build` 通过 | ✅ 4.18s |
| 所有代码注释用中文 | ✅ |

## 文件清单

| 文件 | 操作 | 大小 |
|------|------|------|
| `tools/package-full-offline.js` | 新建 | 13KB |
| `src/main/setup-manager.js` | 新建 | 10.7KB |
| `src/renderer/components/SetupWizard.jsx` | 新建 | 10.7KB |
| `src/main/preload.js` | 修改 | +300B |
| `src/main/index.js` | 修改 | +200B |
| `src/main/pio-bridge.js` | 修改 | +500B |
| `src/renderer/App.jsx` | 修改 | +1KB |
| `src/renderer/styles/dark.css` | 修改 | +12KB |
