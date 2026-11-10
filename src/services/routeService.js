// ============================================================================
// src/services/routeService.js — OSRM Street Routing & Live Walk Progress
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

export async function calculateStreetRoute(userLat, userLng, place, travelMode = 'foot') {
  const profile = travelMode === 'driving' ? 'driving' : 'foot';
  const url = `https://router.project-osrm.org/route/v1/${profile}/${userLng},${userLat};${place.lng},${place.lat}?overview=full&geometries=geojson&steps=true`;

  try {
    const res = await fetch(url);
    const data = await res.json();

    if (data && data.routes && data.routes.length > 0) {
      const route = data.routes[0];
      const coordsLatLng = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
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

      const totalDist = route.distance || getDistanceMeters(userLat, userLng, place.lat, place.lng);
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
  } catch (e) {}

  // Fallback straight line if routing server is offline
  const directDist = getDistanceMeters(userLat, userLng, place.lat, place.lng);
  return {
    coords: [
      [userLat, userLng],
      [place.lat, place.lng]
    ],
    steps: [
      {
        index: 0,
        instruction: `Walk directly toward ${place.name}`,
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

export function computeLiveWalkState(userLat, userLng, routeData, destPlace, travelMode = 'foot') {
  if (!routeData || !destPlace) return null;

  const coords = routeData.coords;
  let closestIdx = 0;
  let minPointDist = Infinity;

  for (let i = 0; i < coords.length; i++) {
    const d = getDistanceMeters(userLat, userLng, coords[i][0], coords[i][1]);
    if (d < minPointDist) {
      minPointDist = d;
      closestIdx = i;
    }
  }

  let remainingAlongPath = getDistanceMeters(userLat, userLng, coords[closestIdx][0], coords[closestIdx][1]);
  for (let i = closestIdx; i < coords.length - 1; i++) {
    remainingAlongPath += getDistanceMeters(
      coords[i][0],
      coords[i][1],
      coords[i + 1][0],
      coords[i + 1][1]
    );
  }

  const directToDest = getDistanceMeters(userLat, userLng, destPlace.lat, destPlace.lng);
  const effectiveRemaining = Math.min(remainingAlongPath, directToDest * 1.35);
  const initialDist = routeData.initialDistanceMeters || 100;

  const progressPercent =
    directToDest <= 24
      ? 100
      : Math.min(100, Math.max(0, Math.round(((initialDist - effectiveRemaining) / initialDist) * 100)));

  const remainingMins =
    travelMode === 'driving'
      ? Math.max(1, Math.ceil(effectiveRemaining / 450))
      : Math.max(1, Math.ceil(effectiveRemaining / 78));

  let activeStepIdx = 0;
  let minStepDist = Infinity;
  routeData.steps.forEach((step, idx) => {
    const sd = getDistanceMeters(userLat, userLng, step.location[0], step.location[1]);
    if (sd < minStepDist) {
      minStepDist = sd;
      activeStepIdx = idx;
    }
  });

  const currentStep = routeData.steps[activeStepIdx] || routeData.steps[0];
  const walkedCoords = coords.slice(0, closestIdx + 1);
  const remainingCoords = [[userLat, userLng], ...coords.slice(closestIdx + 1)];

  return {
    remainingMeters: effectiveRemaining,
    remainingText: formatDistance(effectiveRemaining),
    remainingMins,
    progressPercent,
    currentStep,
    activeStepIdx,
    steps: routeData.steps,
    walkedCoords,
    remainingCoords,
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
