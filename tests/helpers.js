// Loads extension scripts into an isolated Node VM with minimal browser stubs.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

function stubElement() {
  return {
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
    getContext: () => ({ drawImage() {}, clearRect() {}, strokeRect() {} }),
    appendChild() {}, insertBefore() {}, remove() {}, addEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    setAttribute() {}, getAttribute: () => null
  };
}

function makeBrowserContext() {
  const ctx = {
    console,
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 0,
    navigator: {},
    Image: function () { return { complete: false, naturalWidth: 0 }; },
    document: {
      readyState: 'complete',
      documentElement: stubElement(),
      body: stubElement(),
      createElement: stubElement,
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener() {}
    },
    addEventListener() {}
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  return vm.createContext(ctx);
}

/** Load kanji_dict.js + content.js and return the helpers exposed through the test hook. */
function loadContent() {
  const context = makeBrowserContext();
  let exported = null;
  context.__LYRIS_TEST_HOOK__ = (api) => { exported = api; };
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'kanji_dict.js'), 'utf8'), context, { filename: 'kanji_dict.js' });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8'), context, { filename: 'content.js' });
  if (!exported) throw new Error('content.js test hook did not fire');
  return { api: exported, context };
}

/** Load background.js (service worker) and return its global scope. */
function loadBackground(fetchImpl) {
  const listeners = [];
  const context = vm.createContext({
    console, setTimeout, clearTimeout, AbortController, TextDecoder, Uint8Array,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    fetch: fetchImpl || (() => Promise.reject(new Error('network disabled in tests'))),
    chrome: {
      runtime: { onMessage: { addListener: (fn) => listeners.push(fn) } },
      storage: { onChanged: { addListener() {} } }
    }
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), context, { filename: 'background.js' });
  context.__listeners = listeners;
  return context;
}

module.exports = { ROOT, loadContent, loadBackground };
