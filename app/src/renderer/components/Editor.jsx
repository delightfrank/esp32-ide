import React, { useEffect, useRef } from 'react'
import Editor from '@monaco-editor/react'
import loader from '@monaco-editor/loader'

// Use local monaco AMD build (node_modules/monaco-editor/min/vs):
// - No CDN, works offline (China-friendly)
// - Don't bundle monaco ESM into JS bundle, avoids Vite/Rollup
//   "Cannot access 'X' before initialization" circular dep crash (white screen root cause)
// dist/vs is copied by tools/copy-monaco.js during npm run build
loader.config({ paths: { vs: './vs' } })

// Monaco Editor options
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
 * Monaco Editor component
 * @param {string} value - editor content
 * @param {function} onChange - content change callback
 * @param {object} editorRef - editor reference
 */
function CodeEditor({ value, onChange, editorRef }) {
  const monacoRef = useRef(null)

  const handleEditorDidMount = (editor, monaco) => {
    editorRef.current = editor
    monacoRef.current = monaco

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
            <span>Loading editor...</span>
          </div>
        }
      />
    </div>
  )
}

export default CodeEditor
