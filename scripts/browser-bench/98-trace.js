if (!globalThis.__kalada98) globalThis.__kalada98 = { events: [], context: null };
const state = globalThis.__kalada98;

export const trace = {
  clear() {
    state.events.length = 0;
  },
  events() {
    return state.events.slice();
  },
  scope(caller, uri, version, callback) {
    const previous = state.context;
    state.context = { caller, uri, version };
    try {
      return callback();
    } finally {
      state.context = previous;
    }
  },
  span(stage, source, callback) {
    const context = state.context;
    const start = performance.now();
    try {
      return callback();
    } finally {
      state.events.push({
        stage,
        ...context,
        at: start,
        ms: performance.now() - start,
        length: typeof source === "string" ? source.length : undefined,
      });
    }
  },
};
