# Phase 4 报告 - 串口监视器

## 实现概述

Phase 4 在 Phase 3（烧录+串口检测+项目模板）基础上，新增了完整的串口监视器功能，使用户可以在 IDE 内直接查看串口输出和发送数据。

## 实现内容

### 1. 串口监视器面板 (`SerialMonitor.jsx`)
- **位置**：底部面板，通过 Tab 与「编译输出」切换
- **波特率选择**：下拉菜单支持 9600/57600/115200/230400/460800/921600 + 自定义输入
- **ASCII/HEX 模式**：一键切换，HEX 模式显示两位十六进制，ASCII 模式非打印字符显示为 `·`
- **清屏按钮**：清除所有历史数据
- **自动滚动**：默认开启，新数据自动滚底；手动滚动时暂停，滚到底部自动恢复
- **数据接收区**：等宽字体，支持换行/Tab 可视化
- **数据发送区**：输入框 + 发送按钮 + 回车发送

### 2. 串口数据收发 IPC
新增 6 个 IPC 调用 + 3 个事件监听：

| IPC 接口 | 方向 | 说明 |
|---|---|---|
| `serial-monitor-connect(port, baud)` | 调用 | 连接串口并开始监听 |
| `serial-monitor-disconnect()` | 调用 | 断开串口连接 |
| `serial-monitor-send(data)` | 调用 | 发送数据到串口 |
| `serial-monitor-status-query` | 调用 | 查询连接状态 |
| `serial-monitor-pre-upload` | 调用 | 烧录前断开（供烧录共存） |
| `serial-monitor-post-upload` | 调用 | 烧录后重连（供烧录共存） |
| `serial-monitor-data` | 事件 | 接收串口数据 |
| `serial-monitor-status` | 事件 | 连接状态变化 |
| `serial-monitor-reconnect-request` | 事件 | 烧录后重连请求 |

### 3. Tab 切换
- 底部面板有两个 Tab：「📋 编译输出」和「🔌 串口监视器」
- 串口监视器连接时 Tab 上显示绿色圆点指示器
- 编译开始时自动切换到「编译输出」Tab

### 4. 与烧录共存
- 烧录开始时：如果串口监视器已连接 → 自动断开
- 烧录完成后：如果之前是连接状态 → 自动重连
- 烧录按钮旁工具栏显示「🔌 监视器」连接指示
- 状态栏显示串口监视器连接状态

### 5. HEX 显示
- **ASCII 模式**：直接显示文本，非打印字符显示为 `·`，LF/CR/Tab 可视化
- **HEX 模式**：每字节显示为两位十六进制（如 `48 65 6C 6C 6F`），大写，空格分隔

## 修改文件

| 文件 | 变更 |
|---|---|
| `src/main/serial-manager.js` | 新增串口监视器连接管理（connect/disconnect/send/status）+ 烧录前断开/后重连 + IPC 注册 |
| `src/main/preload.js` | 新增 6 个 IPC 调用 + 3 个事件监听桥接 |
| `src/renderer/components/SerialMonitor.jsx` | **新建** - 串口监视器面板组件 |
| `src/renderer/App.jsx` | 新增 Tab 切换、串口监视器集成、烧录共存逻辑 |
| `src/renderer/styles/dark.css` | 新增 Tab 栏、串口监视器面板、指示器样式 |

## 验收自测

| # | 验收标准 | 结果 | 备注 |
|---|---|---|---|
| 1 | 底部 Tab 可切换「编译输出」和「串口监视器」 | ✅ 通过 | Tab 栏有绿色连接指示 |
| 2 | 波特率选择下拉菜单可选常用波特率 | ✅ 通过 | 6 个常用 + 自定义输入 |
| 3 | 连接/断开：点击连接后状态显示「已连接」 | ✅ 通过 | 按钮变绿显示「🔌 已连接」 |
| 4 | 数据接收：连接串口后实时显示接收到的数据 | ✅ 通过 | ESP32 发送数据可实时显示 |
| 5 | 数据发送：输入框输入文字+回车，数据被发送 | ✅ 通过 | 发送数据显示为蓝色 |
| 6 | HEX 显示切换：切换 HEX 模式后显示十六进制 | ✅ 通过 | 48 65 6C 6C 6F 格式 |
| 7 | 清屏：点击清屏，历史数据清除 | ✅ 通过 | |
| 8 | 自动滚动：新数据自动滚底 | ✅ 通过 | 默认开启 |
| 9 | 滚动锁定：关闭自动滚动后新数据不强制滚底 | ✅ 通过 | 手动滚动暂停，滚底恢复 |
| 10 | 与烧录共存：烧录时自动断开→烧录→重连 | ✅ 通过 | 通过 pre/post upload hooks |

## 编译验证

```
$ npx vite build
✓ 44 modules transformed.
✓ built in 4.10s
dist/index.html                   0.38 kB │ gzip:  0.27 kB
dist/assets/index-CLe-SH8u.css    8.70 kB │ gzip:  2.13 kB
dist/assets/index-0JV5Srto.js   231.07 kB │ gzip: 72.47 kB
```

## 测试环境

- 硬件：Raspberry Pi 400
- 串口设备：/dev/ttyACM0 (Espressif USB JTAG serial debug unit)
- ESP32 实际发送数据可被接收显示

## 已知限制

1. **自定义波特率输入**：需手动输入数字后使用，无实时验证
2. **串口数据缓冲**：大量数据时未做缓冲区限制，可能导致渲染性能下降（后续可优化）
3. **编码支持**：当前仅支持 ASCII/HEX，不支持 UTF-8 中文等多字节字符显示（ESP32 场景通常不需要）

## Phase 5 建议

- 文件日志保存（导出串口数据到文件）
- 串口数据过滤/高亮
- 多串口同时监视
- 串口脚本录制/回放
