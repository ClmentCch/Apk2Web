import type { ImportedFile, ProjectMeta, StoredFile } from './types';

const DB_NAME = 'apk2web';
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error("IndexedDB n'est pas disponible dans ce navigateur."));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('files')) {
          const store = db.createObjectStore('files', { keyPath: ['projectId', 'path'] });
          store.createIndex('byProject', 'projectId');
        }
        if (!db.objectStoreNames.contains('edits')) {
          const store = db.createObjectStore('edits', { keyPath: ['projectId', 'path'] });
          store.createIndex('byProject', 'projectId');
        }
        if (!db.objectStoreNames.contains('builds')) {
          db.createObjectStore('builds', { keyPath: 'projectId' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Ouverture IndexedDB impossible.'));
    });
  }
  return dbPromise;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Erreur IndexedDB.'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Transaction IndexedDB échouée.'));
    tx.onabort = () => reject(tx.error ?? new Error('Transaction IndexedDB annulée.'));
  });
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const db = await openDb();
  const tx = db.transaction('projects', 'readonly');
  const items = await wrap(tx.objectStore('projects').getAll() as IDBRequest<ProjectMeta[]>);
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string): Promise<ProjectMeta | undefined> {
  const db = await openDb();
  const tx = db.transaction('projects', 'readonly');
  return wrap(tx.objectStore('projects').get(id) as IDBRequest<ProjectMeta | undefined>);
}

export async function saveProject(meta: ProjectMeta): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('projects', 'readwrite');
  tx.objectStore('projects').put(meta);
  await txDone(tx);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(['projects', 'files', 'edits', 'builds'], 'readwrite');
  tx.objectStore('projects').delete(id);
  for (const name of ['files', 'edits'] as const) {
    const index = tx.objectStore(name).index('byProject');
    const cursorRequest = index.openCursor(IDBKeyRange.only(id));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
  }
  tx.objectStore('builds').delete(id);
  await txDone(tx);
}

export async function addFiles(projectId: string, files: ImportedFile[]): Promise<void> {
  const db = await openDb();
  // Write in chunks so very large imports do not build one gigantic transaction.
  const CHUNK = 60;
  for (let i = 0; i < files.length; i += CHUNK) {
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    for (const file of files.slice(i, i + CHUNK)) {
      const record: StoredFile = {
        projectId,
        path: file.path,
        kind: file.kind,
        mime: file.mime,
        size: file.size,
        blob: file.blob,
      };
      store.put(record);
    }
    await txDone(tx);
  }
}

export interface FileEntry {
  path: string;
  kind: StoredFile['kind'];
  mime: string;
  size: number;
}

export async function listFiles(projectId: string): Promise<FileEntry[]> {
  const db = await openDb();
  const tx = db.transaction('files', 'readonly');
  const index = tx.objectStore('files').index('byProject');
  const records = await wrap(index.getAll(IDBKeyRange.only(projectId)) as IDBRequest<StoredFile[]>);
  return records
    .map(({ path, kind, mime, size }) => ({ path, kind, mime, size }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export async function getFileBlob(projectId: string, path: string): Promise<Blob | undefined> {
  const db = await openDb();
  const tx = db.transaction('files', 'readonly');
  const record = await wrap(
    tx.objectStore('files').get([projectId, path]) as IDBRequest<StoredFile | undefined>,
  );
  return record?.blob;
}

export async function getFileText(projectId: string, path: string): Promise<string | null> {
  const blob = await getFileBlob(projectId, path);
  if (!blob) return null;
  try {
    return await blob.text();
  } catch {
    return null;
  }
}

export async function deleteFile(projectId: string, path: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('files', 'readwrite');
  tx.objectStore('files').delete([projectId, path]);
  await txDone(tx);
}

export async function saveEdit(projectId: string, path: string, text: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('edits', 'readwrite');
  tx.objectStore('edits').put({ projectId, path, text, updatedAt: Date.now() });
  await txDone(tx);
}

export async function listEdits(projectId: string): Promise<Record<string, string>> {
  const db = await openDb();
  const tx = db.transaction('edits', 'readonly');
  const records = await wrap(
    tx.objectStore('edits').index('byProject').getAll(IDBKeyRange.only(projectId)) as IDBRequest<
      { projectId: string; path: string; text: string }[]
    >,
  );
  const map: Record<string, string> = {};
  for (const record of records) map[record.path] = record.text;
  return map;
}

export async function clearEdit(projectId: string, path: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('edits', 'readwrite');
  tx.objectStore('edits').delete([projectId, path]);
  await txDone(tx);
}

export interface StoredBuildSummary {
  projectId: string;
  createdAt: number;
  fidelity: string;
  fidelityLabel: string;
  screens: { id: string; title: string; activity?: string }[];
  diagnostics: { level: string; code: string; message: string }[];
  capabilities: { key: string; label: string; state: string; detail: string }[];
  interactions: number;
  testedAt?: number;
}

export async function saveBuildSummary(summary: StoredBuildSummary): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('builds', 'readwrite');
  tx.objectStore('builds').put(summary);
  await txDone(tx);
}

export async function getBuildSummary(projectId: string): Promise<StoredBuildSummary | undefined> {
  const db = await openDb();
  const tx = db.transaction('builds', 'readonly');
  return wrap(
    tx.objectStore('builds').get(projectId) as IDBRequest<StoredBuildSummary | undefined>,
  );
}
