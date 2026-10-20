import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';

// jsdom の crypto には subtle が無いことがあるので Node の実装を使う
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}
// jsdom の Blob には arrayBuffer() が無い版があるため Node の Blob に揃える
if (typeof (globalThis.Blob.prototype as Blob).arrayBuffer !== 'function') {
  Object.defineProperty(globalThis, 'Blob', { value: NodeBlob, configurable: true });
}
