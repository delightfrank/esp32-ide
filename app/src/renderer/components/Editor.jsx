/**
 * ESP32 IDE - Monaco Editor 组件
 * 封装 Monaco Editor，配置 C/C++ 语法高亮和暗色主题
 */
import React, { useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import loader from '@monaco-editor/loader'
import * as monaco from 'monaco-editor'

// 强制使用本地 monaco 包，不走 CDN（国内离线可用）
loader.config({ monaco })

// Monaco worker 配置（Vite 构建需要）
window.MonacoEnvironment = {
  getWorker: function (_workerId, label) {
    const getWorkerModule = (moduleUrl) => {
      return new Worker(new URL(moduleUrl, import.meta.url), { type: 'module' })
    }
    switch (label) {
      case 'json':
        return getWorkerModule('monaco-editor/esm/vs/language/json/json.worker.js')
      case 'css':
      case 'scss':
      case 'less':
        return getWorkerModule('monaco-editor/esm/vs/language/css/css.worker.js')
      case 'html':
      case 'handlebars':
      case 'razor':
        return getWorkerModule('monaco-editor/esm/vs/language/html/html.worker.js')
      case 'typescript':
      case 'javascript':
        return getWorkerModule('monaco-editor/esm/vs/language/typescript/ts.worker.js')
      default:
        return getWorkerModule('monaco-editor/esm/vs/editor/editor.worker.js')
    }
  }
}

// Monaco Editor 配置
const editorOptions = {
  fontSize: 14,
  fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
  minimap: { enabled: true },
  lineNumbers: 'on',
  roundedSelection: true,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  bracketPairColorization: { enabled: true },
  guides: {
    bracketPairs: true,
    indentation: true
  },
  renderLineHighlight: 'all',
  cursorBlinking: 'smooth',
  cursorSmoothCaretAnimation: 'on',
  smoothScrolling: true,
  tabSize: 2
}

/**
 * Monaco Editor 组件
 * @param {string} value - 编辑器内容
 * @param {function} onChange - 内容变化回调
 * @param {object} editorRef - 编辑器引用
 */
function CodeEditor({ value, onChange, editorRef }) {
  const monacoRef = useRef(null)

  /**
   * 编辑器创建完成回调
   * 配置 C/C++ 语言的额外设置
   */
  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

    // P3: 先定义主题再应用，避免首次闪烁
    monaco.editor.defineTheme('esp32-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'keyword.control.directive', foreground: 'C586C0' },
        { token: 'keyword', foreground: '569CD6' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'entity.name.function', foreground: 'DCDCAA' },
        { token: 'variable', foreground: '9CDCFE' },
        { token: 'constant', foreground: '4FC1FF' }
      ],
      colors: {
        'editor.background': '#1e1e1e',
        'editor.foreground': '#d4d4d4',
        'editorLineNumber.foreground': '#858585',
        'editorLineNumber.activeForeground': '#c6c6c6',
        'editor.lineHighlightBackground': '#2a2d2e',
        'editor.selectionBackground': '#264f78',
        'editorCursor.foreground': '#aeafad',
        'editorIndentGuide.background': '#404040',
        'editorIndentGuide.activeBackground': '#707070',
        'editorBracketMatch.background': '#0064001a',
        'editorBracketMatch.border': '#888888'
      }
    })
    monaco.editor.setTheme('esp32-dark')

    // 配置 C/C++ 语言规则
    const cLangConfig = {
      comments: { lineComment: '//', blockComment: ['/*', '*/'] },
      brackets: [['{', '}'], ['[', ']'], ['(', ')']],
      autoClosingPairs: [
        { open: '{', close: '}' }, { open: '[', close: ']' },
        { open: '(', close: ')' }, { open: '"', close: '"' },
        { open: "'", close: "'" }, { open: '/*', close: '*/' }
      ],
      surroundingPairs: [
        { open: '{', close: '}' }, { open: '[', close: ']' },
        { open: '(', close: ')' }, { open: '"', close: '"' },
        { open: "'", close: "'" }
      ]
    }
    monaco.languages.setLanguageConfiguration('c', cLangConfig)
    monaco.languages.setLanguageConfiguration('cpp', cLangConfig)
  }

  /**
   * 内容变化处理
   */
  const handleChange = (value) => {
    onChange?.(value)
  }

  return (
    <div className="monaco-editor-wrapper">
      <Editor
        height="100%"
        language="cpp"
        value={value}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        options={editorOptions}
        theme="esp32-dark"
        loading={
          <div className="editor-loading">
            <span>正在加载编辑器...</span>
          </div>
        }
      />
    </div>
  )
}

export default CodeEditor
