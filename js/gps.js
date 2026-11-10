// ============================================================================
// gps.js — Real-Time Browser Geolocation + Street Walk Simulator
// ============================================================================

const GPSTracker = (() => {
  // Default fallback coordinates (Lucena City Proper, Philippines)
  let currentPos = {
    lat: 13.9414,
    lng: 121.6234,
    accuracy: 20,
    isRealGPS: false
  };

  let watchId = null;
  let simInterval = null;
  let isSimulating = false;
  let listeners = [];

  function onPositionUpdate(callback) {
    listeners.push(callback);
  }

  function notifyListeners(isInitial = false) {
    listeners.forEach((cb) => cb(currentPos, isInitial));
  }

  function startTracking() {
    const statusText = document.getElementById('gpsStatusText');

    if (!('geolocation' in navigator)) {
      if (statusText) statusText.textContent = 'Demo GPS Mode';
      notifyListeners(true);
      return;
    }

    // Immediate initial position fetch
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (isSimulating) return;
        currentPos = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 15,
          isRealGPS: true
        };
        if (statusText) statusText.textContent = 'Live GPS Locked';
        notifyListeners(true);
      },
      (err) => {
        console.warn('Geolocation fallback active:', err.message);
        if (statusText) statusText.textContent = 'City Center GPS';
        notifyListeners(true);
      },
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
    );

    // Continuous watchPosition for real-time walking updates (zero cache delay)
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (isSimulating) return;
        currentPos = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy || 15,
          heading: pos.coords.heading || null,
          speed: pos.coords.speed || 0,
          isRealGPS: true
        };
        if (statusText) statusText.textContent = 'Live GPS Tracking';
        notifyListeners(false);
      },
      () => {},
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000
      }
    );

    // Keep phone screen awake while walking
    if ('wakeLock' in navigator) {
      navigator.wakeLock.request('screen').catch(() => {});
    }
  }

  // Allows right-clicking on the map to teleport start point anywhere
  function setManualPosition(lat, lng) {
    stopSimulation();
    currentPos = {
      lat,
      lng,
      accuracy: 10,
      isRealGPS: false
    };
    const statusText = document.getElementById('gpsStatusText');
    if (statusText) statusText.textContent = 'Custom Pin Active';
    notifyListeners(true);
  }

  // Simulates walking along the active route polyline so user can watch distance shrink live
  function toggleSimulation(routeCoordinates) {
    if (isSimulating) {
      stopSimulation();
      return false;
    }

    if (!routeCoordinates || routeCoordinates.length < 2) return false;

    isSimulating = true;
    const statusText = document.getElementById('gpsStatusText');
    if (statusText) statusText.textContent = 'Simulating Walk...';

    // Interpolate route into smooth 12-meter steps
    const densePoints = interpolateRoute(routeCoordinates, 0.00012);
    let stepIndex = 0;

    simInterval = setInterval(() => {
      if (stepIndex >= densePoints.length) {
        stopSimulation();
        return;
      }

      const pt = densePoints[stepIndex];
      currentPos = {
        lat: pt[0],
        lng: pt[1],
        accuracy: 8,
        isRealGPS: false
      };

      notifyListeners(false);
      stepIndex++;
    }, 450);

    return true;
  }

  function stopSimulation() {
    isSimulating = false;
    if (simInterval) {
      clearInterval(simInterval);
      simInterval = null;
    }
    const simBtn = document.getElementById('simWalkBtn');
    if (simBtn) {
      simBtn.classList.remove('sim-active');
      simBtn.innerHTML = '🚶 Simulate Walk';
    }
    const statusText = document.getElementById('gpsStatusText');
    if (statusText) {
      statusText.textContent = currentPos.isRealGPS ? 'Live GPS Locked' : 'GPS Ready';
    }
  }

  function interpolateRoute(coords, maxStepDeg) {
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

  function getPosition() {
    return currentPos;
  }

  return {
    startTracking,
    onPositionUpdate,
    setManualPosition,
    toggleSimulation,
    stopSimulation,
    getPosition
  };
})();

window.GPSTracker = GPSTracker;
