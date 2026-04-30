/**
 * Material-Icon-Theme-style file + folder icon mapping.
 * Returns an icon name from the curated Boxicons set + an optional brand color.
 *
 * For files: keyed by extension (lowercased, no leading dot).
 * For folders: keyed by canonical folder name.
 *
 * Falls back to generic `file` / `folder` icons (with no color) for anything not in the map.
 */

import type { IconName } from './icons';

export interface FileIconMatch {
  icon: IconName;
  color?: string;
}

const FILE_BY_EXT: Record<string, FileIconMatch> = {
  md: { icon: 'markdown', color: '#519aba' },
  mdx: { icon: 'markdown', color: '#519aba' },
  markdown: { icon: 'markdown', color: '#519aba' },
  ts: { icon: 'typescript', color: '#3178c6' },
  tsx: { icon: 'typescript', color: '#3178c6' },
  cts: { icon: 'typescript', color: '#3178c6' },
  mts: { icon: 'typescript', color: '#3178c6' },
  js: { icon: 'javascript', color: '#f0db4f' },
  jsx: { icon: 'javascript', color: '#f0db4f' },
  cjs: { icon: 'javascript', color: '#f0db4f' },
  mjs: { icon: 'javascript', color: '#f0db4f' },
  py: { icon: 'python', color: '#3776ab' },
  pyc: { icon: 'python', color: '#3776ab' },
  pyi: { icon: 'python', color: '#3776ab' },
  java: { icon: 'java', color: '#e76f00' },
  kt: { icon: 'java', color: '#a97bff' },
  go: { icon: 'go', color: '#00add8' },
  rs: { icon: 'file', color: '#dea584' },
  rb: { icon: 'file', color: '#cc342d' },
  html: { icon: 'html5', color: '#e34c26' },
  htm: { icon: 'html5', color: '#e34c26' },
  css: { icon: 'css3', color: '#264de4' },
  scss: { icon: 'css3', color: '#cf649a' },
  sass: { icon: 'css3', color: '#cf649a' },
  json: { icon: 'list-ul', color: '#cbcb41' },
  yaml: { icon: 'list-ul', color: '#cb171e' },
  yml: { icon: 'list-ul', color: '#cb171e' },
  toml: { icon: 'list-ul', color: '#9c4221' },
  png: { icon: 'image', color: '#a074c4' },
  jpg: { icon: 'image', color: '#a074c4' },
  jpeg: { icon: 'image', color: '#a074c4' },
  gif: { icon: 'image', color: '#a074c4' },
  svg: { icon: 'image', color: '#ffb13b' },
  webp: { icon: 'image', color: '#a074c4' },
  ico: { icon: 'image', color: '#a074c4' },
  pdf: { icon: 'file', color: '#d1242f' },
  txt: { icon: 'file' },
  log: { icon: 'file', color: '#9a6700' },
  sh: { icon: 'file', color: '#4eaa25' },
  bash: { icon: 'file', color: '#4eaa25' },
  zsh: { icon: 'file', color: '#4eaa25' },
  sql: { icon: 'list-ul', color: '#dad8d8' },
  xml: { icon: 'file', color: '#0060ac' },
  csv: { icon: 'list-ul', color: '#1a7f37' },
  lock: { icon: 'tag', color: '#ce412b' },
  env: { icon: 'cog', color: '#fece5e' },
  gitignore: { icon: 'git', color: '#f54d27' },
  npmrc: { icon: 'nodejs', color: '#cb3837' },
  dockerfile: { icon: 'docker', color: '#2496ed' },
};

const FILE_BY_NAME: Record<string, FileIconMatch> = {
  'package.json': { icon: 'nodejs', color: '#cb3837' },
  'package-lock.json': { icon: 'nodejs', color: '#cb3837' },
  'tsconfig.json': { icon: 'typescript', color: '#3178c6' },
  '.gitignore': { icon: 'git', color: '#f54d27' },
  '.gitattributes': { icon: 'git', color: '#f54d27' },
  dockerfile: { icon: 'docker', color: '#2496ed' },
  'docker-compose.yml': { icon: 'docker', color: '#2496ed' },
  'docker-compose.yaml': { icon: 'docker', color: '#2496ed' },
  readme: { icon: 'markdown', color: '#519aba' },
  'readme.md': { icon: 'markdown', color: '#519aba' },
  changelog: { icon: 'markdown', color: '#519aba' },
  'changelog.md': { icon: 'markdown', color: '#519aba' },
  license: { icon: 'bookmark', color: '#9a6700' },
  'license.md': { icon: 'bookmark', color: '#9a6700' },
};

const FOLDER_BY_NAME: Record<string, FileIconMatch> = {
  node_modules: { icon: 'nodejs', color: '#cb3837' },
  '.git': { icon: 'git', color: '#f54d27' },
  '.github': { icon: 'github' },
  src: { icon: 'folder', color: '#0969da' },
  app: { icon: 'folder', color: '#0969da' },
  apps: { icon: 'folder', color: '#0969da' },
  packages: { icon: 'folder', color: '#0969da' },
  lib: { icon: 'folder', color: '#0969da' },
  test: { icon: 'folder', color: '#1a7f37' },
  tests: { icon: 'folder', color: '#1a7f37' },
  __tests__: { icon: 'folder', color: '#1a7f37' },
  spec: { icon: 'folder', color: '#1a7f37' },
  docs: { icon: 'markdown', color: '#519aba' },
  doc: { icon: 'markdown', color: '#519aba' },
  public: { icon: 'image', color: '#a074c4' },
  assets: { icon: 'image', color: '#a074c4' },
  media: { icon: 'image', color: '#a074c4' },
  images: { icon: 'image', color: '#a074c4' },
  styles: { icon: 'css3', color: '#264de4' },
  scripts: { icon: 'cog', color: '#fece5e' },
  bin: { icon: 'cog', color: '#fece5e' },
  build: { icon: 'cog', color: '#fece5e' },
  dist: { icon: 'cog', color: '#fece5e' },
  out: { icon: 'cog', color: '#fece5e' },
  notes: { icon: 'markdown', color: '#519aba' },
  '.vscode': { icon: 'cog', color: '#0098ff' },
  '.idea': { icon: 'cog', color: '#9c4221' },
};

/** Return an icon match for a file or folder, or a generic fallback. */
export function iconForFile(name: string, kind: 'file' | 'dir'): FileIconMatch {
  const lower = name.toLowerCase();
  if (kind === 'dir') {
    return FOLDER_BY_NAME[lower] ?? { icon: 'folder' };
  }
  if (FILE_BY_NAME[lower]) return FILE_BY_NAME[lower];
  const dot = lower.lastIndexOf('.');
  const ext = dot >= 0 ? lower.slice(dot + 1) : lower;
  return FILE_BY_EXT[ext] ?? { icon: 'file' };
}
