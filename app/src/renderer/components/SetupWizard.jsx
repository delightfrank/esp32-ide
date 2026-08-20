/**
 * ESP32 IDE - 首次启动向导
 * 检测环境 → 选择下载源 → 安装工具链 → 完成
 */
import React, { useState, useEffect, useCallback } from 'react'

// ── 向导步骤常量 ──

const STEPS = {
  WELCOME: 'welcome',
  ENV_CHECK: 'env-check',
  MIRROR_SELECT: 'mirror-select',
  INSTALLING: 'installing',
  COMPLETE: 'complete'
}

const STEP_LABELS = {
  [STEPS.WELCOME]: '欢迎',
  [STEPS.ENV_CHECK]: '环境检测',
  [STEPS.MIRROR_SELECT]: '选择下载源',
  [STEPS.INSTALLING]: '安装中',
  [STEPS.COMPLETE]: '完成'
}

// ── 镜像选项 ──

const MIRROR_OPTIONS = [
  {
    id: 'tsinghua',
    name: '清华大学镜像',
    badge: '推荐',
    description: '国内速度最快，推荐国内用户使用',
    icon: '🏫'
  },
  {
    id: 'aliyun',
    name: '阿里云镜像',
    badge: '稳定',
    description: '阿里云提供的 PyPI 镜像，稳定可靠',
    icon: '☁️'
  },
  {
    id: 'github',
    name: 'GitHub 原始源',
    badge: '官方',
    description: '官方 PyPI 源，需要良好的国际网络',
    icon: '🌐'
  },
  {
    id: 'manual',
    name: '手动指定路径',
    badge: '跳过',
    description: '已有 Python/PlatformIO 的用户可跳过下载',
    icon: '🔧'
  }
]

// ── 主组件 ──

function SetupWizard({ onComplete, onClose }) {
  // 当前步骤
  const [step, setStep] = useState(STEPS.WELCOME)

  // 环境检测结果
  const [envResult, setEnvResult] = useState(null)

  // 选择的镜像
  const [selectedMirror, setSelectedMirror] = useState('tsinghua')

  // 安装进度
  const [installProgress, setInstallProgress] = useState({
    progress: 0,
    message: '',
    error: null
  })

  // 安装结果
  const [installResult, setInstallResult] = useState(null)

  // ── 环境检测 ──

  const doEnvCheck = useCallback(async () => {
    setStep(STEPS.ENV_CHECK)
    try {
      const result = await window.electronAPI?.setupCheckEnvironment()
      setEnvResult(result)

      // 如果环境已就绪，直接跳到完成页
      if (result?.ready) {
        setStep(STEPS.COMPLETE)
      } else {
        // 环境未就绪，进入镜像选择
        setTimeout(() => setStep(STEPS.MIRROR_SELECT), 1500)
      }
    } catch (err) {
      console.error('环境检测失败:', err)
      setStep(STEPS.MIRROR_SELECT)
    }
  }, [])

  // ── 开始安装 ──

  const startInstall = useCallback(async () => {
    setStep(STEPS.INSTALLING)
    setInstallProgress({ progress: 0, message: '准备安装...', error: null })

    // 监听进度更新
    const progressHandler = (data) => {
      setInstallProgress({
        progress: data.progress || 0,
        message: data.message || '',
        error: data.error || null
      })

      // 安装完成
      if (data.progress >= 100 && !data.running) {
        setInstallResult({ success: !data.error, environment: data.environment })
        setStep(STEPS.COMPLETE)
      }

      // 安装失败
      if (data.error && !data.running) {
        setInstallResult({ success: false, error: data.error })
      }
    }

    window.electronAPI?.onSetupProgress?.(progressHandler)

    // 触发安装
    try {
      const result = await window.electronAPI?.setupInstall?.(selectedMirror)
      if (result?.success) {
        setInstallResult({ success: true, environment: result.environment })
        setStep(STEPS.COMPLETE)
      } else {
        setInstallResult({ success: false, error: result?.error })
      }
    } catch (err) {
      setInstallResult({ success: false, error: err.message })
    }
  }, [selectedMirror])

  // ── 完成 ──

  const handleComplete = useCallback(() => {
    onComplete?.()
  }, [onComplete])

  // ── 渲染步骤进度条 ──

  const renderStepIndicator = () => {
    const steps = [STEPS.WELCOME, STEPS.ENV_CHECK, STEPS.MIRROR_SELECT, STEPS.INSTALLING, STEPS.COMPLETE]
    const currentIdx = steps.indexOf(step)

    return (
      <div className="wizard-steps">
        {steps.map((s, i) => (
          <div
            key={s}
            className={`wizard-step ${i <= currentIdx ? 'active' : ''} ${i < currentIdx ? 'completed' : ''}`}
          >
            <div className="wizard-step-dot">
              {i < currentIdx ? '✓' : i + 1}
            </div>
            <span className="wizard-step-label">{STEP_LABELS[s]}</span>
          </div>
        ))}
      </div>
    )
  }

  // ── 渲染欢迎页 ──

  const renderWelcome = () => (
    <div className="wizard-page wizard-welcome">
      <div className="wizard-hero">
        <div className="wizard-logo">⚡</div>
        <h1>欢迎使用 ESP32 IDE</h1>
        <p className="wizard-subtitle">
          专为 ESP32 新手打造的一体化开发环境
        </p>
      </div>

      <div className="wizard-features">
        <div className="wizard-feature">
          <span className="feature-icon">🔨</span>
          <div>
            <strong>一键编译</strong>
            <p>无需命令行，点击按钮即可编译</p>
          </div>
        </div>
        <div className="wizard-feature">
          <span className="feature-icon">⚡</span>
          <div>
            <strong>一键烧录</strong>
            <p>选择串口，一键烧录到开发板</p>
          </div>
        </div>
        <div className="wizard-feature">
          <span className="feature-icon">🔌</span>
          <div>
            <strong>串口监视器</strong>
            <p>实时查看串口输出</p>
          </div>
        </div>
        <div className="wizard-feature">
          <span className="feature-icon">📦</span>
          <div>
            <strong>项目模板</strong>
            <p>内置多个示例项目，快速上手</p>
          </div>
        </div>
      </div>

      <button className="wizard-btn wizard-btn-primary" onClick={doEnvCheck}>
        开始使用 →
      </button>
    </div>
  )

  // ── 渲染环境检测页 ──

  const renderEnvCheck = () => (
    <div className="wizard-page wizard-env-check">
      <h2>🔍 检测开发环境</h2>
      <p>正在检测您的系统环境...</p>

      <div className="env-check-list">
        <EnvCheckItem
          label="Python"
          available={envResult?.python?.available}
          version={envResult?.python?.version}
          loading={!envResult}
        />
        <EnvCheckItem
          label="PlatformIO"
          available={envResult?.platformio?.available}
          version={envResult?.platformio?.version}
          loading={!envResult}
        />
        {Object.entries(envResult?.toolchains || {}).map(([name, info]) => (
          <EnvCheckItem
            key={name}
            label={name.replace('toolchain-', '').replace('tool-', '')}
            available={info.available}
            loading={!envResult}
          />
        ))}
      </div>

      {envResult && !envResult.ready && (
        <p className="env-hint">
          ⚠️ 检测到部分环境缺失，接下来将为您自动安装
        </p>
      )}
    </div>
  )

  // ── 渲染镜像选择页 ──

  const renderMirrorSelect = () => (
    <div className="wizard-page wizard-mirror">
      <h2>📡 选择下载源</h2>
      <p>选择适合您网络环境的下载源（国内用户推荐选择清华镜像）</p>

      <div className="mirror-list">
        {MIRROR_OPTIONS.map((m) => (
          <div
            key={m.id}
            className={`mirror-card ${selectedMirror === m.id ? 'selected' : ''}`}
            onClick={() => setSelectedMirror(m.id)}
          >
            <div className="mirror-header">
              <span className="mirror-icon">{m.icon}</span>
              <span className="mirror-name">{m.name}</span>
              <span className="mirror-badge">{m.badge}</span>
            </div>
            <p className="mirror-desc">{m.description}</p>
          </div>
        ))}
      </div>

      <div className="wizard-actions">
        <button
          className="wizard-btn wizard-btn-primary"
          onClick={startInstall}
        >
          {selectedMirror === 'manual' ? '跳过安装' : '开始安装 →'}
        </button>
      </div>
    </div>
  )

  // ── 渲染安装进度页 ──

  const renderInstalling = () => (
    <div className="wizard-page wizard-installing">
      <h2>⏳ 正在安装...</h2>

      <div className="install-progress">
        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${installProgress.progress}%` }}
          />
        </div>
        <span className="progress-text">{installProgress.progress}%</span>
      </div>

      <p className="install-message">{installProgress.message}</p>

      {installProgress.error && (
        <div className="install-error">
          <p>Installation failed: {installProgress.error}</p>
          <div className="manual-install-guide">
            <h3>Manual Installation Guide</h3>
            <ol>
              <li><strong>Python 3.8+</strong>: Download from python.org/downloads</li>
              <li><strong>PlatformIO</strong>: Run <code>pip install platformio</code></li>
              <li><strong>ESP32 Toolchain</strong>: Auto-downloaded on first compile</li>
            </ol>
            <p>After manual install, restart ESP32 IDE.</p>
          </div>
          <button className="wizard-btn" onClick={() => setStep(STEPS.MIRROR_SELECT)}>Try Again</button>
        </div>
      )}

      {!installProgress.error && (
        <div className="install-tips">
      <div className="install-tips">
        <p>💡 安装过程中请保持网络连接</p>
        <p>⏱️ 首次安装可能需要几分钟</p>
      </div>
        </div>
      )}
    </div>
  )

  // ── 渲染完成页 ──

  const renderComplete = () => (
    <div className="wizard-page wizard-complete">
      <div className="wizard-hero">
        <div className="wizard-logo success">✓</div>
        <h2>🎉 环境准备就绪！</h2>
      </div>

      {installResult?.success === false && (
        <div className="complete-warning">
          <p>⚠️ 部分组件安装失败，您可能需要手动安装</p>
          <p className="error-detail">{installResult.error}</p>
        </div>
      )}

      <div className="complete-summary">
        <h3>已安装的组件</h3>
        <ul>
          <li>
            <span className="status-icon">
              {envResult?.python?.available ? '✅' : '❌'}
            </span>
            Python {envResult?.python?.version || '未安装'}
          </li>
          <li>
            <span className="status-icon">
              {envResult?.platformio?.available ? '✅' : '❌'}
            </span>
            PlatformIO {envResult?.platformio?.version || '未安装'}
          </li>
          {Object.entries(envResult?.toolchains || {}).map(([name, info]) => (
            <li key={name}>
              <span className="status-icon">
                {info.available ? '✅' : '❌'}
              </span>
              {name.replace('toolchain-', '').replace('tool-', '')}
            </li>
          ))}
        </ul>
      </div>

      <button className="wizard-btn wizard-btn-primary" onClick={handleComplete}>
        开始编程 →
      </button>
    </div>
  )

  // ── 主渲染 ──

  return (
    <div className="setup-wizard-overlay">
      <div className="setup-wizard">
        {/* 关闭按钮 */}
        <button className="wizard-close" onClick={onClose} title="关闭向导">
          ✕
        </button>

        {/* 步骤指示器 */}
        {renderStepIndicator()}

        {/* 步骤内容 */}
        <div className="wizard-content">
          {step === STEPS.WELCOME && renderWelcome()}
          {step === STEPS.ENV_CHECK && renderEnvCheck()}
          {step === STEPS.MIRROR_SELECT && renderMirrorSelect()}
          {step === STEPS.INSTALLING && renderInstalling()}
          {step === STEPS.COMPLETE && renderComplete()}
        </div>
      </div>
    </div>
  )
}

// ── 环境检测项子组件 ──

function EnvCheckItem({ label, available, version, loading }) {
  return (
    <div className={`env-item ${loading ? 'loading' : available ? 'ok' : 'missing'}`}>
      <span className="env-icon">
        {loading ? '⏳' : available ? '✅' : '❌'}
      </span>
      <span className="env-label">{label}</span>
      {version && <span className="env-version">{version}</span>}
      {!loading && !available && (
        <span className="env-status missing-text">未安装</span>
      )}
    </div>
  )
}

export default SetupWizard
