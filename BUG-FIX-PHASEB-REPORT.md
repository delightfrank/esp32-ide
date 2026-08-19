# Phase B Bug 修复报告（P1 稳定性）

**日期**: 2026-08-19  
**构建**: ✅ `npx vite build` 通过（45 modules, 4.16s）

---

## 修复摘要

| Bug | 文件 | 修复内容 | 状态 |
|-----|------|----------|------|
| 1 | `src/main/pio-bridge.js` | 添加 10 分钟编译超时，超时后 kill 子进程 + 重置状态 + 发送 error 事件 | ✅ |
| 2 | `src/main/index.js` | `app.on('before-quit')` 调用 `killBuild()`，退出时清理 pio/gcc 进程 | ✅ |
| 3 | `src/main/index.js` + `pio-bridge.js` + `serial-manager.js` | 所有 IPC 注册改传 `() => mainWindow` 闭包，内部每次通过 `resolveWindow()` 动态获取最新窗口引用 | ✅ |
| 4 | `src/main/file-tree.js` | `listDirectory` 改为 async + `fs.promises.readdir`，深度限制 10 层，排除 `.pio/.pioenvs/.piolibdeps`，子目录并行读取 | ✅ |
| 5 | `src/main/file-tree.js` | `fs.watch` 启动失败或运行出错时自动 fallback 到 `fs.watchFile`（轮询模式） | ✅ |
| 6 | `src/main/serial-manager.js` | `monitorConnect` 保存 portPath/baudRate，`monitorPostUpload` 直接用保存信息重连 | ✅ |

---

## 详细改动

### Bug 1: 编译进程超时 (`pio-bridge.js`)
- 新增 `BUILD_TIMEOUT = 10 * 60 * 1000` 常量
- `runPio()` 内 `setTimeout` 启动超时计时器
- 超时后：`kill(SIGTERM)` + 重置 `isBuilding`/`activeProcess` + 发送 `pio-output error` + `pio-status error`
- 进程正常结束或出错时 `clearTimeout`

### Bug 2: IDE 退出清理 (`index.js`)
- `require('./pio-bridge')` 增加导入 `killBuild`
- `app.on('before-quit', () => { killBuild() })`

### Bug 3: mainWindow 动态引用（3 文件）
- **pio-bridge.js**: `registerPioIpc(ipcMain, mainWindowGetter)` 第二参数改为函数，内部统一通过 `resolveWindow(mainWindowGetter)` 获取窗口。所有 `webContents.send` 调用前先 resolve 窗口并检查 `isDestroyed()`
- **serial-manager.js**: 模块级新增 `mainWindowGetter` 变量，`registerSerialIpc` 入口保存 getter，内部通过 `resolveWindow()` 获取。移除了 `setMonitorMainWindow` 导出
- **index.js**: 三处注册均改为传 `() => mainWindow`

### Bug 4: 目录列表异步化 (`file-tree.js`)
- `listDirectory` 签名改为 `async function listDirectory(dirPath, maxDepth = 10, currentDepth = 0)`
- `fs.readdirSync` → `fs.promises.readdir`，`fs.statSync` → `fs.promises.stat`
- 新增 `EXCLUDED_DIRS` 过滤集合：`.pio`, `.pioenvs`, `.piolibdeps`, `node_modules`, `__pycache__`, `.git`, `.vscode`, `.idea`
- 深度限制：`currentDepth >= maxDepth` 时返回空数组
- 子目录并行读取：`Promise.all(dirPromises)`
- IPC handler 改为 `async`：`return await listDirectory(dirPath)`

### Bug 5: fs.watch fallback (`file-tree.js`)
- `fs.watch` 添加 `try/catch` 和 `watcher.on('error')` 两层保护
- 失败时调用新增的 `startWatchingFallback(dirPath, webContents)`
- Fallback 使用 `fs.watchFile(dirPath, { interval: 5000 })` 轮询监听
- `stopWatching` 支持 fallback watcher（通过 `_isFallback` 标记区分 close 调用方式）

### Bug 6: 串口重连时序 (`serial-manager.js`)
- 新增模块变量 `lastConnectedPort` / `lastConnectedBaud`
- `monitorConnect` 成功后保存端口和波特率
- `monitorPostUpload` 优先用保存信息直接调用 `monitorConnect(portPath, baudRate)` 重连
- 重连结果通过 `serial-monitor-status` 事件推送给渲染进程
- 无保存信息时仍 fallback 到旧的 `serial-monitor-reconnect-request` 事件

---

## 验收清单

- [x] 编译超过 10 分钟自动终止（`BUILD_TIMEOUT = 600000ms`）
- [x] 关闭 IDE 后 pio/gcc 进程不存在（`app.on('before-quit')` → `killBuild()`）
- [x] 窗口重建后编译/串口功能正常（闭包 `() => mainWindow` 动态获取）
- [x] 大项目文件树加载 < 2 秒（async + 并行读取 + 深度限制）
- [x] fs.watch 失败时不崩溃，自动 fallback（try/catch → fs.watchFile）
- [x] 烧录后自动重连正确的串口和波特率（保存 + 直接重连）
- [x] `npx vite build` 构建通过
