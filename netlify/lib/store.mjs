// Netlify Blobs with an in-memory fallback for local runs.
const memory = new Map();

export async function store(name) {
  try {
    const { getStore } = await import("@netlify/blobs");
    const s = getStore(name);
    return {
      getJSON: (k) => s.get(k, { type: "json" }),
      setJSON: (k, v) => s.setJSON(k, v),
      delete: (k) => s.delete(k),
      durable: true,
    };
  } catch {
    if (!memory.has(name)) memory.set(name, new Map());
    const m = memory.get(name);
    return {
      getJSON: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null),
      setJSON: async (k, v) => { m.set(k, JSON.stringify(v)); },
      delete: async (k) => { m.delete(k); },
      durable: false,
    };
  }
}
