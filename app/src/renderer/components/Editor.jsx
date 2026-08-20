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

    // 配置 C/C++ 语言的括号匹配规则
    monaco.languages.setLanguageConfiguration('c', {
      comments: {
        lineComment: '//',
        blockComment: ['/*', '*/']
      },
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')']
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '/*', close: '*/' }
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" }
      ]
    })

    // C++ 也配置相同规则
    monaco.languages.setLanguageConfiguration('cpp', {
      comments: {
        lineComment: '//',
        blockComment: ['/*', '*/']
      },
      brackets: [
        ['{', '}'],
        ['[', ']'],
        ['(', ')']
      ],
      autoClosingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" },
        { open: '/*', close: '*/' }
      ],
      surroundingPairs: [
        { open: '{', close: '}' },
        { open: '[', close: ']' },
        { open: '(', close: ')' },
        { open: '"', close: '"' },
        { open: "'", close: "'" }
      ]
    })

    // 增强 C/C++ 语法高亮 - 自定义 token 颜色
    monaco.editor.defineTheme('esp32-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        // 预处理指令 #include, #define 等
        { token: 'keyword.control.directive', foreground: 'C586C0' },
        // C/C++ 关键字
        { token: 'keyword', foreground: '569CD6' },
        // 类型名
        { token: 'type', foreground: '4EC9B0' },
        // 字符串
        { token: 'string', foreground: 'CE9178' },
        // 数字
        { token: 'number', foreground: 'B5CEA8' },
        // 注释
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        // 函数名
        { token: 'entity.name.function', foreground: 'DCDCAA' },
        // 变量
        { token: 'variable', foreground: '9CDCFE' },
        // 常量
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

    // 应用自定义主题
    monaco.editor.setTheme('esp32-dark')
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
