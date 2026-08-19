# ESP32 IDE Phase D Bug 修复报告

**日期**: 2026-08-19  
**阶段**: Phase D (P3 UX/安全，最终阶段)  
**状态**: ✅ 全部完成，构建通过

---

## 修复摘要

| # | Bug | 文件 | 状态 |
|---|-----|------|------|
| 1 | 中文路径检测 | `src/main/index.js` | ✅ |
| 2 | 文件编码检测 | `src/main/index.js` | ✅ |
| 3 | preload 安全加固 | `src/main/preload.js` | ✅ |
| 4 | deleteItem 异常处理 | `src/main/file-tree.js` | ✅ |
| 5 | 串口监视器时间戳 | `src/renderer/components/SerialMonitor.jsx` | ✅ |

---

## 详细修复内容

### Bug 1: 中文路径检测
- **位置**: `src/main/index.js` 第 20-23 行（辅助函数）、第 468-484 行（检测逻辑）
- **修复**: 新增 `hasChineseOrSpace()` 辅助函数，`app.whenReady` 后检测 `process.cwd()` 和 `__dirname` 是否含中文字符或空格。如含则弹窗警告，用户可选择继续或退出。
- **验收**: 路径含中文时弹窗警告 ✅

### Bug 2: 文件编码检测
- **位置**: `src/main/index.js` 第 282-315 行（文件打开菜单项）
- **修复**: 打开文件时先尝试 UTF-8 读取，若解码产生替换字符（`\uFFFD`）则回退到 `latin1` 读取，检测是否含中文字符，弹窗提示用户可能使用了 GBK/GB2312 编码。
- **验收**: GBK 文件打开时提示编码问题 ✅

### Bug 3: preload 安全加固
- **位置**: `src/main/preload.js` 第 105 行
- **修复**: 移除 `fileWrite` 方法暴露。文件保存只通过 `save-file` IPC 通道（`handleSave`/`handleSaveAs`），渲染进程无法再直接写任意文件。经检查无渲染进程代码依赖 `fileWrite`。
- **验收**: 渲染进程无法直接写任意文件 ✅

### Bug 4: deleteItem 异常处理
- **位置**: `src/main/file-tree.js` 第 213-226 行
- **修复**: `deleteItem` 函数内部增加 try/catch，包装 `fs.statSync`、`fs.rmSync`、`fs.unlinkSync` 调用。异常时抛出格式化的错误信息。外层 `file-delete` IPC handler 已有 try/catch，双重防护确保不崩溃。
- **验收**: 删除失败不崩溃，返回错误信息 ✅

### Bug 5: 串口监视器时间戳
- **位置**: `src/renderer/components/SerialMonitor.jsx` 第 33-41 行（时间戳格式化）、第 220-238 行（formatBytes 增加时间戳参数）
- **修复**: 新增 `formatTimestamp()` 回调，将时间戳格式化为 `HH:MM:SS.mmm`。修改 `formatBytes()` 函数增加 `timestamp` 参数，在每条数据前附加 `[HH:MM:SS.mmm]` 前缀。渲染时传入 `line.timestamp`。
- **验收**: 串口接收数据显示时间戳 ✅

---

## 构建验证

```
✓ 45 modules transformed.
dist/index.html                   0.38 kB │ gzip:  0.28 kB
dist/assets/index-Bl9P6JrM.css   11.31 kB │ gzip:  2.58 kB
dist/assets/index-vHbYXCFh.js   242.35 kB │ gzip: 75.52 kB
✓ built in 4.26s
```

构建成功，无错误。
