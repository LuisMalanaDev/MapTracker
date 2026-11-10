// ============================================================================
// src/services/placesService.js — Overpass Nearby Restaurant Radar & Search
// ============================================================================

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

export function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function formatDistance(meters) {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function resolveEmojiAndLabel(tags = {}) {
  const amenity = tags.amenity || '';
  const cuisine = (tags.cuisine || '').toLowerCase();
  const name = (tags.name || '').toLowerCase();

  if (cuisine.includes('pizza') || name.includes('pizza') || name.includes('greenwich') || name.includes('shakey')) {
    return { emoji: '🍕', label: 'Pizza & Pasta', category: 'restaurant' };
  }
  if (
    cuisine.includes('burger') ||
    name.includes('jollibee') ||
    name.includes('mcdonald') ||
    name.includes('kfc') ||
    name.includes('chowking') ||
    amenity === 'fast_food'
  ) {
    return { emoji: '🍔', label: 'Fast Food', category: 'fast_food' };
  }
  if (
    cuisine.includes('coffee') ||
    cuisine.includes('bubble_tea') ||
    name.includes('cafe') ||
    name.includes('coffee') ||
    name.includes('tea') ||
    name.includes('starbucks') ||
    amenity === 'cafe'
  ) {
    return { emoji: '☕', label: 'Café & Milk Tea', category: 'cafe' };
  }
  if (
    cuisine.includes('ramen') ||
    cuisine.includes('noodle') ||
    cuisine.includes('japanese') ||
    cuisine.includes('korean') ||
    name.includes('samgyup')
  ) {
    return { emoji: '🍜', label: 'Asian & Noodles', category: 'restaurant' };
  }
  if (cuisine.includes('chicken') || cuisine.includes('bbq') || name.includes('inasal')) {
    return { emoji: '🍗', label: 'Grill & Chicken', category: 'restaurant' };
  }
  if (amenity === 'ice_cream' || cuisine.includes('dessert') || amenity === 'bakery') {
    return { emoji: '🍰', label: 'Bakery & Desserts', category: 'cafe' };
  }
  return { emoji: '🍽️', label: 'Restaurant', category: 'restaurant' };
}

export async function fetchNearbyRestaurants(userLat, userLng, radiusMeters = 1500) {
  const query = `
    [out:json][timeout:15];
    (
      node["amenity"~"restaurant|fast_food|cafe|food_court|ice_cream|bakery"](around:${radiusMeters},${userLat},${userLng});
      way["amenity"~"restaurant|fast_food|cafe|food_court"](around:${radiusMeters},${userLat},${userLng});
    );
    out center 80;
  `;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.elements && data.elements.length > 0) {
        const parsed = parseOverpassElements(data.elements, userLat, userLng);
        if (parsed.length > 0) return parsed;
      }
    } catch (e) {
      // Try next mirror
    }
  }

  return generateFallbackPlaces(userLat, userLng);
}

function parseOverpassElements(elements, userLat, userLng) {
  const seenNames = new Set();
  const places = [];

  elements.forEach((el) => {
    const tags = el.tags || {};
    const name = tags.name || tags['name:en'];
    if (!name) return;

    const lat = el.lat || (el.center && el.center.lat);
    const lng = el.lon || (el.center && el.center.lon);
    if (!lat || !lng) return;

    const dedupeKey = `${name.toLowerCase()}_${lat.toFixed(3)}`;
    if (seenNames.has(dedupeKey)) return;
    seenNames.add(dedupeKey);

    const distMeters = getDistanceMeters(userLat, userLng, lat, lng);
    const { emoji, label, category } = resolveEmojiAndLabel(tags);
    const street = tags['addr:street'] || tags['addr:full'] || tags['addr:city'] || 'Nearby Street';

    places.push({
      id: `osm_${el.id}`,
      name,
      lat,
      lng,
      category,
      emoji,
      typeLabel: label,
      address: street,
      distanceMeters: distMeters,
      distanceText: formatDistance(distMeters),
      walkMinutes: Math.max(1, Math.round(distMeters / 78))
    });
  });

  return places.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export async function searchPlacesByQuery(queryText, userLat, userLng) {
  if (!queryText || !queryText.trim()) return [];
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(queryText)}&lat=${userLat}&lon=${userLng}&limit=20`;
    const res = await fetch(url);
    const data = await res.json();

    if (data && data.features) {
      const results = data.features.map((f, idx) => {
        const [lng, lat] = f.geometry.coordinates;
        const props = f.properties || {};
        const name = props.name || props.street || queryText;
        const addressParts = [props.street, props.district, props.city].filter(Boolean);
        const distMeters = getDistanceMeters(userLat, userLng, lat, lng);
        const { emoji, label, category } = resolveEmojiAndLabel({
          amenity: props.osm_value,
          name
        });

        return {
          id: `search_${props.osm_id || idx}`,
          name,
          lat,
          lng,
          category,
          emoji,
          typeLabel: label,
          address: addressParts.join(', ') || props.country || 'Pinned Location',
          distanceMeters: distMeters,
          distanceText: formatDistance(distMeters),
          walkMinutes: Math.max(1, Math.round(distMeters / 78))
        };
      });
      return results.sort((a, b) => a.distanceMeters - b.distanceMeters);
    }
  } catch (e) {}
  return [];
}

export function recalculateDistances(places, userLat, userLng) {
  return places
    .map((p) => {
      const distMeters = getDistanceMeters(userLat, userLng, p.lat, p.lng);
      return {
        ...p,
        distanceMeters: distMeters,
        distanceText: formatDistance(distMeters),
        walkMinutes: Math.max(1, Math.round(distMeters / 78))
      };
    })
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

function generateFallbackPlaces(lat, lng) {
  const samples = [
    { name: 'Jollibee Plaza', dLat: 0.0024, dLng: 0.0018, emoji: '🍔', typeLabel: 'Fast Food', category: 'fast_food' },
    { name: 'Tokyo Ramen House', dLat: -0.0019, dLng: 0.0028, emoji: '🍜', typeLabel: 'Asian & Noodles', category: 'restaurant' },
    { name: 'Cloud 9 Specialty Café & Boba', dLat: 0.0031, dLng: -0.0021, emoji: '☕', typeLabel: 'Café & Milk Tea', category: 'cafe' },
    { name: 'Mang Inasal Grill Hub', dLat: -0.0032, dLng: -0.0015, emoji: '🍗', typeLabel: 'Grill & Chicken', category: 'restaurant' },
    { name: 'Brick Oven Artisanal Pizza', dLat: 0.0012, dLng: -0.0034, emoji: '🍕', typeLabel: 'Pizza & Pasta', category: 'restaurant' }
  ];

  return samples.map((s, i) => {
    const pLat = lat + s.dLat;
    const pLng = lng + s.dLng;
    const dist = getDistanceMeters(lat, lng, pLat, pLng);
    return {
      id: `sample_${i}`,
      name: s.name,
      lat: pLat,
      lng: pLng,
      category: s.category,
      emoji: s.emoji,
      typeLabel: s.typeLabel,
      address: 'Main Avenue District',
      distanceMeters: dist,
      distanceText: formatDistance(dist),
      walkMinutes: Math.max(1, Math.round(dist / 78))
    };
  });
}
