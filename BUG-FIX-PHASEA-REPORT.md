# ESP32 IDE - Phase A Bug Fix Report (P0 数据丢失)

**修复日期**: 2026-08-19  
**修复人**: AI 工程师  
**构建状态**: ✅ `npx vite build` 通过

---

## Bug 1: 自动保存机制

**问题**: IDE 崩溃后未保存代码全部丢失  
**影响文件**: `src/main/preload.js`, `src/main/index.js`, `src/renderer/App.jsx`

### 修复内容

1. **preload.js** 新增接口:
   - `autoSave(data)` — 直接保存内容到 `.autosave` 文件
   - `requestAutoSave()` — 请求主进程获取编辑器内容并保存
   - `onRecoverAvailable(callback)` — 监听崩溃恢复通知
   - `recoverResponse(choice)` — 回复恢复选择

2. **index.js** 新增函数:
   - `getAutosavePath()` — 有项目目录 → `项目/.autosave`，无项目 → `~/.esp32ide-autosave/.autosave`
   - `doAutoSave(content)` — 写入 `.autosave` 文件
   - `ipcMain.handle('auto-save')` — IPC 处理器
   - `ipcMain.on('request-auto-save')` — 带 5 秒超时的自动保存

3. **App.jsx** 新增逻辑:
   - `useEffect` 定时器：每 30 秒调用 `requestAutoSave()`
   - `triggerAutoSave()` / `triggerAutoSaveViaMain()` 函数
   - `handleBuild` 中编译前调用 `triggerAutoSaveViaMain()`
   - `handleUpload` 中烧录前调用 `triggerAutoSaveViaMain()`

---

## Bug 2: 崩溃恢复

**问题**: IDE 重启后无崩溃恢复机制  
**影响文件**: `src/main/index.js`, `src/renderer/App.jsx`

### 修复内容

1. **index.js**:
   - `checkAutosaveRecovery()` — 启动时检测 `.autosave` 文件
   - `removeAutosaveFile()` — 删除 `.autosave` 文件
   - `app.whenReady()` 中：检测到恢复文件 → 窗口 `did-finish-load` 后发送 `recover-available` IPC
   - `ipcMain.on('recover-response')` — 无论恢复还是忽略都删除 `.autosave`

2. **App.jsx**:
   - `onRecoverAvailable` 监听器 → 弹窗提示用户
   - `handleRecover()` — 恢复内容到编辑器，删除 `.autosave`
   - `handleIgnoreRecover()` — 忽略恢复，删除 `.autosave`
   - 恢复弹窗 JSX 组件

---

## Bug 3: IPC 超时保护

**问题**: `handleSave`/`handleSaveAs` 中 IPC 响应无超时保护  
**影响文件**: `src/main/index.js`

### 修复内容

- `handleSave()`: `get-editor-content` 请求添加 5 秒超时 (`Promise.race`)
- `handleSaveAs()`: 同上
- 超时后弹窗提示「保存超时，请重试」，返回 `{ success: false, error: '...' }`
- `request-auto-save` 处理器同样添加 5 秒超时

---

## Bug 4: 文件切换保存逻辑

**问题**: `handleFileOpenFromTree` 中保存失败时仍切换文件  
**影响文件**: `src/renderer/App.jsx`

### 修复内容

- `handleFileOpenFromTree()`: 保存前检查 `isModified`，保存后检查 `result.success`
- 保存失败 (`!result?.success`) 时 `return`，不执行文件切换
- 用户仍可看到保存失败的提示（由 `saveFile` 的 Electron dialog 处理）

---

## 验收清单

| 编号 | 验收项 | 状态 |
|------|--------|------|
| 1 | 编辑器修改后 30 秒内自动保存到 .autosave | ✅ |
| 2 | 切换文件前自动保存 | ✅ |
| 3 | 编译/烧录前自动保存 | ✅ |
| 4 | IDE 重启后弹窗提示恢复 | ✅ |
| 5 | 恢复后内容正确加载 | ✅ |
| 6 | 保存操作 5 秒无响应自动失败 | ✅ |
| 7 | 保存失败时不切换文件 | ✅ |

---

## 构建验证

```
$ npx vite build 2>&1
✓ 45 modules transformed.
dist/index.html                   0.38 kB │ gzip:  0.27 kB
dist/assets/index-Bl9P6JrM.css   11.31 kB │ gzip:  2.58 kB
dist/assets/index-Dcg9QOmO.js   241.64 kB │ gzip: 75.21 kB
✓ built in 4.17s
```

## 修改文件清单

| 文件 | 修改行数 | 变更类型 |
|------|---------|---------|
| `src/main/preload.js` | +12 | 新增 API |
| `src/main/index.js` | +80 | 新增函数 + IPC 处理 + 超时保护 |
| `src/renderer/App.jsx` | +70 | 新增自动保存/恢复/文件切换逻辑 |
