import { unzip, zipSync, type Zippable } from 'fflate';

export interface ZipEntry {
  path: string;
  data: Uint8Array;
}

export function readZip(buffer: ArrayBuffer | Uint8Array): Promise<ZipEntry[]> {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return new Promise((resolve, reject) => {
    try {
      unzip(bytes, (error, files) => {
        if (error) {
          reject(error);
          return;
        }
        const entries: ZipEntry[] = [];
        for (const [path, data] of Object.entries(files)) {
          if (path.endsWith('/')) continue;
          entries.push({ path, data });
        }
        resolve(entries);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export function writeZip(entries: { path: string; data: Uint8Array }[]): Uint8Array {
  const tree: Zippable = {};
  for (const entry of entries) {
    const safe = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!safe || safe.endsWith('/')) continue;
    tree[safe] = [entry.data, { level: shouldCompress(safe) ? 6 : 0 }];
  }
  return zipSync(tree);
}

function shouldCompress(path: string): boolean {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return [
    'html',
    'htm',
    'css',
    'js',
    'json',
    'md',
    'txt',
    'xml',
    'svg',
    'htaccess',
  ].includes(ext) || !ext.includes('.');
}

export function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function bytesToBlob(data: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return new Blob([copy.buffer], { type: mime });
}

export function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (!/;base64$/i.test(meta)) return textToBytes(decodeURIComponent(payload));
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
