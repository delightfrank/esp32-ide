/**
 * ESP32 IDE - 串口监视器面板组件
 * Phase 4: 串口数据收发、波特率选择、HEX 显示、自动滚动
 */
import React, { useEffect, useRef, useState, useCallback } from 'react'

// 常用波特率
const BAUD_RATES = [9600, 57600, 115200, 230400, 460800, 921600]

function SerialMonitor({ serialPorts, selectedPort, onStatusChange }) {
  // 连接状态
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [baudRate, setBaudRate] = useState(115200)
  const [customBaud, setCustomBaud] = useState('')
  const [useCustomBaud, setUseCustomBaud] = useState(false)

  // 显示模式
  const [hexMode, setHexMode] = useState(false)

  // 自动滚动
  const [autoScroll, setAutoScroll] = useState(true)

  // 数据
  const [outputLines, setOutputLines] = useState([])
  const [sendInput, setSendInput] = useState('')

  // 引用
  const consoleRef = useRef(null)
  const sendInputRef = useRef(null)

  // Bug 5: 格式化时间戳 HH:MM:SS.mmm
  const formatTimestamp = useCallback((ts) => {
    if (!ts) return ''
    const d = new Date(ts)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const ss = String(d.getSeconds()).padStart(2, '0')
    const mmm = String(d.getMilliseconds()).padStart(3, '0')
    return `${hh}:${mm}:${ss}.${mmm}`
  }, [])

  // 用于存储烧录前的连接信息（用于重连）
  const [lastPort, setLastPort] = useState(null)
  const [lastBaud, setLastBaud] = useState(null)

  // ═══════════════════════════════════════════════
  // IPC 监听
  // ═══════════════════════════════════════════════

  useEffect(() => {
    // 接收串口数据
    window.electronAPI?.onSerialMonitorData((data) => {
      const bytes = new Uint8Array(data.data)
      setOutputLines(prev => [...prev, { bytes, timestamp: data.timestamp }])
    })

    // 连接状态变化
    window.electronAPI?.onSerialMonitorStatus((data) => {
      setConnected(data.connected)
      setConnecting(false)
      if (data.error) {
        setOutputLines(prev => [...prev, {
          bytes: new TextEncoder().encode(`[错误] ${data.error}\n`),
          timestamp: Date.now(),
          isError: true
        }])
      }
      onStatusChange?.(data.connected)
    })

    // 烧录后重连请求
    window.electronAPI?.onSerialMonitorReconnectRequest(() => {
      if (lastPort) {
        handleConnectInternal(lastPort, lastBaud || baudRate)
      }
    })
  }, [lastPort, lastBaud, baudRate, onStatusChange])

  // ═══════════════════════════════════════════════
  // 自动滚动
  // ═══════════════════════════════════════════════

  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [outputLines, autoScroll])

  const handleScroll = useCallback(() => {
    if (!consoleRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = consoleRef.current
    const atBottom = scrollHeight - scrollTop - clientHeight < 20
    if (!atBottom && autoScroll) {
      setAutoScroll(false)
    } else if (atBottom && !autoScroll) {
      setAutoScroll(true)
    }
  }, [autoScroll])

  // ═══════════════════════════════════════════════
  // 连接/断开
  // ═══════════════════════════════════════════════

  const getEffectiveBaudRate = useCallback(() => {
    if (useCustomBaud && customBaud) {
      const parsed = parseInt(customBaud, 10)
      return isNaN(parsed) ? 115200 : parsed
    }
    return baudRate
  }, [useCustomBaud, customBaud, baudRate])

  const handleConnectInternal = useCallback(async (port, baud) => {
    setConnecting(true)
    try {
      const result = await window.electronAPI?.serialMonitorConnect(port, baud)
      if (result?.success) {
        setConnected(true)
        setLastPort(port)
        setLastBaud(baud)
        onStatusChange?.(true)
      } else {
        setConnecting(false)
        setOutputLines(prev => [...prev, {
          bytes: new TextEncoder().encode(`[错误] 连接失败: ${result?.error}\n`),
          timestamp: Date.now(),
          isError: true
        }])
      }
    } catch (err) {
      setConnecting(false)
      setOutputLines(prev => [...prev, {
        bytes: new TextEncoder().encode(`[错误] 连接异常: ${err.message}\n`),
        timestamp: Date.now(),
        isError: true
      }])
    }
  }, [onStatusChange])

  const handleConnect = useCallback(async () => {
    if (!selectedPort) {
      setOutputLines(prev => [...prev, {
        bytes: new TextEncoder().encode('[错误] 请先在工具栏选择串口\n'),
        timestamp: Date.now(),
        isError: true
      }])
      return
    }
    await handleConnectInternal(selectedPort, getEffectiveBaudRate())
  }, [selectedPort, getEffectiveBaudRate, handleConnectInternal])

  const handleDisconnect = useCallback(async () => {
    try {
      await window.electronAPI?.serialMonitorDisconnect()
      setConnected(false)
      onStatusChange?.(false)
    } catch (err) {
      setOutputLines(prev => [...prev, {
        bytes: new TextEncoder().encode(`[错误] 断开失败: ${err.message}\n`),
        timestamp: Date.now(),
        isError: true
      }])
    }
  }, [onStatusChange])

  // ═══════════════════════════════════════════════
  // 发送数据
  // ═══════════════════════════════════════════════

  const handleSend = useCallback(async () => {
    if (!sendInput.trim() || !connected) return

    const data = sendInput + '\r\n' // 添加回车换行
    try {
      const result = await window.electronAPI?.serialMonitorSend(data)
      if (result?.success) {
        // 显示发送的数据
        setOutputLines(prev => [...prev, {
          bytes: new TextEncoder().encode(`→ ${sendInput}\n`),
          timestamp: Date.now(),
          isSent: true
        }])
        setSendInput('')
        sendInputRef.current?.focus()
      } else {
        setOutputLines(prev => [...prev, {
          bytes: new TextEncoder().encode(`[错误] 发送失败: ${result?.error}\n`),
          timestamp: Date.now(),
          isError: true
        }])
      }
    } catch (err) {
      setOutputLines(prev => [...prev, {
        bytes: new TextEncoder().encode(`[错误] 发送异常: ${err.message}\n`),
        timestamp: Date.now(),
        isError: true
      }])
    }
  }, [sendInput, connected])

  const handleSendKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend])

  // ═══════════════════════════════════════════════
  // 清屏
  // ═══════════════════════════════════════════════

  const handleClear = useCallback(() => {
    setOutputLines([])
  }, [])

  // ═══════════════════════════════════════════════
  // 数据格式化
  // ═══════════════════════════════════════════════

  const formatBytes = useCallback((bytes, isHex, timestamp) => {
    const ts = formatTimestamp(timestamp)
    const prefix = ts ? `[${ts}] ` : ''
    if (isHex) {
      return prefix + Array.from(bytes)
        .map(b => b.toString(16).toUpperCase().padStart(2, '0'))
        .join(' ')
    }
    // ASCII 模式：非打印字符显示为 ·
    return prefix + Array.from(bytes)
      .map(b => {
        if (b >= 32 && b <= 126) return String.fromCharCode(b)
        if (b === 10) return '↵\n'  // LF
        if (b === 13) return '↵'    // CR
        if (b === 9) return '→\t'   // Tab
        return '·'
      })
      .join('')
  }, [formatTimestamp])

  // ═══════════════════════════════════════════════
  // 渲染
  // ═══════════════════════════════════════════════

  return (
    <div className="console-panel serial-monitor">
      {/* 工具栏 */}
      <div className="console-header serial-monitor-header">
        <div className="serial-monitor-controls">
          {/* 连接/断开按钮 */}
          <button
            className={`console-btn serial-connect-btn ${connected ? 'connected' : ''} ${connecting ? 'connecting' : ''}`}
            onClick={connected ? handleDisconnect : handleConnect}
            disabled={connecting}
          >
            {connecting ? '⏳ 连接中...' : connected ? '🔌 已连接' : '▶ 连接'}
          </button>

          <div className="toolbar-separator" />

          {/* 波特率选择 */}
          <select
            className="toolbar-select baud-select"
            value={useCustomBaud ? 'custom' : baudRate}
            onChange={(e) => {
              if (e.target.value === 'custom') {
                setUseCustomBaud(true)
              } else {
                setUseCustomBaud(false)
                setBaudRate(parseInt(e.target.value, 10))
              }
            }}
          >
            {BAUD_RATES.map(rate => (
              <option key={rate} value={rate}>{rate}</option>
            ))}
            <option value="custom">自定义...</option>
          </select>

          {useCustomBaud && (
            <input
              type="number"
              className="toolbar-input baud-custom-input"
              placeholder="波特率"
              value={customBaud}
              onChange={(e) => setCustomBaud(e.target.value)}
              min="1"
              max="4000000"
            />
          )}

          <div className="toolbar-separator" />

          {/* HEX 模式切换 */}
          <button
            className={`console-btn ${hexMode ? 'active' : ''}`}
            onClick={() => setHexMode(!hexMode)}
            title={hexMode ? '切换到 ASCII 模式' : '切换到 HEX 模式'}
          >
            {hexMode ? '🔢 HEX' : '📝 ASCII'}
          </button>

          {/* 自动滚动 */}
          <button
            className={`console-btn ${autoScroll ? 'active' : ''}`}
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? '自动滚动已开启' : '自动滚动已关闭'}
          >
            {autoScroll ? '📜 自动滚动' : '📜 暂停滚动'}
          </button>

          {/* 清屏 */}
          <button className="console-btn" onClick={handleClear} title="清空输出">
            🗑️ 清空
          </button>
        </div>
      </div>

      {/* 数据接收区 */}
      <div
        className="console-body serial-output"
        ref={consoleRef}
        onScroll={handleScroll}
      >
        {outputLines.length === 0 ? (
          <div className="console-empty">
            {connected ? '等待数据...' : '请先连接串口'}
          </div>
        ) : (
          outputLines.map((line, i) => {
            let className = 'console-line serial-line'
            if (line.isError) className += ' serial-error'
            if (line.isSent) className += ' serial-sent'

            return (
              <div key={i} className={className}>
                <span className="serial-data">
                  {formatBytes(line.bytes, hexMode, line.timestamp)}
                </span>
              </div>
            )
          })
        )}
      </div>

      {/* 数据发送区 */}
      <div className="serial-send-bar">
        <input
          ref={sendInputRef}
          type="text"
          className="serial-send-input"
          placeholder={connected ? '输入要发送的数据...' : '请先连接串口'}
          value={sendInput}
          onChange={(e) => setSendInput(e.target.value)}
          onKeyDown={handleSendKeyDown}
          disabled={!connected}
        />
        <button
          className={`toolbar-btn serial-send-btn ${(!connected || !sendInput.trim()) ? 'disabled' : ''}`}
          onClick={handleSend}
          disabled={!connected || !sendInput.trim()}
        >
          发送 ↵
        </button>
      </div>
    </div>
  )
}

export default SerialMonitor
