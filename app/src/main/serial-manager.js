/**
 * ESP32 IDE - 串口管理模块
 * 扫描系统可用串口，检测占用状态，提供串口选择功能
 * Phase 4: 串口监视器 - 连接/断开/数据收发
 */
const { SerialPort } = require('serialport')

// 缓存上次扫描结果
let cachedPorts = []
let lastScanTime = 0
const CACHE_TTL = 2000 // 2秒缓存

// ═══════════════════════════════════════════════
// 串口监视器连接管理
// ═══════════════════════════════════════════════

let monitorPort = null          // 当前监视器连接的串口
let monitorConnected = false   // 连接状态
let monitorMainWindow = null   // 主窗口引用（Bug 3: 改为动态获取）
let mainWindowGetter = null    // Bug 3: 获取 mainWindow 的闭包函数
let monitorWasConnected = false // 烧录前是否连接（用于烧录后自动重连）

// Bug 6: 保存最近连接的端口和波特率，用于烧录后自动重连
let lastConnectedPort = null
let lastConnectedBaud = null

/**
 * 解析 mainWindowGetter 为实际窗口引用
 */
function resolveWindow() {
  if (typeof mainWindowGetter === 'function') {
    return mainWindowGetter()
  }
  return monitorMainWindow
}

/**
 * 连接串口监视器
 */
function monitorConnect(portPath, baudRate) {
  if (monitorPort && monitorPort.isOpen) {
    return { success: false, error: '串口已被占用，请先断开' }
  }

  return new Promise((resolve) => {
    try {
      const port = new SerialPort({
        path: portPath,
        baudRate: baudRate || 115200,
        autoOpen: false
      })

      port.open((err) => {
        if (err) {
          resolve({ success: false, error: err.message })
          return
        }

        monitorPort = port
        monitorConnected = true

        // Bug 6: 保存连接信息，供烧录后重连使用
        lastConnectedPort = portPath
        lastConnectedBaud = baudRate || 115200

        // 接收数据
        port.on('data', (data) => {
          const mw = resolveWindow()
          if (mw && !mw.isDestroyed()) {
            mw.webContents.send('serial-monitor-data', {
              data: Array.from(data),
              timestamp: Date.now()
            })
          }
        })

        // 连接错误
        port.on('error', (err) => {
          console.error('串口监视器错误:', err.message)
          monitorConnected = false
          monitorPort = null
          const mw = resolveWindow()
          if (mw && !mw.isDestroyed()) {
            mw.webContents.send('serial-monitor-status', {
              connected: false,
              error: err.message
            })
          }
        })

        // 连接关闭
        port.on('close', () => {
          monitorConnected = false
          monitorPort = null
          const mw = resolveWindow()
          if (mw && !mw.isDestroyed()) {
            mw.webContents.send('serial-monitor-status', {
              connected: false
            })
          }
        })

        resolve({ success: true })
      })
    } catch (err) {
      resolve({ success: false, error: err.message })
    }
  })
}

/**
 * 断开串口监视器
 */
function monitorDisconnect() {
  return new Promise((resolve) => {
    if (!monitorPort || !monitorPort.isOpen) {
      monitorConnected = false
      resolve({ success: true })
      return
    }

    monitorPort.close((err) => {
      if (err) {
        resolve({ success: false, error: err.message })
      } else {
        monitorConnected = false
        monitorPort = null
        resolve({ success: true })
      }
    })
  })
}

/**
 * 发送数据到串口
 */
function monitorSend(data) {
  if (!monitorPort || !monitorPort.isOpen) {
    return { success: false, error: '串口未连接' }
  }

  return new Promise((resolve) => {
    monitorPort.write(data, (err) => {
      if (err) {
        resolve({ success: false, error: err.message })
      } else {
        resolve({ success: true })
      }
    })
  })
}

/**
 * 获取监视器连接状态
 */
function monitorGetStatus() {
  return {
    connected: monitorConnected,
    port: monitorPort?.path || null,
    baudRate: monitorPort?.baudRate || null
  }
}

/**
 * 烧录前断开（供 pio-bridge 调用）
 */
function monitorPreUpload() {
  monitorWasConnected = monitorConnected
  if (monitorConnected) {
    return monitorDisconnect()
  }
  return Promise.resolve({ success: true })
}

/**
 * 烧录后重连（供 pio-bridge 调用）
 * Bug 6: 使用保存的 portPath/baudRate 直接重连，不再依赖渲染进程
 */
function monitorPostUpload() {
  if (monitorWasConnected && monitorPort === null) {
    monitorWasConnected = false

    // Bug 6: 优先使用保存的连接信息直接重连
    if (lastConnectedPort && lastConnectedBaud) {
      const portPath = lastConnectedPort
      const baudRate = lastConnectedBaud
      // 清除保存的信息，重连成功后 monitorConnect 会重新保存
      lastConnectedPort = null
      lastConnectedBaud = null
      // 异步重连，不阻塞返回
      monitorConnect(portPath, baudRate).then((result) => {
        const mw = resolveWindow()
        if (mw && !mw.isDestroyed()) {
          mw.webContents.send('serial-monitor-status', {
            connected: result.success,
            port: portPath,
            baudRate: baudRate,
            error: result.error || null
          })
        }
      })
      return { success: true, reconnecting: true }
    }

    // Fallback: 通知渲染进程触发重连（兼容旧逻辑）
    const mw = resolveWindow()
    if (mw && !mw.isDestroyed()) {
      mw.webContents.send('serial-monitor-reconnect-request')
    }
    return { success: true, reconnecting: true }
  }
  monitorWasConnected = false
  return { success: true, reconnecting: false }
}

/**
 * 扫描系统可用串口
 */
async function listPorts() {
  const now = Date.now()
  if (cachedPorts.length > 0 && (now - lastScanTime) < CACHE_TTL) {
    return cachedPorts
  }

  try {
    const ports = await SerialPort.list()
    cachedPorts = ports.map(p => ({
      path: p.path,
      manufacturer: p.manufacturer || '未知',
      vendorId: p.vendorId || '',
      productId: p.productId || '',
      pnpId: p.pnpId || ''
    }))
    lastScanTime = now
    return cachedPorts
  } catch (err) {
    console.error('串口扫描失败:', err.message)
    cachedPorts = []
    lastScanTime = now
    return []
  }
}

/**
 * 强制刷新串口列表（忽略缓存）
 */
async function refreshPorts() {
  cachedPorts = []
  lastScanTime = 0
  return await listPorts()
}

/**
 * 检测串口是否存在（仅扫描，不打开串口，避免抢占通信）
 */
async function checkPortAvailable(portPath) {
  try {
    const ports = await SerialPort.list()
    const exists = ports.some(p => p.path === portPath)
    if (exists) {
      return { available: true }
    } else {
      return { available: false, error: '串口设备不存在' }
    }
  } catch (err) {
    return { available: false, error: '串口扫描失败: ' + err.message }
  }
}

/**
 * 获取 ESP32 相关串口（启发式匹配）
 */
function filterEspPorts(ports) {
  const espKeywords = [
    'cp210', 'ch340', 'ch341', 'ftdi', 'silicon labs',
    'wch', 'usb-serial', 'usb serial', 'uart', 'esp32',
    'espressif', 'silabs'
  ]

  return ports.filter(p => {
    const text = `${p.manufacturer} ${p.pnpId} ${p.path}`.toLowerCase()
    return espKeywords.some(kw => text.includes(kw))
  })
}

/**
 * 注册串口相关 IPC 处理器
 * @param {Electron.Main} ipcMain
 * @param {Function} mainWindowGetter - 返回当前 mainWindow 的闭包函数
 */
function registerSerialIpc(ipcMain, getWindow) {
  // Bug 3: 保存 getter 函数，用于模块内部动态获取窗口
  mainWindowGetter = getWindow

  // 扫描串口
  ipcMain.handle('serial-list', async () => {
    const ports = await listPorts()
    return { success: true, ports }
  })

  // 强制刷新串口
  ipcMain.handle('serial-refresh', async () => {
    const ports = await refreshPorts()
    return { success: true, ports }
  })

  // 检测串口是否可用
  ipcMain.handle('serial-check', async (event, portPath) => {
    return await checkPortAvailable(portPath)
  })

  // 获取 ESP32 相关串口
  ipcMain.handle('serial-list-esp', async () => {
    const allPorts = await listPorts()
    const espPorts = filterEspPorts(allPorts)
    return { success: true, ports: espPorts, allPorts }
  })

  // ─── 串口监视器 IPC ───

  // 连接串口监视器
  ipcMain.handle('serial-monitor-connect', async (event, portPath, baudRate) => {
    return await monitorConnect(portPath, baudRate)
  })

  // 断开串口监视器
  ipcMain.handle('serial-monitor-disconnect', async () => {
    return await monitorDisconnect()
  })

  // 发送数据
  ipcMain.handle('serial-monitor-send', async (event, data) => {
    return await monitorSend(data)
  })

  // 获取连接状态
  ipcMain.handle('serial-monitor-status-query', () => {
    return monitorGetStatus()
  })

  // 烧录前断开串口
  ipcMain.handle('serial-monitor-pre-upload', async () => {
    return await monitorPreUpload()
  })

  // 烧录后重连
  ipcMain.handle('serial-monitor-post-upload', async () => {
    return await monitorPostUpload()
  })
}

module.exports = {
  listPorts,
  refreshPorts,
  checkPortAvailable,
  filterEspPorts,
  registerSerialIpc,
  monitorConnect,
  monitorDisconnect,
  monitorSend,
  monitorGetStatus,
  monitorPreUpload,
  monitorPostUpload
}
