import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export function source(path) { return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'); }
export function functions(start, end, globals) {
  const text = source('src/main.js');
  const a = text.indexOf(start), b = text.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('MVP test sınırları bulunamadı');
  const context = vm.createContext(globals);
  vm.runInContext(source('src/safety.js'), context);
  vm.runInContext(text.slice(a, b), context);
  return context;
}
export function serviceWorker(globals = {}) {
  const listeners = new Map();
  const context = vm.createContext({ URL, Response, Promise, ...globals,
    self: { location: { origin: 'https://test.invalid' },
      addEventListener: (type, listener) => listeners.set(type, listener),
      skipWaiting() {}, ...globals.self }
  });
  vm.runInContext(source('sw.js'), context);
  return { context, listeners };
}
