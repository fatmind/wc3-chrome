#!/usr/bin/env node

/**
 * 打包 wc3-chrome/extension 为 zip —— Chrome Web Store 审核通过前的过渡方案：
 * 供朋友本地「开发者模式」加载（chrome://extensions → 加载已解压的扩展程序）。
 *
 * 默认打到 wc3-chrome/dist/；带 --publish 时 cp 进 skill 仓库 webclaw3/dist/ 并 commit & push，
 * 让 zip 随 skill 仓库 git clone 一并分发（与 wc3-pipeline 的 publish:skill 同构）。
 *
 * 用法：
 *   node build/pack-extension.mjs            # 只打本地 dist/zip
 *   node build/pack-extension.mjs --publish  # 打包 + 发布到 skill 仓库并 push
 */

import { readFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const CHROME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXT_DIR = join(CHROME_DIR, 'extension');
const DIST = join(CHROME_DIR, 'dist');

const version = JSON.parse(readFileSync(join(EXT_DIR, 'manifest.json'), 'utf-8')).version;
const ZIP = `wc3-chrome-extension-${version}.zip`;
const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });

mkdirSync(DIST, { recursive: true });
rmSync(join(DIST, ZIP), { force: true });

// 进入 extension/ 打包，使 zip 内根直接是 manifest.json（解压即得可加载目录）。
// 排除：隐藏文件（.DS_Store 等）+ 商店素材（store.jpeg / store-* 截图与商店图标）
// + manifest 未引用的 icon.png——开发者模式加载只需 manifest 声明的 icon16/48/128 与运行时脚本。
run(`zip -r -q "${join(DIST, ZIP)}" . -x ".*" -x "icons/store.jpeg" -x "icons/store-*" -x "icons/icon.png"`, EXT_DIR);
console.log(`✔ 打包完成: dist/${ZIP}  (manifest v${version})`);

// ── 发布到 skill 仓库（仅 --publish）──
if (process.argv.includes('--publish')) {
  const MONO_ROOT = resolve(CHROME_DIR, '..');
  const SKILL_DIR = join(MONO_ROOT, 'webclaw3');
  const SKILL_DIST = join(SKILL_DIR, 'dist');

  console.log(`\n── 发布 ──`);
  mkdirSync(SKILL_DIST, { recursive: true });
  copyFileSync(join(DIST, ZIP), join(SKILL_DIST, ZIP));
  console.log(`  cp ${ZIP} -> webclaw3/dist/`);

  // 只提交 dist/ 下的本 zip，不卷入 skill 仓库其它未提交改动
  run(`git add dist/${ZIP}`, SKILL_DIR);
  run(`git commit -m "chore: publish wc3-chrome extension v${version} zip (dev-mode install)"`, SKILL_DIR);
  run('git push origin main', SKILL_DIR);
  console.log(`✔ 已推送 ${ZIP} 到 fatmind/webclaw3 (main)`);
}
