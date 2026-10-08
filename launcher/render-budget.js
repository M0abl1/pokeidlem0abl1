/* Remote software rendering: limit drawing, never network or automation timers. */
(() => {
  'use strict';
  const request = window.requestAnimationFrame.bind(window);
  const callbacks = new Map();
  let nextId = 0, scheduled = false, last = -Infinity;
  const interval = 1000 / 20;
  function schedule() {
    if (scheduled || !callbacks.size) return;
    scheduled = true;
    setTimeout(() => request(frame), Math.max(0, last + interval - performance.now()));
  }
  function frame(time) {
    scheduled = false;
    if (!callbacks.size) return;
    if (time - last < interval) { schedule(); return; }
    last = time;
    const ids = [...callbacks.keys()];
    for (const id of ids) {
      const callback = callbacks.get(id);
      callbacks.delete(id);
      if (callback) {
        try { callback(time); } catch (error) { setTimeout(() => { throw error; }, 0); }
      }
    }
    schedule();
  }
  window.requestAnimationFrame = callback => {
    if (typeof callback !== 'function') throw new TypeError('Animation callback must be a function');
    const id = ++nextId;
    callbacks.set(id, callback);
    schedule();
    return id;
  };
  window.cancelAnimationFrame = id => callbacks.delete(id);
})();
