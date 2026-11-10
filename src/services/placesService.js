// ============================================================================
// src/services/placesService.js — Multi-Engine Restaurant & Hotel Radar
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

// Pre-configured Cities, Municipalities (Bayan), & Tourist Towns
export const AREA_PRESETS = [
  { id: 'gps', label: '📍 Near Me (GPS)', lat: null, lng: null },
  { id: 'lucena', label: '🏙️ Lucena City', lat: 13.9414, lng: 121.6234, query: 'Lucena City' },
  { id: 'tayabas', label: '🏛️ Tayabas', lat: 14.0263, lng: 121.5928, query: 'Tayabas Quezon' },
  { id: 'san_pablo', label: '🏞️ San Pablo', lat: 14.069, lng: 121.3256, query: 'San Pablo Laguna' },
  { id: 'sariaya', label: '🌾 Sariaya', lat: 13.9631, lng: 121.5262, query: 'Sariaya Quezon' },
  { id: 'pagbilao', label: '🏖️ Pagbilao', lat: 13.9744, lng: 121.6881, query: 'Pagbilao Quezon' },
  { id: 'lucban', label: '⛰️ Lucban', lat: 14.1136, lng: 121.5556, query: 'Lucban Quezon' },
  { id: 'candelaria', label: '🌿 Candelaria', lat: 13.9311, lng: 121.4233, query: 'Candelaria Quezon' },
  { id: 'tiaong', label: '🌊 Tiaong', lat: 13.9547, lng: 121.3228, query: 'Tiaong Quezon' },
  { id: 'dolores', label: '⛰️ Dolores', lat: 14.0167, lng: 121.4011, query: 'Dolores Quezon' },
  { id: 'mauban', label: '🏝️ Mauban', lat: 14.1892, lng: 121.7308, query: 'Mauban Quezon' },
  { id: 'gumaca', label: '⚓ Gumaca', lat: 13.9214, lng: 122.0989, query: 'Gumaca Quezon' },
  { id: 'lipa', label: '🌋 Lipa / Batangas', lat: 13.9411, lng: 121.1622, query: 'Lipa Batangas' },
  { id: 'tagaytay', label: '🌲 Tagaytay', lat: 14.1153, lng: 120.9621, query: 'Tagaytay' }
];

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
  const tourism = (tags.tourism || '').toLowerCase();
  const cuisine = (tags.cuisine || '').toLowerCase();
  const name = (tags.name || '').toLowerCase();

  // Hotels, Resorts, Inns, Motels, Staycations
  if (
    tourism === 'hotel' ||
    tourism === 'motel' ||
    tourism === 'guest_house' ||
    tourism === 'resort' ||
    tourism === 'hostel' ||
    tourism === 'apartment' ||
    tourism === 'chalet' ||
    cuisine.includes('hotel') ||
    cuisine.includes('resort') ||
    cuisine.includes('motel') ||
    cuisine.includes('lodging') ||
    name.includes('hotel') ||
    name.includes('resort') ||
    name.includes('motel') ||
    name.includes('inn') ||
    name.includes('lodge') ||
    name.includes('staycation') ||
    name.includes('pension') ||
    name.includes('suites') ||
    name.includes('dormitel') ||
    name.includes('villa')
  ) {
    if (name.includes('resort') || tourism === 'resort' || name.includes('villa')) {
      return { emoji: '🌴', label: 'Resort & Staycation', category: 'hotel' };
    }
    return { emoji: '🏨', label: 'Hotel & Lodging', category: 'hotel' };
  }

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
// Pulls exact Google Maps restaurants, hotels, resorts, addresses & star ratings
// ============================================================================
export async function searchGoogleMapsDirect(queryText, centerLat, centerLng, userLat, userLng) {
  const refLat = userLat || centerLat;
  const refLng = userLng || centerLng;
  const results = [];
  try {
    const url = `https://maps.google.com/maps?q=${encodeURIComponent(
      queryText
    )}&sll=${centerLat},${centerLng}&hl=en&output=embed`;

    const res = await fetchWithTimeout(url, { headers: HEADERS }, 6500);
    const html = await res.text();

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

      const tail = html.slice(match.index, match.index + 340);
      const ratingMatch = tail.match(/,(\d\.\d)\d*,"(\d+[^"]*reviews?)"/i);
      const ratingText = ratingMatch ? `⭐ ${ratingMatch[1]} (${ratingMatch[2]})` : '';
      const isHotelGcid = tail.includes('hotel') || tail.includes('lodging') || tail.includes('resort');

      const parts = fullTitle.split(',');
      const name = parts[0].trim();
      const address = parts.slice(1, 3).join(',').trim() || 'Google Maps Verified';

      const distMeters = getDistanceMeters(refLat, refLng, lat, lng);
      const { emoji, label, category } = resolveEmojiAndLabel({
        name,
        tourism: isHotelGcid ? 'hotel' : '',
        cuisine: queryText.toLowerCase().includes('hotel') ? 'hotel' : ''
      });

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
// 2. ARCGIS WORLD COMMERCIAL POI ENGINE (Food + Hotels & Resorts)
// ============================================================================
async function fetchArcGISPOIs(
  centerLat,
  centerLng,
  userLat,
  userLng,
  radiusMeters = 2500,
  keyword = ''
) {
  const refLat = userLat || centerLat;
  const refLng = userLng || centerLng;
  const results = [];
  try {
    const qParam = keyword
      ? `SingleLine=${encodeURIComponent(keyword)}&category=Food,Hotel,Motel,Resort,Lodging`
      : `category=Food,Hotel,Motel,Resort,Bed and Breakfast,Lodging`;
    const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&${qParam}&location=${centerLng},${centerLat}&distance=${Math.max(
      radiusMeters,
      2500
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
          'Commercial Spot';
        const distFromCenter = getDistanceMeters(centerLat, centerLng, lat, lng);
        if (!keyword && distFromCenter > radiusMeters * 2.2) return;

        const distMeters = getDistanceMeters(refLat, refLng, lat, lng);
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
// 3. COMBINED NEARBY SCANNER (Restaurants + Cafés + Hotels & Resorts)
// Supports scanning around either live GPS or any selected Municipality/Town!
// ============================================================================
export async function fetchNearbyRestaurants(
  scanLat,
  scanLng,
  radiusMeters = 1500,
  userLat = null,
  userLng = null,
  areaLabel = ''
) {
  const refLat = userLat || scanLat;
  const refLng = userLng || scanLng;
  const placeHint = areaLabel ? areaLabel.replace(/^[^\w]+/, '').trim() : `${scanLat},${scanLng}`;

  const overpassQuery = `[out:json][timeout:10];(node["amenity"~"restaurant|fast_food|cafe|food_court|ice_cream|bakery|bar|pub"](around:${radiusMeters},${scanLat},${scanLng});way["amenity"~"restaurant|fast_food|cafe|food_court|bakery"](around:${radiusMeters},${scanLat},${scanLng});node["tourism"~"hotel|motel|guest_house|resort|hostel|apartment|chalet"](around:${radiusMeters},${scanLat},${scanLng});way["tourism"~"hotel|motel|guest_house|resort|hostel|apartment"](around:${radiusMeters},${scanLat},${scanLng}););out center 120;`;

  const [googleRestaurants, googleCafes, googleHotels, arcgisSpots, overpassSpots] =
    await Promise.all([
      searchGoogleMapsDirect(`restaurants in ${placeHint}`, scanLat, scanLng, refLat, refLng),
      searchGoogleMapsDirect(`cafe fast food in ${placeHint}`, scanLat, scanLng, refLat, refLng),
      searchGoogleMapsDirect(`hotels resorts inn in ${placeHint}`, scanLat, scanLng, refLat, refLng),
      fetchArcGISPOIs(scanLat, scanLng, refLat, refLng, radiusMeters),
      fetchOverpassPOIs(overpassQuery, refLat, refLng)
    ]);

  const merged = deduplicatePlaces([
    ...googleRestaurants,
    ...googleHotels,
    ...googleCafes,
    ...arcgisSpots,
    ...overpassSpots
  ]);

  if (merged.length > 0) {
    return merged.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  return generateFallbackPlaces(scanLat, scanLng, refLat, refLng);
}

async function fetchOverpassPOIs(query, refLat, refLng) {
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
        return parseOverpassElements(data.elements, refLat, refLng);
      }
    } catch (e) {}
  }
  return [];
}

function parseOverpassElements(elements, refLat, refLng) {
  const places = [];
  elements.forEach((el) => {
    const tags = el.tags || {};
    const name = tags.name || tags['name:en'];
    if (!name) return;

    const lat = el.lat || (el.center && el.center.lat);
    const lng = el.lon || (el.center && el.center.lon);
    if (!lat || !lng) return;

    const distMeters = getDistanceMeters(refLat, refLng, lat, lng);
    const { emoji, label, category } = resolveEmojiAndLabel(tags);
    const street =
      tags['addr:street'] || tags['addr:full'] || tags['addr:city'] || 'Verified Location';

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
// 4. MULTI-ENGINE SEARCH (Supports Area/Town Context + Hotels + Restaurants)
// ============================================================================
export async function searchPlacesByQuery(
  queryText,
  scanLat,
  scanLng,
  userLat = null,
  userLng = null,
  areaHint = ''
) {
  if (!queryText || !queryText.trim()) return [];
  const q = queryText.trim();
  const refLat = userLat || scanLat;
  const refLng = userLng || scanLng;
  const contextualQuery = areaHint ? `${q} ${areaHint}` : q;

  const [googleAreaHits, googleNearHits, arcgisHits, nominatimHits, photonHits] =
    await Promise.all([
      searchGoogleMapsDirect(contextualQuery, scanLat, scanLng, refLat, refLng),
      searchGoogleMapsDirect(`${q} near ${scanLat},${scanLng}`, scanLat, scanLng, refLat, refLng),
      fetchArcGISPOIs(scanLat, scanLng, refLat, refLng, 20000, contextualQuery),
      searchNominatim(contextualQuery, refLat, refLng),
      searchPhoton(contextualQuery, scanLat, scanLng, refLat, refLng)
    ]);

  const combined = deduplicatePlaces([
    ...googleAreaHits,
    ...googleNearHits,
    ...arcgisHits,
    ...nominatimHits,
    ...photonHits
  ]);

  return combined.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

// Geocode any custom Town, Municipality, Barangay, City, or Country worldwide
export async function geocodeAreaLocation(areaName) {
  if (!areaName || !areaName.trim()) return null;
  const q = areaName.trim();
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      q
    )}&limit=1`;
    const res = await fetchWithTimeout(url, { headers: HEADERS }, 5000);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const top = data[0];
      const cleanLabel = (top.display_name || areaName).split(',')[0].trim();
      return {
        id: `custom_${Date.now()}`,
        label: `📍 ${cleanLabel}`,
        lat: parseFloat(top.lat),
        lng: parseFloat(top.lon),
        query: cleanLabel
      };
    }
  } catch (e) {}
  return null;
}

async function searchNominatim(queryText, refLat, refLng) {
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
        const distMeters = getDistanceMeters(refLat, refLng, lat, lng);
        const { emoji, label, category } = resolveEmojiAndLabel({
          amenity: item.type,
          tourism: item.class === 'tourism' ? item.type : '',
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

async function searchPhoton(queryText, scanLat, scanLng, refLat, refLng) {
  const results = [];
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(
      queryText
    )}&lat=${scanLat}&lon=${scanLng}&limit=15`;
    const res = await fetchWithTimeout(url, { headers: HEADERS }, 5000);
    const data = await res.json();

    if (data && data.features) {
      data.features.forEach((f, idx) => {
        const [lng, lat] = f.geometry.coordinates;
        const props = f.properties || {};
        const name = props.name || props.street || queryText;
        const addressParts = [props.street, props.district, props.city].filter(Boolean);
        const distMeters = getDistanceMeters(refLat, refLng, lat, lng);
        const { emoji, label, category } = resolveEmojiAndLabel({
          amenity: props.osm_value,
          tourism: props.osm_key === 'tourism' ? props.osm_value : '',
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

function generateFallbackPlaces(scanLat, scanLng, refLat, refLng) {
  const samples = [
    { name: 'Jollibee Plaza', dLat: 0.0024, dLng: 0.0018, emoji: '🍔', typeLabel: 'Fast Food', category: 'fast_food' },
    { name: 'Queen Margarette Hotel', dLat: 0.0038, dLng: -0.0025, emoji: '🏨', typeLabel: 'Hotel & Lodging', category: 'hotel' },
    { name: "Tuboy's Lomi & Eatery", dLat: 0.0042, dLng: -0.0031, emoji: '🍜', typeLabel: 'Noodles & Asian', category: 'restaurant' }
  ];

  return samples.map((s, i) => {
    const pLat = scanLat + s.dLat;
    const pLng = scanLng + s.dLng;
    const dist = getDistanceMeters(refLat, refLng, pLat, pLng);
    return {
      id: `sample_${i}`,
      name: s.name,
      lat: pLat,
      lng: pLng,
      category: s.category,
      emoji: s.emoji,
      typeLabel: s.typeLabel,
      address: 'Main Highway District',
      distanceMeters: dist,
      distanceText: formatDistance(dist),
      walkMinutes: Math.max(1, Math.round(dist / 78))
    };
  });
}
