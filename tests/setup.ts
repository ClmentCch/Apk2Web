/**
 * jsdom ships an older Blob/File implementation without arrayBuffer()/text(),
 * which the importer and IndexedDB layer rely on. Node's implementations are
 * fully compatible with the browser APIs used by the app.
 */
import { Blob as NodeBlob, File as NodeFile } from 'node:buffer';

const candidate = new Blob(['test']);
if (typeof candidate.arrayBuffer !== 'function' || typeof candidate.text !== 'function') {
  Object.defineProperty(globalThis, 'Blob', { value: NodeBlob, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'File', { value: NodeFile, configurable: true, writable: true });
}
