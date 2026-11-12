import type { FileKind } from './types';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif']);
const SOUND = new Set(['mp3', 'ogg', 'wav', 'm4a', 'aac', 'flac', 'opus', 'mid', 'midi']);
const FONT = new Set(['ttf', 'otf', 'woff', 'woff2']);
const XML = new Set(['xml', 'html', 'htm', 'json', 'txt', 'css', 'js', 'properties', 'plist']);
const NATIVE = new Set(['so', 'aar', 'jar', 'dll', 'dylib']);

export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  opus: 'audio/ogg',
  mid: 'audio/midi',
  midi: 'audio/midi',
  ttf: 'font/ttf',
  otf: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  json: 'application/json',
  txt: 'text/plain',
  md: 'text/markdown',
  smali: 'text/plain',
  so: 'application/octet-stream',
  apk: 'application/vnd.android.package-archive',
  zip: 'application/zip',
};

export function extOf(path: string): string {
  const clean = path.split(/[?#]/)[0];
  const base = clean.slice(clean.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot < 0 ? '' : base.slice(dot + 1).toLowerCase();
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function dirName(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

export function kindOf(path: string): FileKind {
  const ext = extOf(path);
  const lower = path.toLowerCase();
  if (lower.endsWith('.smali')) return 'smali';
  if (IMAGE.has(ext)) return 'image';
  if (SOUND.has(ext)) return 'sound';
  if (FONT.has(ext)) return 'font';
  if (ext === 'apk' || ext === 'aab' || ext === 'xapk' || ext === 'zip') return 'archive';
  if (NATIVE.has(ext)) return 'native';
  if (ext === 'xml') return 'xml';
  if (XML.has(ext)) return 'text';
  return 'other';
}

export function mimeOf(path: string): string {
  return MIME_BY_EXT[extOf(path)] ?? 'application/octet-stream';
}

/** Normalize an archive/directory entry name into a safe relative path. */
export function normalizePath(raw: string): string {
  let p = raw.replace(/\\/g, '/').trim();
  p = p.replace(/^(\.\/)+/, '');
  const parts: string[] = [];
  for (const chunk of p.split('/')) {
    if (!chunk || chunk === '.') continue;
    if (chunk === '..') {
      parts.pop();
      continue;
    }
    parts.push(chunk);
  }
  return parts.join('/');
}

export function isJunkPath(path: string): boolean {
  if (!path) return true;
  const parts = path.split('/');
  if (parts.some((part) => part === '__MACOSX' || part === '.git' || part === '.idea' || part === '.gradle')) {
    return true;
  }
  const name = baseName(path);
  if (name === '.DS_Store' || name === 'Thumbs.db' || name === 'desktop.ini') return true;
  if (/^META-INF\/(MANIFEST\.MF|.*\.(RSA|SF|DSA))$/i.test(path)) return true;
  return false;
}

/**
 * apktool/jadx archives often wrap everything in a single folder
 * (e.g. "MyApp/res/..." or "decompiled/smali/..."). Detect that root and strip it.
 */
export function stripCommonRoot(paths: string[]): { paths: string[]; stripped?: string } {
  if (paths.length === 0) return { paths };
  const roots = new Set<string>();
  for (const p of paths) {
    const i = p.indexOf('/');
    if (i <= 0) return { paths };
    roots.add(p.slice(0, i));
    if (roots.size > 1) return { paths };
  }
  const root = [...roots][0];
  // Never strip a meaningful Android top-level directory.
  const keep = new Set([
    'smali',
    'res',
    'assets',
    'lib',
    'original',
    'unknown',
    'src',
    'kotlin',
    'META-INF',
    'AndroidManifest.xml',
  ]);
  if (keep.has(root)) return { paths };
  return {
    paths: paths.map((p) => p.slice(root.length + 1)).filter(Boolean),
    stripped: root,
  };
}

const UNITS = ['o', 'Ko', 'Mo', 'Go'];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 o';
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}

export function sanitizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .toLowerCase();
}

export function humanize(name: string): string {
  const cleaned = name
    .replace(/^.*[./\\]/, '')
    .replace(/\$/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!cleaned) return name;
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** '#FF112233' -> rgba(17,34,51,1) */
export function cssColor(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  if (/^#[0-9a-f]{8}$/i.test(raw)) {
    const a = parseInt(raw.slice(1, 3), 16) / 255;
    const r = parseInt(raw.slice(3, 5), 16);
    const g = parseInt(raw.slice(5, 7), 16);
    const b = parseInt(raw.slice(7, 9), 16);
    return `rgba(${r},${g},${b},${Number(a.toFixed(3))})`;
  }
  return raw;
}

/** Convert an Android dimension to CSS pixels (dp/sp are treated 1:1). */
export function cssDimension(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const raw = value.trim();
  if (!raw) return undefined;
  if (raw === 'match_parent' || raw === 'fill_parent') return '100%';
  if (raw === 'wrap_content') return 'auto';
  const match = /^(-?\d+(?:\.\d+)?)(dp|dip|sp|px|pt|in|mm)$/i.exec(raw);
  if (!match) return /^\d+(?:\.\d+)?$/.test(raw) ? `${raw}px` : raw;
  const n = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'pt') return `${(n * 1.333).toFixed(2)}px`;
  if (unit === 'in') return `${(n * 96).toFixed(2)}px`;
  if (unit === 'mm') return `${(n * 3.7795).toFixed(2)}px`;
  return `${n}px`;
}
