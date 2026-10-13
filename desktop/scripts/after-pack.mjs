/**
 * electron-builder afterPack 钩子 — 修 Windows 包的 better-sqlite3 原生模块。
 *
 * 背景：dist:win 在 mac 上交叉打包，@electron/rebuild/prebuild-install 按宿主机
 * 平台下载预编译产物，导致 win 包里的 build/Release/better_sqlite3.node 实为
 * Mach-O（mac 二进制），Windows 上 dlopen 失败 → 后端 exit code 1。
 *
 * 修复：打包后（win-unpacked 生成、NSIS 封装前）用官方 win32-x64 预编译 .node
 * 覆盖。预编译文件缓存于 build/win-bin/better_sqlite3.node（同 ffmpeg.exe 的
 * 缓存方式；better-sqlite3 或 Electron 主版本升级时需重新下载对应 ABI：
 * https://github.com/WiseLibs/better-sqlite3/releases）
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const WIN_BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'win-bin', 'better_sqlite3.node')

export default async function afterPack(context) {
  // electron-builder 对缺失的 extraResources 只警告不报错（曾导致整包没打进 ffmpeg），
  // 这里硬性校验：任何平台都必须有本平台的 ffmpeg/ffprobe
  const resourcesDir = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources')
  const exe = context.electronPlatformName === 'win32' ? '.exe' : ''
  for (const name of [`ffmpeg${exe}`, `ffprobe${exe}`]) {
    const p = path.join(resourcesDir, 'bin', name)
    if (!fs.existsSync(p)) throw new Error(`打包产物缺少 bin/${name}（检查 prepare-resources 与 \${os} 目录命名）`)
  }

  if (context.electronPlatformName === 'darwin') {
    // 2026-10-13 用户拍板：macOS 包做 ad-hoc 签名（免费，不需要 Apple 开发者证书）
    // 为什么必须：electron-builder 配的是 identity: null（完全不打签名）→ arm64 上只剩 linker 签名、
    // Sealed Resources=none，spctl 原话「code has no resources but signature indicates they must be present」。
    // 浏览器下载再打上 quarantine 后，Gatekeeper 直接报「已损坏」（其实文件没坏，是签名不完整）。
    // ad-hoc 签完整后该提示消失，变成普通的「未验证的开发者」——右键→打开即可。
    const appName = `${context.packager.appInfo.productFilename}.app`
    const appPath = path.join(context.appOutDir, appName)
    const run = (cmd, args) => {
      const r = spawnSync(cmd, args, { stdio: 'inherit' })
      if (r.error) throw r.error
      if (r.status !== 0) throw new Error(`${cmd} 失败（exit ${r.status}）：${args.join(' ')}`)
    }
    run('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', appPath])
    run('codesign', ['--verify', '--verbose=2', appPath])
    console.log(`[after-pack] ${appName} 已 ad-hoc 签名并校验通过（arch=${context.arch}）`)
  }

  if (context.electronPlatformName !== 'win32') return
  if (!fs.existsSync(WIN_BIN)) {
    throw new Error(
      `缺少 win32 better-sqlite3 预编译: ${WIN_BIN}\n` +
      '下载 https://github.com/WiseLibs/better-sqlite3/releases/download/v12.11.1/' +
      'better-sqlite3-v12.11.1-electron-v136-win32-x64.tar.gz 解出 build/Release/better_sqlite3.node 放入该路径',
    )
  }
  const target = path.join(
    context.appOutDir, 'resources', 'app.asar.unpacked', 'node_modules',
    'better-sqlite3', 'build', 'Release', 'better_sqlite3.node',
  )
  if (!fs.existsSync(target)) throw new Error(`未找到待替换的 better_sqlite3.node: ${target}`)
  fs.copyFileSync(WIN_BIN, target)
  // 顺手清掉宿主机平台预编译残留（bindings 不会命中，但白占体积）
  fs.rmSync(path.join(path.dirname(path.dirname(path.dirname(target))), 'bin'), { recursive: true, force: true })
  console.log(`[after-pack] win32 better_sqlite3.node 已替换为 PE 二进制 (${(fs.statSync(target).size / 1024 / 1024).toFixed(1)}MB)`)
}
