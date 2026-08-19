#!/usr/bin/env node

/**
 * ESP32 IDE 离线打包脚本
 * 功能：检查工具链 → 打包 Electron → 复制工具链到输出目录
 * 
 * 用法：node tools/package-offline.js [--platform win32] [--arch x64]
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(ROOT, 'release');
const TOOLCHAIN_DIR = path.join(ROOT, 'toolchain');
const PLATFORMIO_CACHE = path.join(process.env.HOME || process.env.USERPROFILE, '.platformio');

// ── 工具函数 ──

function log(msg) {
  console.log(`[package] ${msg}`);
}

function error(msg) {
  console.error(`[package] ❌ ${msg}`);
  process.exit(1);
}

function run(cmd, opts = {}) {
  log(`执行: ${cmd}`);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts });
}

function dirExists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ── 1. 检查工具链 ──

function checkToolchain() {
  log('检查工具链状态...');

  const checks = [
    {
      name: 'PlatformIO Core',
      path: PLATFORMIO_CACHE,
      hint: '请先安装 PlatformIO: pip install platformio'
    },
    {
      name: 'xtensa-esp32s3-elf-gcc',
      path: path.join(PLATFORMIO_CACHE, 'packages', 'toolchain-xtensa-esp32s3'),
      hint: '请运行: pio pkg install -t toolchain-xtensa-esp32s3'
    },
    {
      name: 'xtensa-esp32-elf-gcc',
      path: path.join(PLATFORMIO_CACHE, 'packages', 'toolchain-xtensa-esp32'),
      hint: '请运行: pio pkg install -t toolchain-xtensa-esp32'
    },
    {
      name: 'riscv32-esp-elf-gcc',
      path: path.join(PLATFORMIO_CACHE, 'packages', 'toolchain-riscv32-esp'),
      hint: '请运行: pio pkg install -t toolchain-riscv32-esp'
    },
    {
      name: 'esptool',
      path: path.join(PLATFORMIO_CACHE, 'packages', 'tool-esptoolpy'),
      hint: '请运行: pio pkg install -t tool-esptoolpy'
    }
  ];

  const missing = [];
  for (const check of checks) {
    if (dirExists(check.path)) {
      log(`  ✅ ${check.name}`);
    } else {
      log(`  ❌ ${check.name} - 未找到`);
      missing.push(check);
    }
  }

  if (missing.length > 0) {
    log('\n缺少以下工具链组件：');
    for (const m of missing) {
      log(`  - ${m.name}: ${m.hint}`);
    }
    log('\n提示：可先运行 tools/download-toolchain.js 下载离线工具链包');
    return false;
  }

  log('工具链检查通过 ✅');
  return true;
}

// ── 2. Vite 构建 ──

function buildVite() {
  log('构建前端资源...');
  run('npx vite build');
  log('Vite 构建完成 ✅');
}

// ── 3. Electron Builder 打包 ──

function buildElectron(platform, arch) {
  log(`打包 Electron (${platform}/${arch})...`);

  const args = [];
  if (platform !== 'current') args.push(`--${platform}`);
  if (arch !== 'current') args.push(`--${arch}`);

  run(`npx electron-builder --config electron-builder.yml ${args.join(' ')}`);
  log('Electron 打包完成 ✅');
}

// ── 4. 复制工具链到输出目录 ──

function copyToolchain(platform, arch) {
  log('复制工具链到输出目录...');

  const targetDir = path.join(
    RELEASE_DIR,
    `ESP32-IDE-${platform}-${arch}`,
    'toolchain'
  );

  fs.mkdirSync(targetDir, { recursive: true });

  // 复制 PlatformIO 工具链
  const packagesDir = path.join(PLATFORMIO_CACHE, 'packages');
  if (dirExists(packagesDir)) {
    const toolchains = [
      'toolchain-xtensa-esp32s3',
      'toolchain-xtensa-esp32',
      'toolchain-riscv32-esp',
      'tool-esptoolpy',
      'tool-mkspiffs',
      'tool-mklittlefs',
      'tool-openocd-esp32'
    ];

    for (const tc of toolchains) {
      const src = path.join(packagesDir, tc);
      if (dirExists(src)) {
        const dest = path.join(targetDir, tc);
        log(`  复制 ${tc}...`);
        execSync(`cp -r "${src}" "${dest}"`);
      }
    }
  }

  // 复制离线工具链包（如果有）
  if (dirExists(TOOLCHAIN_DIR)) {
    log('  复制离线工具链包...');
    execSync(`cp -r "${TOOLCHAIN_DIR}"/* "${targetDir}/"`);
  }

  // 写入工具链版本信息
  const info = {
    timestamp: new Date().toISOString(),
    platform,
    arch,
    toolchains: fs.readdirSync(targetDir)
  };
  fs.writeFileSync(
    path.join(targetDir, 'toolchain-info.json'),
    JSON.stringify(info, null, 2)
  );

  log('工具链复制完成 ✅');
}

// ── 主流程 ──

function main() {
  const args = process.argv.slice(2);
  const platformIdx = args.indexOf('--platform');
  const archIdx = args.indexOf('--arch');
  const platform = platformIdx !== -1 ? args[platformIdx + 1] : 'current';
  const arch = archIdx !== -1 ? args[archIdx + 1] : 'current';

  log('═══════════════════════════════════════');
  log('  ESP32 IDE 离线包构建');
  log('═══════════════════════════════════════');

  // 检查工具链（允许跳过）
  if (!args.includes('--skip-check')) {
    const ok = checkToolchain();
    if (!ok) {
      log('\n⚠️  工具链检查未通过，使用 --skip-check 跳过');
      process.exit(1);
    }
  }

  // 构建流程
  buildVite();
  buildElectron(platform, arch);
  copyToolchain(platform, arch);

  log('\n═══════════════════════════════════════');
  log('  🎉 离线包构建完成！');
  log(`  输出目录: ${RELEASE_DIR}`);
  log('═══════════════════════════════════════');
}

main();
