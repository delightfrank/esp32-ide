/**
 * ESP32 IDE - 编译输出面板组件
 * 显示 PlatformIO 编译日志，支持自动滚动和手动暂停
 */
import React, { useEffect, useRef, useState } from 'react'

function ConsolePanel({ outputLines, onClear, onJumpToError }) {
  const consoleRef = useRef(null)
  const [autoScroll, setAutoScroll] = useState(true)
  const [isPaused, setIsPaused] = useState(false)

  // 自动滚动到底部
  useEffect(() => {
    if (autoScroll && consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight
    }
  }, [outputLines, autoScroll])

  // 用户手动滚动时暂停自动滚动
  const handleScroll = () => {
    if (!consoleRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = consoleRef.current
    // 如果不在底部（差值 > 20px），暂停自动滚动
    const atBottom = scrollHeight - scrollTop - clientHeight < 20
    if (!atBottom && autoScroll) {
      setAutoScroll(false)
    } else if (atBottom && !autoScroll) {
      setAutoScroll(true)
    }
  }

  // 检测错误行并渲染为可点击链接
  const renderLine = (line, index) => {
    // 匹配 PlatformIO 编译错误格式
    const errorMatch = line.match(/^(.+?):(\d+):(\d+):\s*(?:fatal\s+)?error:\s*(.+)$/)
    const warningMatch = line.match(/^(.+?):(\d+):(\d+):\s*warning:\s*(.+)$/)

    if (errorMatch) {
      const [, file, lineNum, col, message] = errorMatch
      return (
        <div
          key={index}
          className="console-line console-error clickable"
          onClick={() => onJumpToError?.({ file, line: parseInt(lineNum), column: parseInt(col), message })}
          title={`点击跳转到 ${file}:${lineNum}:${col}`}
        >
          <span className="error-icon">❌</span>
          <span className="error-text">{line}</span>
        </div>
      )
    }

    if (warningMatch) {
      return (
        <div key={index} className="console-line console-warning">
          <span className="warning-icon">⚠️</span>
          <span>{line}</span>
        </div>
      )
    }

    // 普通行
    const isSuccess = line.includes('SUCCESS') || line.includes('完成')
    const isError = line.includes('FAILED') || line.includes('ERROR')
    let className = 'console-line'
    if (isSuccess) className += ' console-success'
    if (isError) className += ' console-error-text'

    return (
      <div key={index} className={className}>
        {line}
      </div>
    )
  }

  return (
    <div className="console-panel">
      <div className="console-header">
        <span className="console-title">📋 编译输出</span>
        <div className="console-actions">
          <button
            className={`console-btn ${autoScroll ? 'active' : ''}`}
            onClick={() => setAutoScroll(!autoScroll)}
            title={autoScroll ? '自动滚动已开启' : '自动滚动已关闭'}
          >
            {autoScroll ? '📜 自动滚动' : '📜 暂停滚动'}
          </button>
          <button className="console-btn" onClick={onClear} title="清空输出">
            🗑️ 清空
          </button>
        </div>
      </div>
      <div
        className="console-body"
        ref={consoleRef}
        onScroll={handleScroll}
      >
        {outputLines.length === 0 ? (
          <div className="console-empty">
            等待编译输出...
          </div>
        ) : (
          outputLines.map((line, i) => renderLine(line, i))
        )}
      </div>
    </div>
  )
}

export default ConsolePanel
