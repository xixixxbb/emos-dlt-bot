#!/usr/bin/env node
/**
 * 静态检查：所有相对 import / dynamic import 是否解析到真实文件
 * 用途：防止 "ERR_MODULE_NOT_FOUND"（import 路径层级写错）类问题进入部署
 * 运行：npm run check
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const scanDirs = ['src', 'scripts', 'test']
const files = []

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(p)
    } else if (entry.name.endsWith('.js')) {
      files.push(p)
    }
  }
}

for (const d of scanDirs) {
  const abs = path.join(root, d)
  if (fs.existsSync(abs)) walk(abs)
}

const specRe = /(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g
let bad = 0

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8')
  let m
  while ((m = specRe.exec(src))) {
    const spec = m[1]
    const resolved = path.resolve(path.dirname(file), spec)
    if (!fs.existsSync(resolved)) {
      const line = src.slice(0, m.index).split('\n').length
      console.error(`✗ ${path.relative(root, file)}:${line}  ${spec}  →  ${path.relative(root, resolved)}（不存在）`)
      bad++
    }
  }
}

if (bad === 0) {
  console.log(`✓ 相对 import 检查通过（${files.length} 个文件）`)
  process.exit(0)
}
console.error(`\n共 ${bad} 处错误（扫描 ${files.length} 个文件）`)
process.exit(1)
