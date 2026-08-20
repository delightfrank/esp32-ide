#!/usr/bin/env node
/**
 * Build script: copy monaco-editor AMD build (min/vs) to dist/vs
 * Usage: add to package.json build script: node tools/copy-monaco.js
 * e.g. "build": "vite build && node tools/copy-monaco.js"
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'node_modules', 'monaco-editor', 'min', 'vs')
const DEST = path.join(ROOT, 'dist', 'vs')

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else fs.copyFileSync(s, d)
  }
}

if (!fs.existsSync(SRC)) {
  console.error('[copy-monaco] node_modules/monaco-editor/min/vs not found, run npm install first')
  process.exit(1)
}

copyDir(SRC, DEST)
console.log('[copy-monaco] copied monaco min/vs -> dist/vs')
