/**
 * ESP32 IDE - 根组件
 * Phase 3: 新增串口管理、烧录功能、项目模板
 */
import React, { useState, useCallback, useRef, useEffect } from 'react'
import Editor from './components/Editor'
import ConsolePanel from './components/ConsolePanel'
import SerialMonitor from './components/SerialMonitor'
import FileTree from './components/FileTree'
import SetupWizard from './components/SetupWizard'

// ═══════════════════════════════════════════════════
// 常量
// ═══════════════════════════════════════════════════

const STATUS = {
  IDLE: 'idle',
  BUILDING: 'building',
  UPLOADING: 'uploading',
  SUCCESS: 'success',
  ERROR: 'error'
}

// Bug 3: 输出日志最大行数，超出自动截断
const MAX_OUTPUT_LINES = 5000

const STATUS_LABELS = {
  [STATUS.IDLE]: '空闲',
  [STATUS.BUILDING]: '编译中...',
  [STATUS.UPLOADING]: '烧录中...',
  [STATUS.SUCCESS]: '✓ 操作成功',
  [STATUS.ERROR]: '✗ 操作失败'
}

const STATUS_CLASSES = {
  [STATUS.IDLE]: 'status-idle',
  [STATUS.BUILDING]: 'status-building',
  [STATUS.UPLOADING]: 'status-uploading',
  [STATUS.SUCCESS]: 'status-success',
  [STATUS.ERROR]: 'status-error'
}

// ═══════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════

function App() {
  // 编辑器状态
  const [code, setCode] = useState(
    '// 欢迎使用 ESP32 IDE\n// 在这里编写你的 ESP32 代码\n\n#include <Arduino.h>\n\nvoid setup() {\n  Serial.begin(115200);\n  Serial.println("Hello, ESP32!");\n}\n\nvoid loop() {\n  // 主循环\n}\n'
  )
  const [isModified, setIsModified] = useState(false)
  const editorRef = useRef(null)

  // 项目状态
  const [projectPath, setProjectPath] = useState(null)

  // 启动时加载上次的项目路径
  useEffect(() => {
    window.electronAPI?.getProjectPath().then((p) => {
      if (p) {
        setProjectPath(p)
        projectPathRef.current = p
      }
    })
  }, [])


  const [chipType, setChipType] = useState('esp32-s3')
  const [activeFilePath, setActiveFilePath] = useState(null)
  const [activeFileContent, setActiveFileContent] = useState(null)

  // 编译/烧录状态
  const [buildStatus, setBuildStatus] = useState(STATUS.IDLE)
  const [statusMessage, setStatusMessage] = useState('')
  const [outputLines, setOutputLines] = useState([])
  const [showConsole, setShowConsole] = useState(true)

  // 底部面板 tab
  const [bottomTab, setBottomTab] = useState('console') // 'console' | 'serial'

  // 串口监视器状态
  const [serialMonitorConnected, setSerialMonitorConnected] = useState(false)

  // 串口状态
  const [serialPorts, setSerialPorts] = useState([])
  const [selectedPort, setSelectedPort] = useState('')
  const [serialRefreshing, setSerialRefreshing] = useState(false)

  // Bug 1: 自动保存状态
  const autoSaveTimerRef = useRef(null)
  const codeRef = useRef(code)
  codeRef.current = code

  // Bug 5: 用 ref 保存最新 projectPath，避免 handleBuild/handleUpload 闭包捕获陈旧值
  const projectPathRef = useRef(projectPath)
  projectPathRef.current = projectPath

  // Bug 2: 崩溃恢复弹窗
  const [showRecoverDialog, setShowRecoverDialog] = useState(false)
  const [recoverContent, setRecoverContent] = useState(null)

  // 首次启动向导状态
  const [showSetupWizard, setShowSetupWizard] = useState(false)

  // 新建项目弹窗
  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false)
  const [templates, setTemplates] = useState([])
  const [newProjectName, setNewProjectName] = useState('')
  const [newProjectDir, setNewProjectDir] = useState('')
  const [newProjectTemplate, setNewProjectTemplate] = useState('blink')

  // ═══════════════════════════════════════════════
  // 编辑器操作
  // ═══════════════════════════════════════════════

  const handleContentChange = useCallback((value) => {
    setCode(value)
    setIsModified(true)
    window.electronAPI?.reportModified(true)
  }, [])

  const handleNewFile = useCallback(() => {
    setCode('// 新文件 - 在此编写代码\n')
    setActiveFilePath(null)
    setActiveFileContent(null)
    setIsModified(false)
    window.electronAPI?.reportModified(false)
    setBuildStatus(STATUS.IDLE)
    setStatusMessage('已创建新文件')
  }, [])

  const handleFileOpened = useCallback((data) => {
    setCode(data.content)
    setIsModified(false)
    window.electronAPI?.reportModified(false)
  }, [])

  // 从文件树打开文件
  const handleFileOpenFromTree = useCallback(async (filePath, content) => {
    if (filePath === null) {
      // 清空编辑器（文件被删除）
      setCode('')
      setActiveFilePath(null)
      setActiveFileContent(null)
      setIsModified(false)
      window.electronAPI?.reportModified(false)
      return
    }

    // Bug 4: 如果切换到不同文件，先检查是否需要保存当前文件
    if (activeFilePath && activeFilePath !== filePath && isModified) {
      const result = await window.electronAPI?.saveFile()
      if (!result?.success) {
        // Bug 4: 保存失败，不切换文件
        return
      }
    }

    // 如果 content 为 null，表示只是路径变更（重命名等），不重新加载内容
    if (content !== null && content !== undefined) {
      setCode(content)
      setActiveFileContent(content)
    }
    setActiveFilePath(filePath)
    setIsModified(false)
    window.electronAPI?.reportModified(false)
  }, [activeFilePath, isModified])

  // Bug 1: 手动触发自动保存
  const triggerAutoSave = useCallback(async () => {
    try {
      await window.electronAPI?.autoSave({ content: codeRef.current })
    } catch (e) {
      // 静默失败
    }
  }, [])

  // Bug 1: 手动触发请求主进程获取编辑器内容并自动保存
  const triggerAutoSaveViaMain = useCallback(async () => {
    try {
      window.electronAPI?.requestAutoSave()
    } catch (e) {
      // 静默失败
    }
  }, [])

  // Bug 1: 自动保存定时器
  useEffect(() => {
    autoSaveTimerRef.current = setInterval(() => {
      triggerAutoSaveViaMain()
    }, 30000) // 每 30 秒
    return () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current)
      }
    }
  }, [triggerAutoSaveViaMain])

  // 退出时清理自动保存定时器
  useEffect(() => {
    const handler = () => {
      if (autoSaveTimerRef.current) {
        clearInterval(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
    }
    window.electronAPI?.onAppQuit?.(handler)
    return () => {
      window.electronAPI?.removeAppQuitListener?.(handler)
    }
  }, [])

  // Bug 2: 监听崩溃恢复通知
  useEffect(() => {
    window.electronAPI?.onRecoverAvailable((data) => {
      if (data?.content) {
        setRecoverContent(data.content)
        setShowRecoverDialog(true)
      }
    })
  }, [])

  // 监听主进程发送的首次启动向导事件
  useEffect(() => {
    const handler = (event, env) => {
      if (env && !env.ready) {
        setShowSetupWizard(true)
      }
    }
    // 通过 window.electronAPI 监听（preload 中需要暴露）
    // 这里通过 main 直接发送的事件来触发
    if (window.electronAPI?.onShowSetupWizard) {
      window.electronAPI.onShowSetupWizard(handler)
    }
  }, [])

  // 向导完成后重新检测环境
  const handleSetupComplete = useCallback(async () => {
    setShowSetupWizard(false)
    // 重新检测环境
    try {
      const env = await window.electronAPI?.setupCheckEnvironment()
      if (env?.ready) {
        appendOutput('✅ 开发环境就绪！')
      }
    } catch (e) { /* 忽略 */ }
  }, [appendOutput])

  // 关闭向导
  const handleSetupClose = useCallback(() => {
    setShowSetupWizard(false)
  }, [])

  // Bug 2: 用户选择恢复
  const handleRecover = useCallback(() => {
    if (recoverContent) {
      setCode(recoverContent)
      setIsModified(false)
      window.electronAPI?.reportModified(false)
    }
    // 恢复后删除 .autosave 文件
    window.electronAPI?.recoverResponse('recover')
    setShowRecoverDialog(false)
    setRecoverContent(null)
  }, [recoverContent])

  // Bug 2: 用户选择忽略
  const handleIgnoreRecover = useCallback(() => {
    window.electronAPI?.recoverResponse('ignore')
    setShowRecoverDialog(false)
    setRecoverContent(null)
  }, [])

  // 编辑器保存文件后通知文件树刷新
  const handleSaveAndNotify = useCallback(async () => {
    const result = await window.electronAPI?.saveFile()
    if (result?.success) {
      window.electronAPI?.fileSaveNotify?.()
    }
    return result
  }, [])

  // ═══════════════════════════════════════════════
  // 串口管理
  // ═══════════════════════════════════════════════

  const refreshSerialPorts = useCallback(async () => {
    setSerialRefreshing(true)
    try {
      const result = await window.electronAPI?.serialRefresh()
      if (result?.success) {
        setSerialPorts(result.ports)
        // 如果当前选中的端口不在列表中，清除选择
        if (selectedPort && !result.ports.find(p => p.path === selectedPort)) {
          setSelectedPort('')
        }
      }
    } catch (err) {
      console.error('串口刷新失败:', err)
    } finally {
      setSerialRefreshing(false)
    }
  }, [selectedPort])

  // 初始扫描串口
  useEffect(() => {
    refreshSerialPorts()
  }, [])

  // ═══════════════════════════════════════════════
  // 项目管理
  // ═══════════════════════════════════════════════

  const handleSelectProject = useCallback(async () => {
    const result = await window.electronAPI?.selectProjectFolder()
    if (result?.success) {
      setProjectPath(result.path)
      projectPathRef.current = result.path
      const iniResult = await window.electronAPI?.generatePioIni(result.path, chipType)
      if (iniResult?.success) {
        appendOutput(`✓ 已生成 platformio.ini (${chipType})`)
        if (iniResult.overwritten) {
          appendOutput('  (覆盖了已有的 platformio.ini)')
        }
      } else if (iniResult?.canceled) {
        appendOutput('  已取消覆盖 platformio.ini')
      }
    }
  }, [chipType, appendOutput])

  // ═══════════════════════════════════════════════
  // 新建项目
  // ═══════════════════════════════════════════════

  const handleNewProject = useCallback(async () => {
    // 获取模板列表
    const tplList = await window.electronAPI?.getTemplateList()
    setTemplates(tplList || [])
    setNewProjectName('')
    setNewProjectDir('')
    setNewProjectTemplate('blink')
    setShowNewProjectDialog(true)
  }, [])

  const handleSelectNewProjectDir = useCallback(async () => {
    const result = await window.electronAPI?.selectDirectory()
    if (result?.success) {
      setNewProjectDir(result.path)
    }
  }, [])

  const handleCreateProject = useCallback(async () => {
    if (!newProjectDir || !newProjectName) return

    const result = await window.electronAPI?.createProject(
      newProjectDir,
      newProjectName,
      newProjectTemplate,
      chipType
    )

    if (result?.success) {
      setProjectPath(result.projectPath)
      projectPathRef.current = result.projectPath
      setShowNewProjectDialog(false)
      appendOutput(`✓ 项目已创建: ${result.projectPath}`)
      appendOutput(`  模板: ${result.template} | 芯片: ${chipType}`)

      // 自动加载 main.cpp 到编辑器
      try {
        const mainCppPath = result.projectPath + '/src/main.cpp'
        const fileResult = await window.electronAPI?.fileRead(mainCppPath)
        if (fileResult?.success) {
          setCode(fileResult.content)
          setActiveFilePath(mainCppPath)
          setIsModified(false)
          window.electronAPI?.reportModified(false)
          appendOutput(`  ✓ 已加载 ${mainCppPath}`)
        }
      } catch (e) {
        // 忽略
      }
    } else {
      appendOutput(`✗ 创建项目失败: ${result?.error}`)
    }
  }, [newProjectDir, newProjectName, newProjectTemplate, chipType])

  // ═══════════════════════════════════════════════
  // 编译操作
  // ═══════════════════════════════════════════════

  const appendOutput = useCallback((text) => {
    setOutputLines(prev => {
      const next = [...prev, text]
      // Bug 3: 截断到最大行数，避免大项目编译内存爆
      return next.length > MAX_OUTPUT_LINES ? next.slice(-MAX_OUTPUT_LINES) : next
    })
  }, [])

  const clearOutput = useCallback(() => {
    setOutputLines([])
  }, [])

  const handleBuild = useCallback(async () => {
    const currentProjectPath = projectPathRef.current
    if (!currentProjectPath) {
      await handleSelectProject()
      if (!projectPathRef.current) return
    }

    // Bug 1: 编译前自动保存
    triggerAutoSaveViaMain()

    setBuildStatus(STATUS.BUILDING)
    setStatusMessage('编译中...')
    setOutputLines([])
    setShowConsole(true)
    appendOutput(`🔨 开始编译... (芯片: ${chipType})`)
    appendOutput(`📁 项目路径: ${projectPathRef.current}`)
    appendOutput('─'.repeat(50))

    try {
      const result = await window.electronAPI?.pioBuild(projectPathRef.current)
      if (result?.success) {
        setBuildStatus(STATUS.SUCCESS)
        setStatusMessage('✓ 编译成功')
        appendOutput('─'.repeat(50))
        appendOutput('✓ 编译成功！')
      } else {
        setBuildStatus(STATUS.ERROR)
        setStatusMessage('✗ 编译失败')
        appendOutput('─'.repeat(50))
        appendOutput(`✗ 编译失败 (退出码: ${result?.code})`)
      }
    } catch (err) {
      setBuildStatus(STATUS.ERROR)
      setStatusMessage('✗ 编译错误')
      appendOutput(`✗ 编译错误: ${err.message}`)
    }
  }, [chipType, handleSelectProject, appendOutput, triggerAutoSaveViaMain])

  const handleClean = useCallback(async () => {
    const currentProjectPath = projectPathRef.current
    if (!currentProjectPath) return

    setBuildStatus(STATUS.BUILDING)
    setStatusMessage('清理中...')
    setOutputLines([])
    setShowConsole(true)
    appendOutput('🗑️ 清理构建产物...')

    try {
      const result = await window.electronAPI?.pioClean(currentProjectPath)
      if (result?.success) {
        setBuildStatus(STATUS.IDLE)
        setStatusMessage('')
        appendOutput('✓ 清理完成')
      } else {
        setBuildStatus(STATUS.ERROR)
        setStatusMessage('✗ 清理失败')
        appendOutput(`✗ 清理失败 (退出码: ${result?.code})`)
      }
    } catch (err) {
      setBuildStatus(STATUS.ERROR)
      setStatusMessage('✗ 清理错误')
      appendOutput(`✗ 清理错误: ${err.message}`)
    }
  }, [appendOutput])

  // ═══════════════════════════════════════════════
  // 烧录操作
  // ═══════════════════════════════════════════════

  const handleUpload = useCallback(async () => {
    // 检查项目路径
    const currentProjectPath = projectPathRef.current
    if (!currentProjectPath) {
      await handleSelectProject()
      if (!projectPathRef.current) return
    }

    // Bug 1: 烧录前自动保存
    triggerAutoSaveViaMain()

    // 检查串口
    if (!selectedPort) {
      setBuildStatus(STATUS.ERROR)
      setStatusMessage('✗ 未选择串口')
      appendOutput('')
      appendOutput('✗ 请先选择串口设备')
      appendOutput('  点击工具栏的串口下拉菜单选择端口')
      return
    }

    // 检查串口是否可用
    setOutputLines([])
    setShowConsole(true)
    setBottomTab('console')
    appendOutput('🔌 检查串口状态...')

    const portCheck = await window.electronAPI?.serialCheck(selectedPort)
    if (!portCheck?.available) {
      setBuildStatus(STATUS.ERROR)
      setStatusMessage('✗ 串口不可用')
      appendOutput(`✗ ${portCheck?.error || '串口不可用'}`)
      appendOutput(`  端口: ${selectedPort}`)
      return
    }

    // 烧录前：如果串口监视器已连接，自动断开
    if (serialMonitorConnected) {
      appendOutput('🔌 烧录前断开串口监视器...')
      await window.electronAPI?.serialMonitorPreUpload()
    }

    // 开始烧录
    setBuildStatus(STATUS.UPLOADING)
    setStatusMessage('烧录中...')
    appendOutput('')
    appendOutput(`⚡ 开始烧录... (芯片: ${chipType})`)
    appendOutput(`📁 项目路径: ${projectPathRef.current}`)
    appendOutput(`🔌 串口: ${selectedPort}`)
    appendOutput('─'.repeat(50))

    try {
      const result = await window.electronAPI?.pioUpload(projectPathRef.current, selectedPort)
      if (result?.success) {
        setBuildStatus(STATUS.SUCCESS)
        setStatusMessage('✓ 烧录成功')
        appendOutput('─'.repeat(50))
        appendOutput('✓ 烧录成功！')
        appendOutput('  开发板应已开始运行新程序')
      } else {
        setBuildStatus(STATUS.ERROR)
        setStatusMessage('✗ 烧录失败')
        appendOutput('─'.repeat(50))
        appendOutput(`✗ 烧录失败 (退出码: ${result?.code})`)
        if (result?.stderr) {
          appendOutput(result.stderr.slice(0, 500))
        }
      }
    } catch (err) {
      setBuildStatus(STATUS.ERROR)
      setStatusMessage('✗ 烧录错误')
      appendOutput(`✗ 烧录错误: ${err.message}`)
    }

    // 烧录后：如果之前串口监视器是连接状态，自动重连
    if (serialMonitorConnected) {
      appendOutput('🔌 烧录后自动重连串口监视器...')
      await window.electronAPI?.serialMonitorPostUpload()
    }
  }, [selectedPort, chipType, serialMonitorConnected, handleSelectProject, appendOutput, triggerAutoSaveViaMain])

  // ═══════════════════════════════════════════════
  // 错误跳转
  // ═══════════════════════════════════════════════

  const handleJumpToError = useCallback((errorInfo) => {
    window.electronAPI?.gotoError(errorInfo)
  }, [])

  // ═══════════════════════════════════════════════
  // IPC 监听
  // ═══════════════════════════════════════════════

  useEffect(() => {
    window.electronAPI?.onNewFile(handleNewFile)
    window.electronAPI?.onFileOpened(handleFileOpened)

    window.electronAPI?.onGetEditorContent(() => {
      window.electronAPI?.sendEditorContent(code)
    })

    // PlatformIO 实时输出
    window.electronAPI?.onPioOutput((data) => {
      if (data.type === 'stdout' || data.type === 'stderr') {
        const lines = data.data.split('\n').filter(l => l.trim())
        setOutputLines(prev => {
          const next = [...prev, ...lines]
          // Bug 3: 截断到最大行数
          return next.length > MAX_OUTPUT_LINES ? next.slice(-MAX_OUTPUT_LINES) : next
        })
      }
      // 编译开始时自动切换到编译输出 tab
      if (data.type === 'start') {
        setBottomTab('console')
      }
    })

    // PlatformIO 状态变化
    window.electronAPI?.onPioStatus((data) => {
      if (data.status === 'building') {
        setBuildStatus(STATUS.BUILDING)
        setStatusMessage('编译中...')
      } else if (data.status === 'success') {
        setBuildStatus(STATUS.SUCCESS)
        setStatusMessage('✓ 操作成功')
      } else if (data.status === 'error') {
        setBuildStatus(STATUS.ERROR)
        setStatusMessage('✗ 操作失败')
      }
    })

    // 错误跳转
    window.electronAPI?.onGotoError((errorInfo) => {
      if (editorRef.current) {
        editorRef.current.revealLineInCenter(errorInfo.line)
        editorRef.current.setPosition({ lineNumber: errorInfo.line, column: errorInfo.column || 1 })
        editorRef.current.focus()
      }
    })
  }, [code, handleNewFile, handleFileOpened])

  // ═══════════════════════════════════════════════
  // 渲染
  // ═══════════════════════════════════════════════

  const isBusy = buildStatus === STATUS.BUILDING || buildStatus === STATUS.UPLOADING

  return (
    <div className="app-container">
      {/* 工具栏 */}
      <div className="toolbar">
        <span className="toolbar-title">ESP32 IDE</span>
        <div className="toolbar-actions">
          {/* 新建文件 */}
          <button
            className="toolbar-btn"
            onClick={handleNewFile}
            title="新建文件 (Ctrl+N)"
          >
            📝 新建文件
          </button>

          {/* 新建项目 */}
          <button
            className="toolbar-btn"
            onClick={handleNewProject}
            title="新建项目"
          >
            📁 新建项目
          </button>

          {/* 项目选择 */}
          <button
            className="toolbar-btn"
            onClick={handleSelectProject}
            title="选择项目文件夹"
          >
            📁 项目
          </button>

          {/* 芯片选择 */}
          <select
            className="toolbar-select"
            value={chipType}
            onChange={(e) => setChipType(e.target.value)}
            title="选择芯片"
          >
            <option value="esp32-s3">ESP32-S3</option>
            <option value="esp32">ESP32</option>
            <option value="esp32-c3">ESP32-C3</option>
          </select>

          <div className="toolbar-separator" />

          {/* 串口选择 */}
          <select
            className="toolbar-select serial-select"
            value={selectedPort}
            onChange={(e) => setSelectedPort(e.target.value)}
            title="选择串口设备"
          >
            <option value="">-- 选择串口 --</option>
            {serialPorts.length === 0 && (
              <option value="" disabled>未检测到设备</option>
            )}
            {serialPorts.map((port) => (
              <option key={port.path} value={port.path}>
                {port.path} ({port.manufacturer})
              </option>
            ))}
          </select>

          {/* 串口刷新按钮 */}
          <button
            className={`toolbar-btn ${serialRefreshing ? 'disabled' : ''}`}
            onClick={refreshSerialPorts}
            disabled={serialRefreshing}
            title="刷新串口列表"
          >
            {serialRefreshing ? '⏳' : '🔄'}
          </button>

          <div className="toolbar-separator" />

          {/* 编译按钮 */}
          <button
            className={`toolbar-btn build-btn ${isBusy ? 'disabled' : ''}`}
            onClick={handleBuild}
            disabled={isBusy}
            title={isBusy ? '任务进行中...' : '编译项目'}
          >
            {buildStatus === STATUS.BUILDING ? '⏳ 编译中...' : '🔨 编译'}
          </button>

          {/* 烧录按钮 */}
          <button
            className={`toolbar-btn upload-btn ${isBusy ? 'disabled' : ''}`}
            onClick={handleUpload}
            disabled={isBusy}
            title={isBusy ? '任务进行中...' : '烧录到开发板'}
          >
            {buildStatus === STATUS.UPLOADING ? '⏳ 烧录中...' : '⚡ 烧录'}
          </button>

          {/* 清理按钮 */}
          <button
            className={`toolbar-btn clean-btn ${isBusy ? 'disabled' : ''}`}
            onClick={handleClean}
            disabled={isBusy}
            title={isBusy ? '任务进行中...' : '清理构建产物'}
          >
            🗑️ 清理
          </button>

          <div className="toolbar-separator" />

          {/* 串口监视器状态指示 */}
          {serialMonitorConnected && (
            <span className="serial-monitor-indicator" title="串口监视器已连接">
              🔌 监视器
            </span>
          )}

          {/* 保存按钮 */}
          <button
            className="toolbar-btn"
            onClick={handleSaveAndNotify}
            title="保存 (Ctrl+S)"
          >
            💾 保存
          </button>

          {/* 刷新文件树按钮 */}
          <button
            className="toolbar-btn"
            onClick={() => {
              // 触发文件树刷新 — 通过设置一个刷新标记
              window.dispatchEvent(new CustomEvent('filetree-refresh'))
            }}
            title="刷新文件树"
          >
            🔄
          </button>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="main-content">
        {/* 左侧文件树 */}
        <FileTree
          projectPath={projectPath}
          onFileOpen={handleFileOpenFromTree}
          activeFilePath={activeFilePath}
        />

        {/* 右侧区域：编辑器 + 底部面板 */}
        <div className="editor-console-wrapper">
          <div className="editor-area">
            <Editor
              value={code}
              onChange={handleContentChange}
              editorRef={editorRef}
            />
          </div>

          {showConsole && (
            <div className="console-area">
            {/* Tab 栏 */}
            <div className="bottom-tabs">
              <button
                className={`bottom-tab ${bottomTab === 'console' ? 'active' : ''}`}
                onClick={() => setBottomTab('console')}
              >
                📋 编译输出
              </button>
              <button
                className={`bottom-tab ${bottomTab === 'serial' ? 'active' : ''}`}
                onClick={() => setBottomTab('serial')}
              >
                🔌 串口监视器
                {serialMonitorConnected && <span className="tab-dot connected" />}
              </button>
            </div>

            {/* Tab 内容 */}
            <div className="bottom-tab-content">
              {bottomTab === 'console' && (
                <ConsolePanel
                  outputLines={outputLines}
                  onClear={clearOutput}
                  onJumpToError={handleJumpToError}
                />
              )}
              {bottomTab === 'serial' && (
                <SerialMonitor
                  serialPorts={serialPorts}
                  selectedPort={selectedPort}
                  onStatusChange={setSerialMonitorConnected}
                />
              )}
            </div>
          </div>
        )}
        </div>
      </div>

      {/* 状态栏 */}
      <div className="status-bar">
        <span className={STATUS_CLASSES[buildStatus]}>
          {statusMessage || STATUS_LABELS[buildStatus]}
        </span>
        <span>{isModified ? '● 已修改' : '○ 未修改'}</span>
        <span>{chipType.toUpperCase()}</span>
        {selectedPort && <span>🔌 {selectedPort}</span>}
        {projectPath && <span>📁 {projectPath}</span>}
        {serialMonitorConnected && <span className="serial-indicator">🔌 串口监视器已连接</span>}
        <span>UTF-8</span>
      </div>

      {/* ═══ 首次启动向导 ═══ */}
      {showSetupWizard && (
        <SetupWizard
          onComplete={handleSetupComplete}
          onClose={handleSetupClose}
        />
      )}

      {/* ═══ Bug 2: 崩溃恢复弹窗 ═══ */}
      {showRecoverDialog && (
        <div className="modal-overlay" onClick={handleIgnoreRecover}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>🔄 发现未保存的恢复文件</h3>
            </div>
            <div className="modal-body">
              <p>发现未保存的恢复文件，是否恢复上次编辑的内容？</p>
            </div>
            <div className="modal-footer">
              <button className="toolbar-btn" onClick={handleIgnoreRecover}>
                忽略
              </button>
              <button className="toolbar-btn build-btn" onClick={handleRecover}>
                恢复
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ 新建项目弹窗 ═══ */}
      {showNewProjectDialog && (
        <div className="modal-overlay" onClick={() => setShowNewProjectDialog(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>📄 新建项目</h3>
              <button
                className="modal-close"
                onClick={() => setShowNewProjectDialog(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {/* 项目名称 */}
              <div className="form-group">
                <label>项目名称</label>
                <input
                  type="text"
                  className="form-input"
                  placeholder="my-esp32-project"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                />
              </div>

              {/* 项目目录 */}
              <div className="form-group">
                <label>项目目录</label>
                <div className="form-row">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="选择目录..."
                    value={newProjectDir}
                    readOnly
                  />
                  <button className="toolbar-btn" onClick={handleSelectNewProjectDir}>
                    📁 浏览
                  </button>
                </div>
              </div>

              {/* 模板选择 */}
              <div className="form-group">
                <label>选择模板</label>
                <div className="template-list">
                  {templates.map((tpl) => (
                    <div
                      key={tpl.id}
                      className={`template-card ${newProjectTemplate === tpl.id ? 'selected' : ''}`}
                      onClick={() => setNewProjectTemplate(tpl.id)}
                    >
                      <span className="template-icon">{tpl.icon}</span>
                      <div className="template-info">
                        <div className="template-name">{tpl.name}</div>
                        <div className="template-desc">{tpl.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 芯片选择 */}
              <div className="form-group">
                <label>芯片类型</label>
                <select
                  className="form-input"
                  value={chipType}
                  onChange={(e) => setChipType(e.target.value)}
                >
                  <option value="esp32-s3">ESP32-S3</option>
                  <option value="esp32">ESP32</option>
                  <option value="esp32-c3">ESP32-C3</option>
                </select>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="toolbar-btn"
                onClick={() => setShowNewProjectDialog(false)}
              >
                取消
              </button>
              <button
                className={`toolbar-btn build-btn ${(!newProjectName || !newProjectDir) ? 'disabled' : ''}`}
                onClick={handleCreateProject}
                disabled={!newProjectName || !newProjectDir}
              >
                创建项目
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
