// ============================================================================
// src/services/routeService.js — Multi-Engine Street Routing & Live Rerouting
// Includes: Exact Street Segment Snapping + Automatic Off-Route Detection
// ============================================================================

import { getDistanceMeters, formatDistance } from './placesService';

function getTurnIcon(maneuver) {
  if (!maneuver) return '⬆️';
  const mod = maneuver.modifier || '';
  const type = maneuver.type || '';
  if (type === 'arrive') return '🏁';
  if (mod.includes('left')) return '⬅️';
  if (mod.includes('right')) return '➡️';
  if (mod.includes('uturn')) return '↩️';
  return '⬆️';
}

function formatStepInstruction(step, destName) {
  const m = step.maneuver || {};
  const street = step.name ? ` onto ${step.name}` : '';
  const type = m.type || 'continue';
  const mod = m.modifier ? ` ${m.modifier}` : '';

  if (type === 'depart') return `Head${mod}${street || ' along the street'}`;
  if (type === 'arrive') return `Arrive at ${destName || 'destination'}`;
  if (type === 'turn') return `Turn${mod}${street}`;
  if (type === 'new name' || type === 'continue') return `Continue${mod}${street}`;
  if (type === 'roundabout') return `Take the roundabout${street}`;
  return `Proceed${mod}${street}`;
}

async function fetchWithTimeout(url, timeoutMs = 5500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

export async function calculateStreetRoute(userLat, userLng, place, travelMode = 'foot') {
  const endpoints =
    travelMode === 'driving'
      ? [
          `https://routing.openstreetmap.de/routed-car/route/v1/driving/${userLng},${userLat};${place.lng},${place.lat}?overview=full&geometries=geojson&steps=true`,
          `https://router.project-osrm.org/route/v1/driving/${userLng},${userLat};${place.lng},${place.lat}?overview=full&geometries=geojson&steps=true`
        ]
      : [
          `https://routing.openstreetmap.de/routed-foot/route/v1/foot/${userLng},${userLat};${place.lng},${place.lat}?overview=full&geometries=geojson&steps=true`,
          `https://router.project-osrm.org/route/v1/foot/${userLng},${userLat};${place.lng},${place.lat}?overview=full&geometries=geojson&steps=true`,
          `https://routing.openstreetmap.de/routed-car/route/v1/driving/${userLng},${userLat};${place.lng},${place.lat}?overview=full&geometries=geojson&steps=true`
        ];

  for (const url of endpoints) {
    const data = await fetchWithTimeout(url, 5500);
    if (data && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const coordsLatLng = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
      if (coordsLatLng.length >= 2) {
        const rawSteps = (route.legs && route.legs[0] && route.legs[0].steps) || [];

        const steps = rawSteps.map((s, idx) => ({
          index: idx,
          instruction: formatStepInstruction(s, place.name),
          icon: getTurnIcon(s.maneuver),
          distanceMeters: s.distance || 0,
          distanceText: formatDistance(s.distance || 0),
          location:
            s.maneuver && s.maneuver.location
              ? [s.maneuver.location[1], s.maneuver.location[0]]
              : coordsLatLng[0]
        }));

        const totalDist =
          route.distance || getDistanceMeters(userLat, userLng, place.lat, place.lng);
        const durationMinutes =
          travelMode === 'driving'
            ? Math.max(1, Math.round(totalDist / 450))
            : Math.max(1, Math.round(totalDist / 78));

        return {
          coords: coordsLatLng,
          steps,
          initialDistanceMeters: Math.max(totalDist, 10),
          totalDistanceMeters: totalDist,
          durationMinutes
        };
      }
    }
  }

  // Fallback only if device is completely offline
  const directDist = getDistanceMeters(userLat, userLng, place.lat, place.lng);
  return {
    coords: [
      [userLat, userLng],
      [place.lat, place.lng]
    ],
    steps: [
      {
        index: 0,
        instruction: `Head toward ${place.name}`,
        icon: '⬆️',
        distanceMeters: directDist,
        distanceText: formatDistance(directDist),
        location: [userLat, userLng]
      },
      {
        index: 1,
        instruction: `Arrive at ${place.name}`,
        icon: '🏁',
        distanceMeters: 0,
        distanceText: '0 m',
        location: [place.lat, place.lng]
      }
    ],
    initialDistanceMeters: Math.max(directDist, 10),
    totalDistanceMeters: directDist,
    durationMinutes: Math.max(1, Math.round(directDist / 78))
  };
}

// Project user position onto the exact closest point on road segment AB
function projectOntoSegment(pLat, pLng, aLat, aLng, bLat, bLng) {
  const dx = bLng - aLng;
  const dy = bLat - aLat;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    return {
      lat: aLat,
      lng: aLng,
      t: 0,
      distMeters: getDistanceMeters(pLat, pLng, aLat, aLng)
    };
  }
  let t = ((pLng - aLng) * dx + (pLat - aLat) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projLat = aLat + t * dy;
  const projLng = aLng + t * dx;
  return {
    lat: projLat,
    lng: projLng,
    t,
    distMeters: getDistanceMeters(pLat, pLng, projLat, projLng)
  };
}

export function computeLiveWalkState(userLat, userLng, routeData, destPlace, travelMode = 'foot') {
  if (!routeData || !destPlace || !routeData.coords || routeData.coords.length === 0) return null;

  const coords = routeData.coords;
  let bestSegIdx = 0;
  let bestProj = {
    lat: coords[0][0],
    lng: coords[0][1],
    t: 0,
    distMeters: getDistanceMeters(userLat, userLng, coords[0][0], coords[0][1])
  };

  for (let i = 0; i < coords.length - 1; i++) {
    const proj = projectOntoSegment(
      userLat,
      userLng,
      coords[i][0],
      coords[i][1],
      coords[i + 1][0],
      coords[i + 1][1]
    );
    if (proj.distMeters < bestProj.distMeters) {
      bestProj = proj;
      bestSegIdx = i;
    }
  }

  // Calculate remaining distance along the street path starting from the projected road point
  let remainingAlongPath = getDistanceMeters(
    bestProj.lat,
    bestProj.lng,
    coords[bestSegIdx + 1] ? coords[bestSegIdx + 1][0] : coords[bestSegIdx][0],
    coords[bestSegIdx + 1] ? coords[bestSegIdx + 1][1] : coords[bestSegIdx][1]
  );
  for (let i = bestSegIdx + 1; i < coords.length - 1; i++) {
    remainingAlongPath += getDistanceMeters(
      coords[i][0],
      coords[i][1],
      coords[i + 1][0],
      coords[i + 1][1]
    );
  }

  const directToDest = getDistanceMeters(userLat, userLng, destPlace.lat, destPlace.lng);
  const effectiveRemaining = Math.max(directToDest * 0.85, remainingAlongPath);
  const initialDist = routeData.initialDistanceMeters || Math.max(effectiveRemaining, 100);

  const progressPercent =
    directToDest <= 24
      ? 100
      : Math.min(
          100,
          Math.max(0, Math.round(((initialDist - effectiveRemaining) / initialDist) * 100))
        );

  const remainingMins =
    travelMode === 'driving'
      ? Math.max(1, Math.ceil(effectiveRemaining / 450))
      : Math.max(1, Math.ceil(effectiveRemaining / 78));

  let activeStepIdx = 0;
  let minStepDist = Infinity;
  (routeData.steps || []).forEach((step, idx) => {
    const sd = getDistanceMeters(userLat, userLng, step.location[0], step.location[1]);
    if (sd < minStepDist) {
      minStepDist = sd;
      activeStepIdx = idx;
    }
  });

  const currentStep = (routeData.steps && routeData.steps[activeStepIdx]) ||
    (routeData.steps && routeData.steps[0]) || {
      icon: '⬆️',
      instruction: `Head to ${destPlace.name}`
    };

  // Start the remaining green street line from the exact projected road point (never cut across blocks!)
  const walkedCoords = [...coords.slice(0, bestSegIdx + 1), [bestProj.lat, bestProj.lng]];
  const remainingCoords = [[bestProj.lat, bestProj.lng], ...coords.slice(bestSegIdx + 1)];

  // If the user walked/drove onto a different street (> 25m away from the current road line), flag for live reroute!
  const needsReroute = bestProj.distMeters > 25 && directToDest > 35;

  return {
    remainingMeters: effectiveRemaining,
    remainingText: formatDistance(effectiveRemaining),
    remainingMins,
    progressPercent,
    currentStep,
    activeStepIdx,
    steps: routeData.steps || [],
    walkedCoords,
    remainingCoords,
    offRouteMeters: Math.round(bestProj.distMeters),
    needsReroute,
    isArrived: directToDest <= 24
  };
}

export function interpolateRouteSteps(coords, maxStepDeg = 0.00012) {
  const result = [];
  for (let i = 0; i < coords.length - 1; i++) {
    const [lat1, lng1] = coords[i];
    const [lat2, lng2] = coords[i + 1];
    const dLat = lat2 - lat1;
    const dLng = lng2 - lng1;
    const dist = Math.hypot(dLat, dLng);
    const steps = Math.max(1, Math.ceil(dist / maxStepDeg));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      result.push([lat1 + dLat * t, lng1 + dLng * t]);
    }
  }
  result.push(coords[coords.length - 1]);
  return result;
}

// Calculates exact compass bearing (0-360 deg) from point A to point B
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function getCompassGuidance(relativeDeg) {
  const norm = ((relativeDeg % 360) + 360) % 360;
  if (norm <= 28 || norm >= 332) return { arrow: '⬆️', label: 'Straight Ahead' };
  if (norm > 28 && norm <= 75) return { arrow: '↗️', label: 'Bear Right' };
  if (norm > 75 && norm <= 125) return { arrow: '➡️', label: 'To Your Right' };
  if (norm >= 235 && norm < 285) return { arrow: '⬅️', label: 'To Your Left' };
  if (norm >= 285 && norm < 332) return { arrow: '↖️', label: 'Bear Left' };
  return { arrow: '↩️', label: 'Behind You (Turn Around)' };
}
