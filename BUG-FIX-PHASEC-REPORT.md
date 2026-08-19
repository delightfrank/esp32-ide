# ESP32 IDE - Phase C Bug 修复报告

**修复时间**: 2026-08-19 16:52 GMT+8  
**修复项**: 5 项 P2 功能缺陷  
**构建验证**: ✅ 通过 (`npx vite build`)

---

## 修复详情

### Bug 1: 串口检测改 scan 模式 ✅
- **文件**: `src/main/serial-manager.js`
- **问题**: `checkPortAvailable` 打开再关闭串口，会和实际串口通信冲突
- **修复**: 改为只查询不打开——遍历 `SerialPort.list()` 结果判断端口是否存在，不尝试 `open`
- **验证**: 不再尝试 open/close 串口，仅扫描系统设备列表

### Bug 2: platformio.ini 覆盖保护 ✅
- **文件**: `src/main/project.js` + `src/main/index.js`
- **问题**: `generatePlatformioIni` 覆盖已有 ini 无警告
- **修复**:
  - `project.js`: 新增 `generatePlatformioIniContent()` 函数，仅生成内容不写文件
  - `index.js`: IPC handler 改为 async，检测文件是否存在，存在则弹 `dialog.showMessageBox` 确认
  - 用户取消返回 `{success: false, canceled: true}`
- **验证**: 已有 ini 时弹窗询问是否覆盖

### Bug 3: 输出日志限制 ✅
- **文件**: `src/renderer/App.jsx`
- **问题**: `outputLines` 无限增长，大项目编译内存爆
- **修复**: 新增 `MAX_OUTPUT_LINES = 5000` 常量，`appendOutput` 和 `onPioOutput` 监听器中超出时自动截断（保留最新 5000 行）
- **验证**: 大项目编译后 outputLines 不超过 5000 行

### Bug 4: 文件树目录过滤增强 ✅ (已预修复)
- **文件**: `src/main/file-tree.js`
- **问题**: `.pio` 目录可能出现在文件树
- **确认**: `EXCLUDED_DIRS` 已包含 `.pio`, `.pioenvs`, `.piolibdeps`, `.git`, `node_modules`
- **验证**: .pio 目录不出现在文件树中（已有过滤）

### Bug 5: build 闭包修复 ✅
- **文件**: `src/renderer/App.jsx`
- **问题**: `handleBuild`/`handleUpload`/`handleClean` 使用 `useCallback` 但 `projectPath` 可能是陈旧值
- **修复**:
  - 新增 `projectPathRef = useRef(projectPath)` 并保持同步（`projectPathRef.current = projectPath`）
  - `handleBuild`、`handleUpload`、`handleClean` 中读取 `projectPathRef.current` 而非闭包中的 `projectPath`
  - `projectPath` 从 useCallback 依赖数组中移除，消除不必要的重创建
  - `handleSelectProject`、`handleCreateProject` 中同步更新 ref
- **验证**: 选择项目后立即编译不报错

---

## 修改文件清单

| 文件 | 变更 |
|------|------|
| `src/main/serial-manager.js` | Bug 1: checkPortAvailable 改为 scan-only |
| `src/main/project.js` | Bug 2: 新增 generatePlatformioIniContent() |
| `src/main/index.js` | Bug 2: generate-pio-ini handler 加 dialog 确认 |
| `src/renderer/App.jsx` | Bug 3: outputLines 截断 5000 行; Bug 5: projectPathRef 闭包修复 |

## 验收对照

- [x] 检测串口时不抢占串口
- [x] 已有 ini 时弹窗询问是否覆盖
- [x] 大项目编译后 outputLines 不超过 5000 行
- [x] .pio 目录不出现在文件树中
- [x] 选择项目后立即编译不报错
