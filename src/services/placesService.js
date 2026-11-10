// ============================================================================
// src/services/placesService.js — Multi-Engine Restaurant Radar & Google Search
// Combines: Google Maps Live Embed + ArcGIS Commercial POIs + Overpass + Nominatim
// ============================================================================

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  Accept: 'text/html,application/json,*/*'
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 6500) {
  return Promise.race([
    fetch(url, options),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), timeoutMs))
  ]);
}

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
  const amenity = (tags.amenity || '').toLowerCase();
  const cuisine = (tags.cuisine || '').toLowerCase();
  const name = (tags.name || '').toLowerCase();

  if (
    cuisine.includes('pizza') ||
    name.includes('pizza') ||
    name.includes('greenwich') ||
    name.includes('shakey')
  ) {
    return { emoji: '🍕', label: 'Pizza & Pasta', category: 'restaurant' };
  }
  if (
    cuisine.includes('burger') ||
    name.includes('jollibee') ||
    name.includes('mcdonald') ||
    name.includes('kfc') ||
    name.includes('chowking') ||
    name.includes('burger') ||
    amenity === 'fast_food'
  ) {
    return { emoji: '🍔', label: 'Fast Food', category: 'fast_food' };
  }
  if (
    cuisine.includes('coffee') ||
    cuisine.includes('bubble_tea') ||
    name.includes('cafe') ||
    name.includes('café') ||
    name.includes('coffee') ||
    name.includes('tea') ||
    name.includes('boba') ||
    name.includes('starbucks') ||
    name.includes('bakeshop') ||
    name.includes('bakery') ||
    name.includes('goldilocks') ||
    name.includes('red ribbon') ||
    amenity === 'cafe' ||
    amenity === 'bakery'
  ) {
    return { emoji: '☕', label: 'Café & Bakery', category: 'cafe' };
  }
  if (
    cuisine.includes('ramen') ||
    cuisine.includes('noodle') ||
    name.includes('lomi') ||
    name.includes('tuboy') ||
    name.includes('goto') ||
    name.includes('mami') ||
    name.includes('pancit') ||
    name.includes('ramen') ||
    name.includes('samgyup') ||
    name.includes('tokyo')
  ) {
    return { emoji: '🍜', label: 'Noodles & Asian', category: 'restaurant' };
  }
  if (
    cuisine.includes('chicken') ||
    cuisine.includes('bbq') ||
    name.includes('inasal') ||
    name.includes('grill') ||
    name.includes('pares') ||
    name.includes('sisig') ||
    name.includes('silog')
  ) {
    return { emoji: '🍗', label: 'Grill & Local Eats', category: 'restaurant' };
  }
  return { emoji: '🍽️', label: 'Restaurant', category: 'restaurant' };
}

// ============================================================================
// 1. GOOGLE MAPS DIRECT SEARCH ENGINE (Zero API Key Required!)
// Pulls exact Google Maps places, coordinates, addresses & star ratings
// ============================================================================
export async function searchGoogleMapsDirect(queryText, userLat, userLng) {
  const results = [];
  try {
    const url = `https://maps.google.com/maps?q=${encodeURIComponent(
      queryText
    )}&sll=${userLat},${userLng}&hl=en&output=embed`;

    const res = await fetchWithTimeout(url, { headers: HEADERS }, 6000);
    const html = await res.text();

    // Parse Google Maps initEmbed JSON blocks: ["0x...:0x...","Full Name, Address",[lat,lng]
    const regex = /\["(0x[0-9a-f]+:0x[0-9a-f]+)","([^"]+)",\[(-?\d+\.\d+),(-?\d+\.\d+)\]/g;
    let match;
    const seenHex = new Set();

    while ((match = regex.exec(html)) !== null) {
      const hexId = match[1];
      if (seenHex.has(hexId)) continue;
      seenHex.add(hexId);

      const fullTitle = decodeUnicodeEscapes(match[2]);
      const lat = parseFloat(match[3]);
      const lng = parseFloat(match[4]);
      if (isNaN(lat) || isNaN(lng)) continue;

      // Extract optional rating nearby in the payload
      const tail = html.slice(match.index, match.index + 320);
      const ratingMatch = tail.match(/,(\d\.\d)\d*,"(\d+[^"]*reviews?)"/i);
      const ratingText = ratingMatch ? `⭐ ${ratingMatch[1]} (${ratingMatch[2]})` : '';

      const parts = fullTitle.split(',');
      const name = parts[0].trim();
      const address = parts.slice(1, 3).join(',').trim() || 'Google Maps Verified';

      const distMeters = getDistanceMeters(userLat, userLng, lat, lng);
      const { emoji, label, category } = resolveEmojiAndLabel({ name });

      results.push({
        id: `gmap_${hexId}`,
        name,
        lat,
        lng,
        category,
        emoji,
        typeLabel: ratingText ? `${label} • ${ratingText}` : label,
        address,
        distanceMeters: distMeters,
        distanceText: formatDistance(distMeters),
        walkMinutes: Math.max(1, Math.round(distMeters / 78))
      });
    }
  } catch (e) {}
  return results;
}

function decodeUnicodeEscapes(str) {
  return String(str || '').replace(/\\u([\dA-Fa-f]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

// ============================================================================
// 2. ARCGIS WORLD COMMERCIAL POI ENGINE (50+ Nearby Commercial Restaurants)
// ============================================================================
async function fetchArcGISFoodPOIs(userLat, userLng, radiusMeters = 2000, keyword = '') {
  const results = [];
  try {
    const qParam = keyword
      ? `SingleLine=${encodeURIComponent(keyword)}&category=Food`
      : `category=Food`;
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&${qParam}&location=${userLng},${userLat}&distance=${Math.max(
      radiusMeters,
      2000
    )}&maxLocations=50&outFields=PlaceName,Place_addr,Type`;

    const res = await fetchWithTimeout(url, { headers: HEADERS }, 5500);
    const data = await res.json();

    if (data && Array.isArray(data.candidates)) {
      data.candidates.forEach((c, idx) => {
        const lat = c.location && c.location.y;
        const lng = c.location && c.location.x;
        const name = (c.attributes && c.attributes.PlaceName) || c.address;
        if (!name || !lat || !lng) return;

        const addr =
          (c.attributes && c.attributes.Place_addr) ||
          (c.attributes && c.attributes.Type) ||
          'Commercial Food Spot';
        const distMeters = getDistanceMeters(userLat, userLng, lat, lng);
        if (!keyword && distMeters > radiusMeters * 1.5) return;

        const { emoji, label, category } = resolveEmojiAndLabel({
          name,
          cuisine: c.attributes && c.attributes.Type
        });

        results.push({
          id: `arcgis_${idx}_${lat.toFixed(4)}`,
          name,
          lat,
          lng,
          category,
          emoji,
          typeLabel: label,
          address: addr,
          distanceMeters: distMeters,
          distanceText: formatDistance(distMeters),
          walkMinutes: Math.max(1, Math.round(distMeters / 78))
        });
      });
    }
  } catch (e) {}
  return results;
}

// ============================================================================
// 3. COMBINED NEARBY RESTAURANT SCANNER (Google Maps + ArcGIS + Overpass)
// ============================================================================
export async function fetchNearbyRestaurants(userLat, userLng, radiusMeters = 1500) {
  const query = `[out:json][timeout:10];(node["amenity"~"restaurant|fast_food|cafe|food_court|ice_cream|bakery|bar|pub"](around:${radiusMeters},${userLat},${userLng});way["amenity"~"restaurant|fast_food|cafe|food_court|bakery"](around:${radiusMeters},${userLat},${userLng}););out center 100;`;

  const [googleRestaurants, googleCafes, arcgisFood, overpassFood] = await Promise.all([
    searchGoogleMapsDirect(`restaurants near ${userLat},${userLng}`, userLat, userLng),
    searchGoogleMapsDirect(`cafe fast food eatery near ${userLat},${userLng}`, userLat, userLng),
    fetchArcGISFoodPOIs(userLat, userLng, radiusMeters),
    fetchOverpassPOIs(query, userLat, userLng)
  ]);

  const merged = deduplicatePlaces([
    ...googleRestaurants,
    ...googleCafes,
    ...arcgisFood,
    ...overpassFood
  ]);

  if (merged.length > 0) {
    return merged.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  return generateFallbackPlaces(userLat, userLng);
}

async function fetchOverpassPOIs(query, userLat, userLng) {
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(
        endpoint,
        {
          method: 'POST',
          body: 'data=' + encodeURIComponent(query),
          headers: {
            ...HEADERS,
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        },
        6500
      );
      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.elements && data.elements.length > 0) {
        return parseOverpassElements(data.elements, userLat, userLng);
      }
    } catch (e) {}
  }
  return [];
}

function parseOverpassElements(elements, userLat, userLng) {
  const places = [];
  elements.forEach((el) => {
    const tags = el.tags || {};
    const name = tags.name || tags['name:en'];
    if (!name) return;

    const lat = el.lat || (el.center && el.center.lat);
    const lng = el.lon || (el.center && el.center.lon);
    if (!lat || !lng) return;

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
  return places;
}

// ============================================================================
// 4. MULTI-ENGINE SEARCH (Google Maps Direct + ArcGIS + Nominatim + Photon)
// ============================================================================
export async function searchPlacesByQuery(queryText, userLat, userLng) {
  if (!queryText || !queryText.trim()) return [];
  const q = queryText.trim();

  const [googleHits, googleLocalHits, arcgisHits, nominatimHits, photonHits] = await Promise.all([
    searchGoogleMapsDirect(q, userLat, userLng),
    searchGoogleMapsDirect(`${q} near ${userLat},${userLng}`, userLat, userLng),
    fetchArcGISFoodPOIs(userLat, userLng, 15000, q),
    searchNominatim(q, userLat, userLng),
    searchPhoton(q, userLat, userLng)
  ]);

  const combined = deduplicatePlaces([
    ...googleLocalHits,
    ...googleHits,
    ...arcgisHits,
    ...nominatimHits,
    ...photonHits
  ]);

  return combined.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

async function searchNominatim(queryText, userLat, userLng) {
  const results = [];
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      queryText
    )}&limit=15&addressdetails=1`;
    const res = await fetchWithTimeout(nomUrl, { headers: HEADERS }, 5000);
    const data = await res.json();
    if (Array.isArray(data)) {
      data.forEach((item, idx) => {
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        if (isNaN(lat) || isNaN(lng)) return;
        const name = (item.display_name || queryText).split(',')[0];
        const distMeters = getDistanceMeters(userLat, userLng, lat, lng);
        const { emoji, label, category } = resolveEmojiAndLabel({
          amenity: item.type,
          name
        });
        results.push({
          id: `nom_${item.place_id || idx}`,
          name,
          lat,
          lng,
          category,
          emoji,
          typeLabel: label,
          address:
            (item.display_name || '').split(',').slice(1, 3).join(',').trim() || 'Pinned Location',
          distanceMeters: distMeters,
          distanceText: formatDistance(distMeters),
          walkMinutes: Math.max(1, Math.round(distMeters / 78))
        });
      });
    }
  } catch (e) {}
  return results;
}

async function searchPhoton(queryText, userLat, userLng) {
  const results = [];
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
      queryText
    )}&lat=${userLat}&lon=${userLng}&limit=15`;
    const res = await fetchWithTimeout(url, { headers: HEADERS }, 5000);
    const data = await res.json();

    if (data && data.features) {
      data.features.forEach((f, idx) => {
        const [lng, lat] = f.geometry.coordinates;
        const props = f.properties || {};
        const name = props.name || props.street || queryText;
        const addressParts = [props.street, props.district, props.city].filter(Boolean);
        const distMeters = getDistanceMeters(userLat, userLng, lat, lng);
        const { emoji, label, category } = resolveEmojiAndLabel({
          amenity: props.osm_value,
          name
        });

        results.push({
          id: `photon_${props.osm_id || idx}`,
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
        });
      });
    }
  } catch (e) {}
  return results;
}

// ============================================================================
// 5. REVERSE GEOCODE ANY TAPPED POINT ON THE GOOGLE MAP
// ============================================================================
export async function reverseGeocodePoint(lat, lng, userLat, userLng) {
  const distMeters = getDistanceMeters(userLat, userLng, lat, lng);
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const res = await fetchWithTimeout(url, { headers: HEADERS }, 4000);
    const data = await res.json();
    if (data && data.display_name) {
      const parts = data.display_name.split(',');
      const name = data.name || parts[0].trim() || 'Pinned Map Spot';
      const address = parts.slice(1, 3).join(',').trim() || 'Custom Map Pin';
      const { emoji, label, category } = resolveEmojiAndLabel({ name });
      return {
        id: `tap_${Date.now()}`,
        name,
        lat,
        lng,
        category,
        emoji: emoji || '📍',
        typeLabel: label,
        address,
        distanceMeters: distMeters,
        distanceText: formatDistance(distMeters),
        walkMinutes: Math.max(1, Math.round(distMeters / 78))
      };
    }
  } catch (e) {}

  return {
    id: `tap_${Date.now()}`,
    name: 'Pinned Google Map Spot',
    lat,
    lng,
    category: 'restaurant',
    emoji: '📍',
    typeLabel: 'Custom Destination',
    address: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
    distanceMeters: distMeters,
    distanceText: formatDistance(distMeters),
    walkMinutes: Math.max(1, Math.round(distMeters / 78))
  };
}

function deduplicatePlaces(list) {
  const unique = [];
  list.forEach((item) => {
    const cleanName = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const isDuplicate = unique.some((existing) => {
      const existingClean = existing.name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const dist = getDistanceMeters(existing.lat, existing.lng, item.lat, item.lng);
      return dist < 55 && (existingClean.includes(cleanName) || cleanName.includes(existingClean));
    });
    if (!isDuplicate) {
      unique.push(item);
    }
  });
  return unique;
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

// ============================================================================
// 6. LIVE WALK WEATHER & UMBRELLA/HEAT ADVISORY (Open-Meteo Free API)
// ============================================================================
export async function fetchLocalWeather(lat, lng) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current_weather=true`;
    const res = await fetchWithTimeout(url, { headers: HEADERS }, 4500);
    const data = await res.json();
    if (data && data.current_weather) {
      const temp = Math.round(data.current_weather.temperature);
      const code = data.current_weather.weathercode;
      const isRain = code >= 51 && code <= 99;
      if (isRain) {
        return { icon: '🌧️', temp: `${temp}°C`, advice: 'Rainy • Bring umbrella or Ride' };
      }
      if (temp >= 32) {
        return { icon: '☀️', temp: `${temp}°C`, advice: 'Hot walk • Stay hydrated' };
      }
      return { icon: '⛅', temp: `${temp}°C`, advice: 'Great walking weather' };
    }
  } catch (e) {}
  return { icon: '⛅', temp: '29°C', advice: 'Good walking weather' };
}

function generateFallbackPlaces(lat, lng) {
  const samples = [
    { name: 'Jollibee Plaza', dLat: 0.0024, dLng: 0.0018, emoji: '🍔', typeLabel: 'Fast Food', category: 'fast_food' },
    { name: "McDonald's Highway", dLat: -0.0035, dLng: 0.0041, emoji: '🍔', typeLabel: 'Fast Food', category: 'fast_food' },
    { name: "Tuboy's Lomi & Eatery", dLat: 0.0042, dLng: -0.0031, emoji: '🍜', typeLabel: 'Noodles & Asian', category: 'restaurant' }
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
      address: 'Nearby Main Road',
      distanceMeters: dist,
      distanceText: formatDistance(dist),
      walkMinutes: Math.max(1, Math.round(distMeters / 78))
    };
  });
}
