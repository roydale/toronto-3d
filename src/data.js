// Loads data/toronto.json with download progress and converts decimeters to meters.
export async function loadCityData(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);

  let text;
  if (res.body && res.body.getReader) {
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      onProgress?.(received);
    }
    const all = new Uint8Array(received);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    text = new TextDecoder().decode(all);
  } else {
    text = await res.text();
  }

  const raw = JSON.parse(text);
  const m = (arr) => Float32Array.from(arr, (v) => v / 10);
  return {
    bounds: Object.fromEntries(Object.entries(raw.bounds).map(([k, v]) => [k, v / 10])),
    buildings: raw.buildings.map((b) => ({ h: b.h, m: b.m, t: b.t, e: b.e, rings: b.r.map(m) })),
    roads: raw.roads.map((r) => ({ c: r.c, e: r.e, p: m(r.p) })),
    rails: raw.rails.map(m),
    parks: raw.parks.map((p) => p.map(m)),
    water: raw.water.map((p) => p.map(m)),
  };
}
