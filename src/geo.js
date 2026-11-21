// Shared projection (must match tools/fetch-osm.mjs) and landmark catalog.
export const ORIGIN = { lat: 43.6426, lon: -79.3871 };
const R = 6378137;
const COS0 = Math.cos((ORIGIN.lat * Math.PI) / 180);

/** Lat/lon → local meters: x east, z south. */
export function project(lat, lon) {
  return {
    x: ((lon - ORIGIN.lon) * Math.PI / 180) * R * COS0,
    z: -((lat - ORIGIN.lat) * Math.PI / 180) * R,
  };
}

// view: [distance, azimuth (deg, 0 = camera south of target looking north, + = clockwise toward west), elevation (deg)]
export const LANDMARKS = [
  { id: 'cn', name: 'CN Tower', lat: 43.6426, lon: -79.3871, y: 360, labelY: 575, view: [900, 20, 12] },
  { id: 'rogers', name: 'Rogers Centre', lat: 43.6414, lon: -79.3894, y: 40, labelY: 105, view: [520, 35, 28] },
  { id: 'union', name: 'Union Station', lat: 43.6453, lon: -79.3806, y: 15, labelY: 45, view: [380, -15, 30] },
  { id: 'scotiabank', name: 'Scotiabank Arena', lat: 43.6435, lon: -79.3791, y: 20, labelY: 50, view: [380, -40, 30] },
  { id: 'financial', name: 'Financial District', lat: 43.6485, lon: -79.3812, y: 120, labelY: 320, view: [900, 160, 22] },
  { id: 'nps', name: 'Nathan Phillips Square', lat: 43.6525, lon: -79.3838, y: 20, labelY: 120, view: [480, 10, 32] },
  { id: 'harbourfront', name: 'Harbourfront', lat: 43.6388, lon: -79.3820, y: 5, labelY: 40, view: [600, 200, 20] },
  { id: 'islands', name: 'Toronto Islands', lat: 43.6205, lon: -79.3785, y: 60, labelY: 40, view: [2200, 8, 14] },
];
