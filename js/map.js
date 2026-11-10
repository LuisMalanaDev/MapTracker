// ============================================================================
// map.js — Leaflet Map Engine with Real Google Maps & OpenStreetMap Tiles
// ============================================================================

const MapEngine = (() => {
  let map = null;
  let userMarker = null;
  let accuracyCircle = null;
  let radiusCircle = null;
  let poiLayerGroup = null;
  let routePolyline = null;
  let routeGlowPolyline = null;
  let walkedPolyline = null;
  let currentTileMode = 'google_street';
  let tileLayer = null;
  let followUser = true;

  // 100% Free, No-Watermark Tile Servers (Works on localhost AND mobile tunnels!)
  const TILES = {
    google_street: {
      url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      attr: 'Google Maps',
      className: 'tile-google-street'
    },
    dark_mode: {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attr: '&copy; OpenStreetMap',
      className: 'tile-dark-filter'
    },
    google_satellite: {
      url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      attr: 'Google Satellite Hybrid',
      className: 'tile-google-sat'
    }
  };

  function init(initialLat = 13.9414, initialLng = 121.6234) {
    map = L.map('map', {
      zoomControl: false,
      attributionControl: false
    }).setView([initialLat, initialLng], 16);

    setTileLayer(currentTileMode);

    poiLayerGroup = L.layerGroup().addTo(map);

    // Disable auto-follow if user manually drags map
    map.on('dragstart', () => {
      followUser = false;
      const btn = document.getElementById('recenterBtn');
      if (btn) btn.classList.remove('active');
    });

    // Allow right-click to set custom start position for testing anywhere
    map.on('contextmenu', (e) => {
      if (window.GPSTracker) {
        window.GPSTracker.setManualPosition(e.latlng.lat, e.latlng.lng);
      }
    });

    return map;
  }

  function setTileLayer(modeKey) {
    if (tileLayer) map.removeLayer(tileLayer);
    const cfg = TILES[modeKey] || TILES.google_street;
    tileLayer = L.tileLayer(cfg.url, {
      maxZoom: 20,
      attribution: cfg.attr,
      className: cfg.className || ''
    }).addTo(map);
  }

  function cycleTileStyle() {
    const order = ['google_street', 'dark_mode', 'google_satellite'];
    const nextIdx = (order.indexOf(currentTileMode) + 1) % order.length;
    currentTileMode = order[nextIdx];
    setTileLayer(currentTileMode);
    return currentTileMode;
  }

  function updateUserPosition(lat, lng, accuracy = 25, radiusMeters = 1500) {
    if (!map) return;

    const latLng = [lat, lng];

    if (!userMarker) {
      const gpsIcon = L.divIcon({
        className: 'user-gps-marker',
        html: `<div class="user-gps-pulse"></div><div class="user-gps-dot"></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });

      userMarker = L.marker(latLng, { icon: gpsIcon, zIndexOffset: 1000 }).addTo(map);
      userMarker.bindTooltip('📍 You are here', {
        direction: 'top',
        offset: [0, -12]
      });

      accuracyCircle = L.circle(latLng, {
        radius: accuracy,
        color: '#3b82f6',
        weight: 1,
        fillColor: '#3b82f6',
        fillOpacity: 0.12
      }).addTo(map);

      radiusCircle = L.circle(latLng, {
        radius: radiusMeters,
        color: '#ff5722',
        weight: 1.5,
        dashArray: '6, 8',
        fillColor: '#ff5722',
        fillOpacity: 0.03
      }).addTo(map);
    } else {
      userMarker.setLatLng(latLng);
      accuracyCircle.setLatLng(latLng);
      accuracyCircle.setRadius(Math.min(accuracy, 120));
      radiusCircle.setLatLng(latLng);
      radiusCircle.setRadius(radiusMeters);
    }

    if (followUser) {
      map.panTo(latLng, { animate: true, duration: 0.5 });
    }
  }

  function setRadiusMeters(radiusMeters) {
    if (radiusCircle) {
      radiusCircle.setRadius(radiusMeters);
    }
  }

  function recenterOnUser(lat, lng) {
    followUser = true;
    const btn = document.getElementById('recenterBtn');
    if (btn) btn.classList.add('active');
    if (map && lat && lng) {
      map.flyTo([lat, lng], Math.max(map.getZoom(), 16), { duration: 0.8 });
    }
  }

  function renderPOIMarkers(places, selectedId, onSelectPlace) {
    if (!poiLayerGroup) return;
    poiLayerGroup.clearLayers();

    places.forEach((place) => {
      const isSelected = place.id === selectedId;
      let catClass = '';
      if (place.category === 'cafe') catClass = 'cafe-pin';
      if (place.category === 'fast_food') catClass = 'fastfood-pin';

      const icon = L.divIcon({
        className: 'custom-poi-wrapper',
        html: `<div class="poi-marker ${catClass} ${isSelected ? 'active-pin' : ''}">
                 <span>${place.emoji || '🍴'}</span>
               </div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 38],
        popupAnchor: [0, -38]
      });

      const marker = L.marker([place.lat, place.lng], {
        icon,
        zIndexOffset: isSelected ? 900 : 100
      });

      marker.on('click', () => {
        if (onSelectPlace) onSelectPlace(place);
      });

      marker.bindTooltip(`<b>${place.name}</b><br>${place.distanceText}`, {
        direction: 'top',
        offset: [0, -34]
      });

      poiLayerGroup.addLayer(marker);
    });
  }

  function drawRoute(coordsLatLng, fitView = true) {
    clearRoute();
    if (!map || !coordsLatLng || coordsLatLng.length === 0) return;

    // Outer glow line
    routeGlowPolyline = L.polyline(coordsLatLng, {
      color: '#059669',
      weight: 12,
      opacity: 0.35,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // Main street path line
    routePolyline = L.polyline(coordsLatLng, {
      color: '#10b981',
      weight: 6,
      opacity: 0.98,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    if (fitView) {
      followUser = false;
      map.fitBounds(routePolyline.getBounds(), { padding: [60, 60], maxZoom: 18 });
    }
  }

  function updateWalkedPath(remainingCoords, walkedCoords) {
    if (!map) return;
    if (routePolyline && remainingCoords.length > 1) {
      routePolyline.setLatLngs(remainingCoords);
      routeGlowPolyline.setLatLngs(remainingCoords);
    }
    if (walkedCoords && walkedCoords.length > 1) {
      if (!walkedPolyline) {
        walkedPolyline = L.polyline(walkedCoords, {
          color: '#475569',
          weight: 5,
          dashArray: '6, 8',
          opacity: 0.8
        }).addTo(map);
      } else {
        walkedPolyline.setLatLngs(walkedCoords);
      }
    }
  }

  function clearRoute() {
    if (routePolyline) { map.removeLayer(routePolyline); routePolyline = null; }
    if (routeGlowPolyline) { map.removeLayer(routeGlowPolyline); routeGlowPolyline = null; }
    if (walkedPolyline) { map.removeLayer(walkedPolyline); walkedPolyline = null; }
  }

  function flyToPlace(lat, lng) {
    if (!map) return;
    followUser = false;
    map.flyTo([lat, lng], 17, { duration: 0.9 });
  }

  return {
    init,
    cycleTileStyle,
    updateUserPosition,
    setRadiusMeters,
    recenterOnUser,
    renderPOIMarkers,
    drawRoute,
    updateWalkedPath,
    clearRoute,
    flyToPlace
  };
})();

window.MapEngine = MapEngine;
