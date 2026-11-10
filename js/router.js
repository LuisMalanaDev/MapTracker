// ============================================================================
// router.js — OSRM Street Routing, Turn-by-Turn Directions & Live Walk Tracker
// ============================================================================

const RouteEngine = (() => {
  let activeRoute = null;
  let destinationPlace = null;
  let initialDistanceMeters = 0;
  let travelMode = 'foot'; // 'foot' | 'driving'
  let voiceEnabled = false;
  let lastSpokenStepIdx = -1;
  let hasArrived = false;

  function setTravelMode(mode) {
    travelMode = mode;
  }

  function toggleVoice() {
    voiceEnabled = !voiceEnabled;
    if (voiceEnabled && activeRoute) {
      speakText(`Voice navigation enabled. Head toward ${destinationPlace.name}.`);
    }
    return voiceEnabled;
  }

  function speakText(text) {
    if (!voiceEnabled || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.02;
      window.speechSynthesis.speak(utter);
    } catch (e) {}
  }

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

  function formatStepInstruction(step) {
    const m = step.maneuver || {};
    const street = step.name ? ` onto ${step.name}` : '';
    const type = m.type || 'continue';
    const mod = m.modifier ? ` ${m.modifier}` : '';

    if (type === 'depart') return `Head${mod}${street || ' along the street'}`;
    if (type === 'arrive') return `Arrive at ${destinationPlace ? destinationPlace.name : 'destination'}`;
    if (type === 'turn') return `Turn${mod}${street}`;
    if (type === 'new name' || type === 'continue') return `Continue${mod}${street}`;
    if (type === 'roundabout') return `Take the roundabout${street}`;
    return `Proceed${mod}${street}`;
  }

  async function calculateRoute(userLat, userLng, place) {
    destinationPlace = place;
    hasArrived = false;
    lastSpokenStepIdx = -1;

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
          instruction: formatStepInstruction(s),
          icon: getTurnIcon(s.maneuver),
          distanceMeters: s.distance || 0,
          distanceText: window.PlacesService.formatDistance(s.distance || 0),
          location: s.maneuver && s.maneuver.location
            ? [s.maneuver.location[1], s.maneuver.location[0]]
            : coordsLatLng[0]
        }));

        // Accurate walking speed calculation (~1.3m/s = 78m/min) vs driving
        const totalDist = route.distance || window.PlacesService.getDistanceMeters(userLat, userLng, place.lat, place.lng);
        initialDistanceMeters = Math.max(totalDist, 10);

        const durationMinutes =
          travelMode === 'driving'
            ? Math.max(1, Math.round(totalDist / 450))
            : Math.max(1, Math.round(totalDist / 78));

        activeRoute = {
          coords: coordsLatLng,
          steps,
          totalDistanceMeters: totalDist,
          remainingDistanceMeters: totalDist,
          durationMinutes,
          progressPercent: 0
        };

        if (voiceEnabled && steps.length > 0) {
          speakText(`Starting route to ${place.name}. ${steps[0].instruction}.`);
        }

        return activeRoute;
      }
    } catch (err) {
      console.warn('OSRM fallback straight path:', err);
    }

    // Fallback direct path if routing server is unreachable
    const directDist = window.PlacesService.getDistanceMeters(userLat, userLng, place.lat, place.lng);
    initialDistanceMeters = Math.max(directDist, 10);
    activeRoute = {
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
          distanceText: window.PlacesService.formatDistance(directDist),
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
      totalDistanceMeters: directDist,
      remainingDistanceMeters: directDist,
      durationMinutes: Math.max(1, Math.round(directDist / 78)),
      progressPercent: 0
    };

    return activeRoute;
  }

  // Called every time the user walks / moves
  function updateLiveProgress(userLat, userLng) {
    if (!activeRoute || !destinationPlace) return null;

    const coords = activeRoute.coords;
    let closestIdx = 0;
    let minPointDist = Infinity;

    for (let i = 0; i < coords.length; i++) {
      const d = window.PlacesService.getDistanceMeters(userLat, userLng, coords[i][0], coords[i][1]);
      if (d < minPointDist) {
        minPointDist = d;
        closestIdx = i;
      }
    }

    // Calculate remaining distance along the street polyline from closestIdx to end
    let remainingAlongPath = window.PlacesService.getDistanceMeters(
      userLat,
      userLng,
      coords[closestIdx][0],
      coords[closestIdx][1]
    );

    for (let i = closestIdx; i < coords.length - 1; i++) {
      remainingAlongPath += window.PlacesService.getDistanceMeters(
        coords[i][0],
        coords[i][1],
        coords[i + 1][0],
        coords[i + 1][1]
      );
    }

    const directToDest = window.PlacesService.getDistanceMeters(
      userLat,
      userLng,
      destinationPlace.lat,
      destinationPlace.lng
    );

    const effectiveRemaining = Math.min(remainingAlongPath, directToDest * 1.35);
    const progress = Math.min(
      100,
      Math.max(0, Math.round(((initialDistanceMeters - effectiveRemaining) / initialDistanceMeters) * 100))
    );

    const remainingMins =
      travelMode === 'driving'
        ? Math.max(1, Math.ceil(effectiveRemaining / 450))
        : Math.max(1, Math.ceil(effectiveRemaining / 78));

    // Find next upcoming turn step
    let activeStepIdx = 0;
    let minStepDist = Infinity;
    activeRoute.steps.forEach((step, idx) => {
      const sd = window.PlacesService.getDistanceMeters(userLat, userLng, step.location[0], step.location[1]);
      if (sd < minStepDist) {
        minStepDist = sd;
        activeStepIdx = idx;
      }
    });

    const currentStep = activeRoute.steps[activeStepIdx] || activeRoute.steps[0];
    if (activeStepIdx !== lastSpokenStepIdx && minStepDist < 45) {
      lastSpokenStepIdx = activeStepIdx;
      speakText(currentStep.instruction);
    }

    // Split polyline into walked vs remaining
    const walkedCoords = coords.slice(0, closestIdx + 1);
    const remainingCoords = [[userLat, userLng], ...coords.slice(closestIdx + 1)];

    const justArrived = !hasArrived && directToDest <= 24;
    if (justArrived) {
      hasArrived = true;
      speakText(`You have arrived at ${destinationPlace.name}. Enjoy your meal!`);
    }

    return {
      destination: destinationPlace,
      remainingMeters: effectiveRemaining,
      remainingText: window.PlacesService.formatDistance(effectiveRemaining),
      remainingMins,
      progressPercent: directToDest <= 24 ? 100 : progress,
      currentStep,
      activeStepIdx,
      steps: activeRoute.steps,
      walkedCoords,
      remainingCoords,
      justArrived
    };
  }

  function stopNavigation() {
    activeRoute = null;
    destinationPlace = null;
    hasArrived = false;
  }

  function getActiveRoute() {
    return activeRoute;
  }

  return {
    setTravelMode,
    toggleVoice,
    calculateRoute,
    updateLiveProgress,
    stopNavigation,
    getActiveRoute
  };
})();

window.RouteEngine = RouteEngine;
