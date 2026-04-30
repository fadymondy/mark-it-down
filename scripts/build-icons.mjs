#!/usr/bin/env node
/**
 * Rasterize media/brand/icon.svg into the platform icon set used by
 * electron-builder (mac .icns, windows .ico, linux PNGs) and the
 * macOS template image set used by the renderer (icon-mono).
 *
 * Uses @resvg/resvg-js — Rust-based SVG renderer with full gradient,
 * filter, and transform support. Cross-platform; no system tools
 * needed except `iconutil` (macOS-only, for .icns) and `magick` (for .ico).
 *
 * Run:  npm run build:icons
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, existsSync, copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

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

function rasterize(svgText, size, dest) {
  const resvg = new Resvg(svgText, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  });
  const png = resvg.render().asPng();
  writeFileSync(dest, png);
}

function ensureCleanDir(dir) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

function buildLinuxPngs(svgText) {
  ensureCleanDir(OUT_DIR);
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
    rasterize(svgText, size, join(OUT_DIR, `${size}.png`));
  }
  copyFileSync(join(OUT_DIR, '512.png'), join(OUT_DIR, '512x512.png'));
}

function buildMacIcns(svgText) {
  ensureCleanDir(ICONSET);
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
    rasterize(svgText, size, join(ICONSET, name));
  }
  sh('iconutil', ['-c', 'icns', ICONSET, '-o', ICNS]);
  rmSync(ICONSET, { recursive: true, force: true });
}

function buildWindowsIco() {
  const sizes = [16, 32, 48, 64, 128, 256];
  const tmpFiles = sizes.map(s => join(OUT_DIR, `${s}.png`));
  sh('magick', [...tmpFiles, ICO]);
}

function buildMacTemplateImages(svgText) {
  for (const [scale, suffix] of [[1, ''], [2, '@2x'], [3, '@3x']]) {
    rasterize(svgText, 16 * scale, join(TEMPLATE_DIR, `iconTemplate${suffix}.png`));
  }
}

const colorSvg = readFileSync(SRC_COLOR, 'utf8');
const monoSvg = readFileSync(SRC_MONO, 'utf8');

console.log('• rasterizing color PNGs');
buildLinuxPngs(colorSvg);
console.log('• building macOS .icns');
buildMacIcns(colorSvg);
console.log('• building Windows .ico');
buildWindowsIco();
console.log('• building macOS template images (mono)');
buildMacTemplateImages(monoSvg);
console.log('✔ icon set written to build/icons + media/brand');
