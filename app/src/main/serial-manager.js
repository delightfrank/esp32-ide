/**
 * ESP32 IDE - Serial Port Manager
 * Scan available ports, detect occupancy, serial monitor connect/send/receive
 */
const { SerialPort } = require('serialport')

// Port scan cache
let cachedPorts = []
let lastScanTime = 0
const CACHE_TTL = 2000

// Serial monitor connection state
let monitorPort = null
let monitorConnected = false
let monitorMainWindow = null
let mainWindowGetter = null
let monitorWasConnected = false

// Saved last connection info for auto-reconnect after upload
let lastConnectedPort = null
let lastConnectedBaud = null

/**
 * Resolve mainWindowGetter to actual window reference
 */
function resolveWindow() {
  if (typeof mainWindowGetter === 'function') {
    return mainWindowGetter()
  }
  return monitorMainWindow
}

/**
 * Connect serial monitor (H4: validates port exists before opening)
 */
function monitorConnect(portPath, baudRate) {
  if (monitorPort && monitorPort.isOpen) {
    return { success: false, error: 'Serial port already in use, please disconnect first' }
  }

  return new Promise((resolve) => {
    SerialPort.list().then((ports) => {
      const exists = ports.some(p => p.path === portPath)
      if (!exists) {
        resolve({ success: false, error: 'Port not found: ' + portPath })
        return
      }

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
          lastConnectedPort = portPath
          lastConnectedBaud = baudRate || 115200

          port.on('data', (data) => {
            const mw = resolveWindow()
            if (mw && !mw.isDestroyed()) {
              mw.webContents.send('serial-monitor-data', {
                data: Array.from(data),
                timestamp: Date.now()
              })
            }
          })

          port.on('error', (err) => {
            console.error('Serial monitor error:', err.message)
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
    }).catch((err) => {
      resolve({ success: false, error: 'Port scan failed: ' + err.message })
    })
  })
}

/**
 * Disconnect serial monitor
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
 * Send data to serial port
 */
function monitorSend(data) {
  if (!monitorPort || !monitorPort.isOpen) {
    return { success: false, error: 'Serial port not connected' }
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
 * Get monitor connection status
 */
function monitorGetStatus() {
  return {
    connected: monitorConnected,
    port: monitorPort?.path || null,
    baudRate: monitorPort?.baudRate || null
  }
}

/**
 * Disconnect before upload (called by pio-bridge)
 */
function monitorPreUpload() {
  monitorWasConnected = monitorConnected
  if (monitorConnected) {
    return monitorDisconnect()
  }
  return Promise.resolve({ success: true })
}

/**
 * Reconnect after upload (called by pio-bridge)
 * Uses saved portPath/baudRate to reconnect directly
 */
function monitorPostUpload() {
  if (monitorWasConnected && monitorPort === null) {
    monitorWasConnected = false

    if (lastConnectedPort && lastConnectedBaud) {
      const portPath = lastConnectedPort
      const baudRate = lastConnectedBaud
      lastConnectedPort = null
      lastConnectedBaud = null
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
 * Scan available serial ports
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
      manufacturer: p.manufacturer || 'Unknown',
      vendorId: p.vendorId || '',
      productId: p.productId || '',
      pnpId: p.pnpId || ''
    }))
    lastScanTime = now
    return cachedPorts
  } catch (err) {
    console.error('Port scan failed:', err.message)
    cachedPorts = []
    lastScanTime = now
    return []
  }
}

/**
 * Force refresh port list (ignore cache)
 */
async function refreshPorts() {
  cachedPorts = []
  lastScanTime = 0
  return await listPorts()
}

/**
 * Check if a port exists (scan only, does not open the port)
 */
async function checkPortAvailable(portPath) {
  try {
    const ports = await SerialPort.list()
    const exists = ports.some(p => p.path === portPath)
    if (exists) {
      return { available: true }
    } else {
      return { available: false, error: 'Port device not found' }
    }
  } catch (err) {
    return { available: false, error: 'Port scan failed: ' + err.message }
  }
}

/**
 * Filter ESP32-related ports (heuristic match)
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
 * Register serial port IPC handlers
 */
function registerSerialIpc(ipcMain, getWindow) {
  mainWindowGetter = getWindow

  ipcMain.handle('serial-list', async () => {
    const ports = await listPorts()
    return { success: true, ports }
  })

  ipcMain.handle('serial-refresh', async () => {
    const ports = await refreshPorts()
    return { success: true, ports }
  })

  ipcMain.handle('serial-check', async (event, portPath) => {
    return await checkPortAvailable(portPath)
  })

  ipcMain.handle('serial-list-esp', async () => {
    const allPorts = await listPorts()
    const espPorts = filterEspPorts(allPorts)
    return { success: true, ports: espPorts, allPorts }
  })

  ipcMain.handle('serial-monitor-connect', async (event, portPath, baudRate) => {
    return await monitorConnect(portPath, baudRate)
  })

  ipcMain.handle('serial-monitor-disconnect', async () => {
    return await monitorDisconnect()
  })

  ipcMain.handle('serial-monitor-send', async (event, data) => {
    return await monitorSend(data)
  })

  ipcMain.handle('serial-monitor-status-query', () => {
    return monitorGetStatus()
  })

  ipcMain.handle('serial-monitor-pre-upload', async () => {
    return await monitorPreUpload()
  })

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
