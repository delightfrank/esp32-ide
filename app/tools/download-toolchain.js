#!/usr/bin/env node

/**
 * ESP32 工具链下载脚本
 * 从 GitHub 下载 ESP32 开发所需的工具链，支持断点续传
 * 
 * 用法：node tools/download-toolchain.js [--output ./toolchain]
 * 
 * 下载内容：
 *   - xtensa-esp32s3-elf-gcc (ESP32-S3 编译器)
 *   - xtensa-esp32-elf-gcc (ESP32 编译器)
 *   - riscv32-esp-elf-gcc (ESP32-C3 编译器)
 *   - esptool.py (烧录工具)
 *   - Arduino ESP32 核心库
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

// ── 配置 ──

const DEFAULT_OUTPUT = path.join(__dirname, '..', 'toolchain');

// GitHub Release URLs (espressif 官方)
const TOOLCHAINS = {
  'xtensa-esp32s3-elf-gcc': {
    // ESP-IDF v5.3 工具链
    url: 'https://github.com/espressif/esp-idf/releases/download/v5.3.2/esp-idf-v5.3.2-linux-arm64.tar.xz',
    altUrl: 'https://github.com/espressif/esp-idf/releases/download/v5.3.2/esp-idf-v5.3.2-linux-amd64.tar.xz',
    size: '~800MB',
    description: 'ESP32-S3 交叉编译器'
  },
  'esptool': {
    url: 'https://github.com/espressif/esptool/releases/download/v4.8.5/esptool-v4.8.5-linux-arm64.tar.gz',
    altUrl: 'https://github.com/espressif/esptool/releases/download/v4.8.5/esptool-v4.8.5-linux-amd64.tar.gz',
    size: '~5MB',
    description: 'ESP32 烧录工具'
  },
  'arduino-esp32-core': {
    url: 'https://github.com/espressif/arduino-esp32/releases/download/3.0.7/esp32-3.0.7.zip',
    size: '~50MB',
    description: 'Arduino ESP32 核心库'
  }
};

// PlatformIO 包名映射
const PIO_PACKAGES = [
  { name: 'toolchain-xtensa-esp32s3', pioName: 'platformio/toolchain-xtensa-esp32s3' },
  { name: 'toolchain-xtensa-esp32', pioName: 'platformio/toolchain-xtensa-esp32' },
  { name: 'toolchain-riscv32-esp', pioName: 'platformio/toolchain-riscv32-esp' },
  { name: 'tool-esptoolpy', pioName: 'platformio/tool-esptoolpy' },
  { name: 'tool-mkspiffs', pioName: 'platformio/tool-mkspiffs' },
  { name: 'tool-mklittlefs', pioName: 'platformio/tool-mklittlefs' }
];

// ── 工具函数 ──

function log(msg) {
  console.log(`[download] ${msg}`);
}

function error(msg) {
  console.error(`[download] ❌ ${msg}`);
  process.exit(1);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// ── 断点续传下载 ──

function downloadFile(url, destPath, retries = 3) {
  return new Promise((resolve, reject) => {
    const tempPath = `${destPath}.tmp`;
    let existingSize = 0;

    // 检查已下载的部分
    if (fs.existsSync(tempPath)) {
      existingSize = fs.statSync(tempPath).size;
      log(`  发现未完成下载，从 ${formatBytes(existingSize)} 继续`);
    }

    const doDownload = (downloadUrl) => {
      const protocol = downloadUrl.startsWith('https') ? https : http;
      const options = {};

      if (existingSize > 0) {
        options.headers = { 'Range': `bytes=${existingSize}-` };
      }

      protocol.get(downloadUrl, options, (res) => {
        // 处理重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          log(`  重定向到: ${res.headers.location}`);
          doDownload(res.headers.location);
          return;
        }

        if (res.statusCode === 200) {
          // 全新下载
          existingSize = 0;
          fs.writeFileSync(tempPath, '');
        } else if (res.statusCode === 206) {
          // 断点续传
          log('  断点续传成功');
        } else if (res.statusCode === 416) {
          // Range 不满足，文件已完整
          log('  文件已完整下载');
          fs.renameSync(tempPath, destPath);
          resolve();
          return;
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusText || 'Unknown error'}`));
          return;
        }

        const contentLength = parseInt(res.headers['content-length'] || '0', 10);
        const totalSize = existingSize + contentLength;
        let downloaded = existingSize;

        const fileStream = fs.createWriteStream(tempPath, { flags: existingSize > 0 ? 'a' : 'w' });

        res.on('data', (chunk) => {
          downloaded += chunk.length;
          fileStream.write(chunk);
          // 进度显示
          if (totalSize > 0) {
            const pct = ((downloaded / totalSize) * 100).toFixed(1);
            process.stdout.write(`\r  下载进度: ${pct}% (${formatBytes(downloaded)}/${formatBytes(totalSize)})`);
          }
        });

        res.on('end', () => {
          fileStream.end(() => {
            process.stdout.write('\n');
            // 验证大小
            if (totalSize > 0 && downloaded < totalSize) {
              reject(new Error(`下载不完整: ${formatBytes(downloaded)}/${formatBytes(totalSize)}`));
            } else {
              fs.renameSync(tempPath, destPath);
              resolve();
            }
          });
        });

        res.on('error', (err) => {
          fileStream.end();
          reject(err);
        });
      }).on('error', (err) => {
        reject(err);
      });
    };

    // 重试逻辑
    const tryDownload = (attempt) => {
      doDownload(url).catch((err) => {
        if (attempt < retries) {
          log(`  下载失败，${attempt + 1}/${retries} 次重试...`);
          setTimeout(() => tryDownload(attempt + 1), 2000 * attempt);
        } else {
          reject(err);
        }
      });
    };

    tryDownload(0);
  });
}

// ── 解压工具 ──

async function extractFile(archivePath, destDir) {
  log(`解压: ${path.basename(archivePath)}`);
  ensureDir(destDir);

  if (archivePath.endsWith('.tar.xz')) {
    execSync(`tar -xJf "${archivePath}" -C "${destDir}"`, { stdio: 'inherit' });
  } else if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
    execSync(`tar -xzf "${archivePath}" -C "${destDir}"`, { stdio: 'inherit' });
  } else if (archivePath.endsWith('.zip')) {
    execSync(`unzip -o "${archivePath}" -d "${destDir}"`, { stdio: 'inherit' });
  } else {
    log(`  跳过未知格式: ${archivePath}`);
  }
}

// ── PlatformIO 工具链安装 ──

function installPioToolchains() {
  log('检查 PlatformIO 工具链...');

  const pioPath = execSync('which pio 2>/dev/null || echo ""', { encoding: 'utf8' }).trim();
  if (!pioPath) {
    log('⚠️  PlatformIO 未安装，跳过 PIO 工具链安装');
    log('  安装命令: pip install platformio');
    return false;
  }

  log('PlatformIO 已安装，自动安装缺失工具链...');

  for (const pkg of PIO_PACKAGES) {
    try {
      log(`  安装 ${pkg.name}...`);
      execSync(`pio pkg install -g -l "${pkg.name}" --no-interaction`, {
        stdio: 'pipe',
        timeout: 120000
      });
      log(`  ✅ ${pkg.name}`);
    } catch {
      log(`  ⚠️  ${pkg.name} 安装失败，可能已存在或需要手动安装`);
    }
  }

  return true;
}

// ── 复制已安装的工具链 ──

function copyInstalledToolchains(outputDir) {
  const platformioCache = path.join(process.env.HOME || process.env.USERPROFILE, '.platformio');
  const packagesDir = path.join(platformioCache, 'packages');

  if (!fs.existsSync(packagesDir)) {
    log('未找到 PlatformIO 缓存，跳过复制');
    return;
  }

  log('复制已安装的工具链到输出目录...');

  for (const pkg of PIO_PACKAGES) {
    const src = path.join(packagesDir, pkg.name);
    if (fs.existsSync(src)) {
      const dest = path.join(outputDir, pkg.name);
      log(`  复制 ${pkg.name}...`);
      execSync(`cp -r "${src}" "${dest}"`);
    }
  }
}

// ── 主流程 ──

async function main() {
  const args = process.argv.slice(2);
  const outputIdx = args.indexOf('--output');
  const outputDir = outputIdx !== -1 ? args[outputIdx + 1] : DEFAULT_OUTPUT;

  log('═══════════════════════════════════════');
  log('  ESP32 工具链下载器');
  log('═══════════════════════════════════════');
  log(`输出目录: ${outputDir}`);
  log('');

  ensureDir(outputDir);

  // 1. 尝试 PlatformIO 自动安装
  const pioInstalled = installPioToolchains();

  // 2. 从 GitHub 下载离线包
  if (!args.includes('--pio-only')) {
    log('\n下载离线工具链包...');

    for (const [name, info] of Object.entries(TOOLCHAINS)) {
      const filename = info.url.split('/').pop();
      const archivePath = path.join(outputDir, filename);
      const extractDir = path.join(outputDir, name);

      if (fs.existsSync(extractDir)) {
        log(`  跳过 ${name}（已存在）`);
        continue;
      }

      log(`\n下载 ${info.description}...`);
      log(`  来源: ${info.url}`);

      try {
        await downloadFile(info.url, archivePath);
        await extractFile(archivePath, extractDir);
        // 删除压缩包
        fs.unlinkSync(archivePath);
        log(`  ✅ ${name} 安装完成`);
      } catch (err) {
        log(`  ❌ 下载失败: ${err.message}`);
        if (info.altUrl) {
          log(`  尝试备用地址: ${info.altUrl}`);
          try {
            await downloadFile(info.altUrl, archivePath);
            await extractFile(archivePath, extractDir);
            fs.unlinkSync(archivePath);
            log(`  ✅ ${name} 安装完成（备用地址）`);
          } catch (err2) {
            log(`  ❌ 备用地址也失败: ${err2.message}`);
          }
        }
      }
    }
  }

  // 3. 复制已安装的工具链
  copyInstalledToolchains(outputDir);

  // 4. 写入信息
  const info = {
    timestamp: new Date().toISOString(),
    toolchains: Object.keys(TOOLCHAINS),
    pioPackages: PIO_PACKAGES.map(p => p.name),
    pioInstalled
  };
  fs.writeFileSync(
    path.join(outputDir, 'download-info.json'),
    JSON.stringify(info, null, 2)
  );

  log('\n═══════════════════════════════════════');
  log('  🎉 工具链下载完成！');
  log(`  输出目录: ${outputDir}`);
  log('═══════════════════════════════════════');
}

main().catch((err) => {
  error(`下载过程出错: ${err.message}`);
});
