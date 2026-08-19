/**
 * ESP32 IDE - 文件树组件
 * Phase 5: 左侧文件树面板，支持目录展开/折叠、右键菜单、文件操作
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'

// 文件图标映射
const FILE_ICONS = {
  // C/C++ 文件
  '.c': '📄',
  '.cpp': '📄',
  '.cc': '📄',
  '.cxx': '📄',
  // 头文件
  '.h': '📋',
  '.hpp': '📋',
  // Arduino
  '.ino': '🔧',
  // 配置文件
  '.json': '⚙️',
  '.ini': '⚙️',
  '.yaml': '⚙️',
  '.yml': '⚙️',
  '.toml': '⚙️',
  // Python
  '.py': '🐍',
  // 文本文件
  '.txt': '📝',
  '.md': '📝',
  '.log': '📝',
  // 默认
  default: '📄'
}

function getFileIcon(item) {
  if (item.type === 'directory') return '📁'
  return FILE_ICONS[item.ext] || FILE_ICONS.default
}

// ═══════════════════════════════════════════════
// 单个文件/目录节点
// ═══════════════════════════════════════════════

function FileTreeNode({
  item,
  depth,
  activeFilePath,
  expandedDirs,
  onToggleDir,
  onFileClick,
  onContextMenu
}) {
  const isDir = item.type === 'directory'
  const isExpanded = expandedDirs.has(item.path)
  const isActive = !isDir && item.path === activeFilePath
  const icon = getFileIcon(item)

  const handleClick = (e) => {
    e.stopPropagation()
    if (isDir) {
      onToggleDir(item.path)
    } else {
      onFileClick(item)
    }
  }

  const handleContextMenu = (e) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e, item)
  }

  return (
    <>
      <div
        className={`tree-item ${isDir ? 'tree-dir' : 'tree-file'} ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        {/* 目录展开/折叠箭头 */}
        {isDir && (
          <span className={`tree-arrow ${isExpanded ? 'expanded' : ''}`}>
            ▶
          </span>
        )}
        {!isDir && <span className="tree-arrow-placeholder" />}

        {/* 图标 */}
        <span className="tree-icon">{icon}</span>

        {/* 文件名 */}
        <span className="tree-name" title={item.path}>
          {item.name}
        </span>
      </div>

      {/* 子节点（目录展开时渲染） */}
      {isDir && isExpanded && item.children && item.children.map((child) => (
        <FileTreeNode
          key={child.path}
          item={child}
          depth={depth + 1}
          activeFilePath={activeFilePath}
          expandedDirs={expandedDirs}
          onToggleDir={onToggleDir}
          onFileClick={onFileClick}
          onContextMenu={onContextMenu}
        />
      ))}
    </>
  )
}

// ═══════════════════════════════════════════════
// 右键菜单组件
// ═══════════════════════════════════════════════

function ContextMenu({ x, y, items, onClose }) {
  const menuRef = useRef(null)

  useEffect(() => {
    const handleClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose()
      }
    }
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose()
    }

    // 延迟绑定，避免当前 click 事件立刻触发关闭
    setTimeout(() => {
      document.addEventListener('click', handleClick)
      document.addEventListener('keydown', handleEsc)
    }, 0)

    return () => {
      document.removeEventListener('click', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [onClose])

  // 修正位置，防止超出窗口
  const menuStyle = {
    left: Math.min(x, window.innerWidth - 200),
    top: Math.min(y, window.innerHeight - items.length * 32 - 10)
  }

  return (
    <div className="context-menu" ref={menuRef} style={menuStyle}>
      {items.map((item, idx) => {
        if (item.separator) {
          return <div key={idx} className="context-menu-separator" />
        }
        return (
          <div
            key={idx}
            className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
            onClick={() => {
              if (!item.disabled) {
                item.action()
                onClose()
              }
            }}
          >
            <span className="context-menu-icon">{item.icon || ''}</span>
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </div>
        )
      })}
    </div>
  )
}

// ═══════════════════════════════════════════════
// 输入对话框
// ═══════════════════════════════════════════════

function InputDialog({ title, placeholder, defaultValue, onConfirm, onCancel }) {
  const [value, setValue] = useState(defaultValue || '')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (value.trim()) {
      onConfirm(value.trim())
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-dialog input-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            <input
              ref={inputRef}
              type="text"
              className="form-input"
              placeholder={placeholder}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div className="modal-footer">
            <button type="button" className="toolbar-btn" onClick={onCancel}>取消</button>
            <button type="submit" className="toolbar-btn build-btn" disabled={!value.trim()}>确定</button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════

function FileTree({ projectPath, onFileOpen, activeFilePath }) {
  const [treeData, setTreeData] = useState([])
  const [expandedDirs, setExpandedDirs] = useState(new Set())
  const [contextMenu, setContextMenu] = useState(null)
  const [inputDialog, setInputDialog] = useState(null)

  // 刷新目录树
  const refreshTree = useCallback(async () => {
    if (!projectPath) {
      setTreeData([])
      return
    }
    try {
      const data = await window.electronAPI?.fileTreeList(projectPath)
      setTreeData(data || [])
    } catch (err) {
      console.error('刷新文件树失败:', err)
    }
  }, [projectPath])

  // 初始加载 + 监听变化
  useEffect(() => {
    refreshTree()

    if (projectPath) {
      window.electronAPI?.fileTreeWatch(projectPath)
    }

    // 监听目录变化事件
    const handleChanged = () => {
      refreshTree()
    }
    window.electronAPI?.onFileTreeChanged(handleChanged)

    return () => {
      if (projectPath) {
        window.electronAPI?.fileTreeUnwatch(projectPath)
      }
    }
  }, [projectPath, refreshTree])

  // 监听编辑器保存事件 → 自动刷新
  useEffect(() => {
    const handleSaved = () => {
      refreshTree()
    }
    window.electronAPI?.onFileSaved(handleSaved)
    return () => {
      window.electronAPI?.removeFileSavedListener?.(handleSaved)
    }
  }, [refreshTree])

  // 监听工具栏刷新事件
  useEffect(() => {
    const handleRefresh = () => {
      refreshTree()
    }
    window.addEventListener('filetree-refresh', handleRefresh)
    return () => {
      window.removeEventListener('filetree-refresh', handleRefresh)
    }
  }, [refreshTree])

  // 目录展开/折叠
  const handleToggleDir = useCallback((dirPath) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      return next
    })
  }, [])

  // 点击文件 → 打开到编辑器
  const handleFileClick = useCallback(async (item) => {
    try {
      const result = await window.electronAPI?.fileRead(item.path)
      if (result?.success) {
        onFileOpen?.(item.path, result.content)
      }
    } catch (err) {
      console.error('打开文件失败:', err)
    }
  }, [onFileOpen])

  // ═══════════════════════════════════════════════
  // 右键菜单处理
  // ═══════════════════════════════════════════════

  const handleContextMenu = useCallback((e, item) => {
    if (!item) {
      // 空白区域右键
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { icon: '📄', label: '新建文件', action: () => showNewFileDialog(projectPath) },
          { icon: '📁', label: '新建文件夹', action: () => showNewFolderDialog(projectPath) },
          { separator: true },
          { icon: '🔄', label: '刷新', action: refreshTree }
        ]
      })
      return
    }

    if (item.type === 'directory') {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { icon: '📄', label: '新建文件', action: () => showNewFileDialog(item.path) },
          { icon: '📁', label: '新建文件夹', action: () => showNewFolderDialog(item.path) },
          { separator: true },
          { icon: '✏️', label: '重命名', action: () => showRenameDialog(item) },
          { icon: '🗑️', label: '删除', action: () => handleDeleteItem(item) }
        ]
      })
    } else {
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        items: [
          { icon: '📖', label: '打开', action: () => handleFileClick(item) },
          { separator: true },
          { icon: '✏️', label: '重命名', action: () => showRenameDialog(item) },
          { icon: '🗑️', label: '删除', action: () => handleDeleteItem(item) }
        ]
      })
    }
  }, [projectPath, refreshTree, handleFileClick])

  // 关闭右键菜单
  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  // ═══════════════════════════════════════════════
  // 文件操作
  // ═══════════════════════════════════════════════

  const showNewFileDialog = useCallback((dirPath) => {
    setInputDialog({
      title: '新建文件',
      placeholder: '输入文件名（如 main.c）',
      defaultValue: '.c',
      onConfirm: async (name) => {
        // 自动补全 .c 后缀
        if (!name.includes('.')) {
          name += '.c'
        }
        const filePath = dirPath + '/' + name
        const result = await window.electronAPI?.fileCreate(filePath)
        if (result?.success) {
          refreshTree()
        }
        setInputDialog(null)
      },
      onCancel: () => setInputDialog(null)
    })
  }, [refreshTree])

  const showNewFolderDialog = useCallback((dirPath) => {
    setInputDialog({
      title: '新建文件夹',
      placeholder: '输入文件夹名',
      defaultValue: '',
      onConfirm: async (name) => {
        const newDirPath = dirPath + '/' + name
        const result = await window.electronAPI?.fileMkdir(newDirPath)
        if (result?.success) {
          refreshTree()
          // 自动展开父目录
          setExpandedDirs(prev => new Set([...prev, dirPath]))
        }
        setInputDialog(null)
      },
      onCancel: () => setInputDialog(null)
    })
  }, [refreshTree])

  const showRenameDialog = useCallback((item) => {
    setInputDialog({
      title: `重命名 "${item.name}"`,
      placeholder: '输入新名称',
      defaultValue: item.name,
      onConfirm: async (newName) => {
        if (newName === item.name) {
          setInputDialog(null)
          return
        }
        const dir = item.path.substring(0, item.path.lastIndexOf('/'))
        const newPath = dir + '/' + newName
        const result = await window.electronAPI?.fileRename(item.path, newPath)
        if (result?.success) {
          refreshTree()
          // 如果重命名的是当前打开的文件，更新路径
          if (item.path === activeFilePath) {
            onFileOpen?.(newPath, null) // null 表示不重新读取内容
          }
        }
        setInputDialog(null)
      },
      onCancel: () => setInputDialog(null)
    })
  }, [activeFilePath, onFileOpen, refreshTree])

  const handleDeleteItem = useCallback(async (item) => {
    const result = await window.electronAPI?.fileDelete(item.path)
    if (result?.success) {
      refreshTree()
      // 如果删除的是当前打开的文件，清空编辑器
      if (item.path === activeFilePath) {
        onFileOpen?.(null, '')
      }
    }
  }, [activeFilePath, onFileOpen, refreshTree])

  // ═══════════════════════════════════════════════
  // 渲染
  // ═══════════════════════════════════════════════

  const handleTreeAreaContextMenu = useCallback((e) => {
    // 仅在点击空白区域时触发（非子元素）
    if (e.target === e.currentTarget || e.target.classList.contains('file-tree-list')) {
      e.preventDefault()
      handleContextMenu(e, null)
    }
  }, [handleContextMenu])

  // 全部展开/折叠
  const expandAll = useCallback(() => {
    const collectDirs = (items) => {
      const dirs = []
      for (const item of items) {
        if (item.type === 'directory') {
          dirs.push(item.path)
          if (item.children) {
            dirs.push(...collectDirs(item.children))
          }
        }
      }
      return dirs
    }
    setExpandedDirs(new Set(collectDirs(treeData)))
  }, [treeData])

  const collapseAll = useCallback(() => {
    setExpandedDirs(new Set())
  }, [])

  if (!projectPath) {
    return (
      <div className="file-tree-panel">
        <div className="file-tree-header">
          <span className="file-tree-title">📁 文件</span>
        </div>
        <div className="file-tree-empty">
          <span>未打开项目</span>
          <span className="file-tree-hint">点击工具栏「📁 项目」选择文件夹</span>
        </div>
      </div>
    )
  }

  return (
    <div className="file-tree-panel">
      <div className="file-tree-header">
        <span className="file-tree-title">📁 文件</span>
        <div className="file-tree-actions">
          <button className="file-tree-btn" onClick={expandAll} title="全部展开">⊞</button>
          <button className="file-tree-btn" onClick={collapseAll} title="全部折叠">⊟</button>
          <button className="file-tree-btn" onClick={refreshTree} title="刷新">🔄</button>
        </div>
      </div>

      <div
        className="file-tree-list"
        onContextMenu={handleTreeAreaContextMenu}
      >
        {treeData.length === 0 ? (
          <div className="file-tree-empty">
            <span>空目录</span>
          </div>
        ) : (
          treeData.map((item) => (
            <FileTreeNode
              key={item.path}
              item={item}
              depth={0}
              activeFilePath={activeFilePath}
              expandedDirs={expandedDirs}
              onToggleDir={handleToggleDir}
              onFileClick={handleFileClick}
              onContextMenu={handleContextMenu}
            />
          ))
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={closeContextMenu}
        />
      )}

      {/* 输入对话框 */}
      {inputDialog && (
        <InputDialog
          title={inputDialog.title}
          placeholder={inputDialog.placeholder}
          defaultValue={inputDialog.defaultValue}
          onConfirm={inputDialog.onConfirm}
          onCancel={inputDialog.onCancel}
        />
      )}
    </div>
  )
}

export default FileTree
