#!/usr/bin/env node
/**
 * Rasterize media/brand/icon.svg into the platform icon set used by
 * electron-builder (mac .icns, windows .ico, linux PNGs) and the
 * macOS template image set used by the renderer (icon-mono).
 *
 * Tools required:
 *   - magick (ImageMagick) on PATH
 *   - iconutil (macOS only — for .icns)
 *
 * Run:  npm run build:icons
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC_COLOR = 'media/brand/icon.svg';
const SRC_MONO = 'media/brand/icon-mono.svg';
const OUT_DIR = 'build/icons';
const ICONSET = 'build/icon.iconset';
const ICNS = 'media/brand/icon.icns';
const ICO = 'media/brand/icon.ico';
const TEMPLATE_DIR = 'media/brand';

function sh(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' });
}

function rasterize(svg, size, dest) {
  // Hi-DPI density renders the SVG sharply at the target size.
  sh('magick', ['-background', 'none', '-density', '512', svg, '-resize', `${size}x${size}`, dest]);
}

function ensureCleanDir(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

function buildLinuxPngs() {
  ensureCleanDir(OUT_DIR);
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
    rasterize(SRC_COLOR, size, join(OUT_DIR, `${size}.png`));
  }
  // electron-builder Linux convention: 512x512.png at the root of build/icons
  copyFileSync(join(OUT_DIR, '512.png'), join(OUT_DIR, '512x512.png'));
}

function buildMacIcns() {
  ensureCleanDir(ICONSET);
  // iconutil needs strict apple-naming pairs at 1x and 2x.
  const pairs = [
    [16, 'icon_16x16.png'],
    [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'],
    [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'],
    [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'],
    [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];
  for (const [size, name] of pairs) {
    rasterize(SRC_COLOR, size, join(ICONSET, name));
  }
  sh('iconutil', ['-c', 'icns', ICONSET, '-o', ICNS]);
  rmSync(ICONSET, { recursive: true, force: true });
}

function buildWindowsIco() {
  // ImageMagick can pack multiple PNGs into a single .ico
  const sizes = [16, 32, 48, 64, 128, 256];
  const tmpFiles = sizes.map(s => join(OUT_DIR, `${s}.png`));
  sh('magick', [...tmpFiles, ICO]);
}

function buildMacTemplateImages() {
  // For menu bar icons / overlays — three densities (1x/2x/3x) at 16px base.
  for (const [scale, suffix] of [[1, ''], [2, '@2x'], [3, '@3x']]) {
    rasterize(SRC_MONO, 16 * scale, join(TEMPLATE_DIR, `iconTemplate${suffix}.png`));
  }
}

console.log('• rasterizing color PNGs');
buildLinuxPngs();
console.log('• building macOS .icns');
buildMacIcns();
console.log('• building Windows .ico');
buildWindowsIco();
console.log('• building macOS template images (mono)');
buildMacTemplateImages();
console.log('✔ icon set written to build/icons + media/brand');
