import { baseName, extOf, kindOf, mimeOf, normalizePath, isJunkPath, stripCommonRoot, formatBytes } from './files';
import { readZip, bytesToBlob } from './zip';
import type { ImportedFile } from './types';

export interface IngestLimits {
  maxFileSize: number;
  maxTotalSize: number;
  maxFiles: number;
}

export const DEFAULT_LIMITS: IngestLimits = {
  maxFileSize: 96 * 1024 * 1024,
  maxTotalSize: 768 * 1024 * 1024,
  maxFiles: 40000,
};

export interface IngestResult {
  files: ImportedFile[];
  warnings: string[];
  archives: string[];
  hasApk: boolean;
  strippedRoot?: string;
}

interface RawFile {
  path: string;
  file: Blob;
  name: string;
}

/** Import from a drag & drop event, including folders (FileSystem Entry API). */
export async function ingestFromDataTransfer(
  dataTransfer: DataTransfer,
  limits: IngestLimits = DEFAULT_LIMITS,
): Promise<IngestResult> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries: RawFile[] = [];
  let usedEntryApi = false;

  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      usedEntryApi = true;
      await walkEntry(entry, '', entries, limits);
    }
  }

  if (!usedEntryApi) {
    for (const file of Array.from(dataTransfer.files ?? [])) {
      entries.push({ path: normalizePath(file.name), file, name: file.name });
    }
  }

  return processRawFiles(entries, limits);
}

/** Import from <input type="file"> (multiple and/or webkitdirectory). */
export async function ingestFromFileList(
  fileList: FileList | File[],
  limits: IngestLimits = DEFAULT_LIMITS,
): Promise<IngestResult> {
  const entries: RawFile[] = [];
  for (const file of Array.from(fileList)) {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const path = normalizePath(relative && relative.length > 0 ? relative : file.name);
    entries.push({ path, file, name: file.name });
  }
  return processRawFiles(entries, limits);
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: RawFile[],
  limits: IngestLimits,
): Promise<void> {
  if (out.length > limits.maxFiles) return;
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry;
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject);
    });
    out.push({ path: normalizePath(`${prefix}/${entry.name}`), file, name: entry.name });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const dirPath = `${prefix}/${entry.name}`;
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (batch.length === 0) break;
      for (const child of batch) {
        await walkEntry(child, dirPath, out, limits);
        if (out.length > limits.maxFiles) return;
      }
    }
  }
}

async function processRawFiles(rawFiles: RawFile[], limits: IngestLimits): Promise<IngestResult> {
  const files: ImportedFile[] = [];
  const warnings: string[] = [];
  const archives: string[] = [];
  let hasApk = false;
  let total = 0;
  let skipped = 0;

  for (const raw of rawFiles) {
    if (isJunkPath(raw.path)) {
      skipped += 1;
      continue;
    }
    if (files.length >= limits.maxFiles) {
      warnings.push(
        `Limite de ${limits.maxFiles.toLocaleString('fr-FR')} fichiers atteinte : l'import a été tronqué.`,
      );
      break;
    }
    const ext = extOf(raw.path);
    const isArchive = ext === 'apk' || ext === 'zip' || ext === 'aab' || ext === 'xapk';
    if (isArchive) {
      const size = raw.file.size;
      if (size > limits.maxFileSize) {
        warnings.push(`${baseName(raw.path)} ignoré : ${formatBytes(size)} dépasse la limite par fichier.`);
        continue;
      }
      if (total + size > limits.maxTotalSize) {
        warnings.push('Limite de taille totale atteinte : les archives suivantes sont ignorées.');
        break;
      }
      if (ext === 'apk' || ext === 'aab' || ext === 'xapk') hasApk = true;
      archives.push(baseName(raw.path));
      let entries;
      try {
        entries = await readZip(await raw.file.arrayBuffer());
      } catch (error) {
        warnings.push(
          `Archive ${baseName(raw.path)} illisible (${error instanceof Error ? error.message : String(error)}).`,
        );
        continue;
      }
      const prefix = raw.path.includes('/') ? raw.path.slice(0, raw.path.lastIndexOf('/') + 1) : '';
      for (const entry of entries) {
        const path = normalizePath(`${prefix}${entry.path}`);
        if (isJunkPath(path)) continue;
        if (entry.data.byteLength > limits.maxFileSize) {
          warnings.push(`${path} ignoré : fichier trop volumineux.`);
          continue;
        }
        if (total + entry.data.byteLength > limits.maxTotalSize) {
          warnings.push('Limite de taille totale atteinte pendant la décompression.');
          break;
        }
        total += entry.data.byteLength;
        files.push({
          path,
          blob: bytesToBlob(entry.data, mimeOf(path)),
          size: entry.data.byteLength,
          kind: kindOf(path),
          mime: mimeOf(path),
        });
      }
      continue;
    }

    if (raw.file.size > limits.maxFileSize) {
      warnings.push(
        `${baseName(raw.path)} ignoré : ${formatBytes(raw.file.size)} dépasse la limite par fichier.`,
      );
      continue;
    }
    if (total + raw.file.size > limits.maxTotalSize) {
      warnings.push('Limite de taille totale atteinte : les fichiers suivants sont ignorés.');
      break;
    }
    total += raw.file.size;
    files.push({
      path: raw.path,
      blob: raw.file,
      size: raw.file.size,
      kind: kindOf(raw.path),
      mime: mimeOf(raw.path),
    });
  }

  // De-duplicate paths (can happen with overlapping folders in a drop).
  const seen = new Set<string>();
  const deduped: ImportedFile[] = [];
  for (const file of files) {
    let path = file.path;
    let counter = 2;
    while (seen.has(path)) {
      const dot = file.path.lastIndexOf('.');
      path =
        dot > 0
          ? `${file.path.slice(0, dot)}-${counter}${file.path.slice(dot)}`
          : `${file.path}-${counter}`;
      counter += 1;
    }
    seen.add(path);
    deduped.push(path === file.path ? file : { ...file, path });
  }

  let strippedRoot: string | undefined;
  if (deduped.length > 1) {
    const stripped = stripCommonRoot(deduped.map((file) => file.path));
    if (stripped.stripped) {
      strippedRoot = stripped.stripped;
      for (let i = 0; i < deduped.length; i += 1) deduped[i] = { ...deduped[i], path: stripped.paths[i] };
    }
  }

  if (deduped.length === 0 && warnings.length === 0) {
    warnings.push("Aucun fichier exploitable n'a été trouvé dans la sélection.");
  }
  if (hasApk) {
    warnings.push(
      "APK brut importé : AndroidManifest.xml et res/**/*.xml y sont binaires. Les images, sons, polices et bibliothèques natives sont extraits, mais la reconstruction d'interface nécessite une décompilation (apktool) fournie en ZIP ou en dossier.",
    );
  }
  if (skipped > 0) warnings.push(`${skipped} entrée(s) système ignorée(s) (__MACOSX, .DS_Store, signatures…).`);

  return { files: deduped, warnings, archives, hasApk, strippedRoot };
}
