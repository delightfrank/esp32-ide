/**
 * ESP32 IDE - 渲染进程入口
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/dark.css'

const root = createRoot(document.getElementById('root'))
root.render(<App />)
