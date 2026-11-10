// ============================================================================
// src/components/MapCanvas.js — Interactive Map View for Expo & Android APK
// ============================================================================

import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

const MAP_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body, #map { width: 100%; height: 100%; background: #0d1117; overflow: hidden; }
    .tile-dark-filter { filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%); }
    .leaflet-marker-icon.user-gps-marker { transition: transform 0.55s linear; }
    .user-gps-dot {
      width: 18px; height: 18px; background: #3b82f6; border: 3px solid #fff;
      border-radius: 50%; position: absolute; top: 3px; left: 3px; z-index: 2;
      box-shadow: 0 0 14px rgba(59,130,246,0.95);
    }
    .user-gps-pulse {
      width: 44px; height: 44px; background: rgba(59,130,246,0.32);
      border-radius: 50%; position: absolute; top: -10px; left: -10px; z-index: 1;
      animation: pulse 2s infinite ease-out;
    }
    @keyframes pulse {
      0% { transform: scale(0.4); opacity: 1; }
      100% { transform: scale(1.9); opacity: 0; }
    }
    .poi-marker {
      display: flex; align-items: center; justify-content: center;
      width: 38px; height: 38px; border-radius: 50% 50% 50% 6px;
      transform: rotate(-45deg); background: linear-gradient(135deg, #ff5722, #ff8a50);
      border: 2px solid #fff; box-shadow: 0 6px 14px rgba(0,0,0,0.45);
    }
    .poi-marker.cafe-pin { background: linear-gradient(135deg, #a855f7, #c084fc); }
    .poi-marker.fastfood-pin { background: linear-gradient(135deg, #f59e0b, #fbbf24); }
    .poi-marker.active-pin {
      transform: rotate(-45deg) scale(1.25);
      background: linear-gradient(135deg, #10b981, #34d399);
    }
    .poi-marker span { transform: rotate(45deg); font-size: 18px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const map = L.map('map', { zoomControl: false, attributionControl: false }).setView([13.9414, 121.6234], 16);
    const poiGroup = L.layerGroup().addTo(map);
    let tileLayer = null;
    let userMarker = null;
    let radiusCircle = null;
    let routeLine = null;
    let routeGlow = null;
    let walkedLine = null;
    let followUser = true;
    let currentStyle = 'google_street';

    const TILES = {
      google_street: { url: 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', cls: '' },
      dark_mode: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', cls: 'tile-dark-filter' },
      google_satellite: { url: 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', cls: '' }
    };

    function applyTile(styleKey) {
      if (tileLayer) map.removeLayer(tileLayer);
      const t = TILES[styleKey] || TILES.google_street;
      tileLayer = L.tileLayer(t.url, { maxZoom: 20, className: t.cls }).addTo(map);
    }
    applyTile(currentStyle);

    map.on('dragstart', () => { followUser = false; });

    function handleCommand(msg) {
      if (!msg || !msg.type) return;

      if (msg.type === 'UPDATE_USER') {
        const latLng = [msg.lat, msg.lng];
        if (!userMarker) {
          const icon = L.divIcon({
            className: 'user-gps-marker',
            html: '<div class="user-gps-pulse"></div><div class="user-gps-dot"></div>',
            iconSize: [24, 24],
            iconAnchor: [12, 12]
          });
          userMarker = L.marker(latLng, { icon, zIndexOffset: 1000 }).addTo(map);
          radiusCircle = L.circle(latLng, {
            radius: msg.radius || 1500,
            color: '#ff5722',
            weight: 1.5,
            dashArray: '6, 8',
            fillColor: '#ff5722',
            fillOpacity: 0.03
          }).addTo(map);
        } else {
          userMarker.setLatLng(latLng);
          if (radiusCircle) {
            radiusCircle.setLatLng(latLng);
            if (msg.radius) radiusCircle.setRadius(msg.radius);
          }
        }
        if (followUser) map.panTo(latLng, { animate: true, duration: 0.45 });
      }

      if (msg.type === 'RECENTER') {
        followUser = true;
        if (msg.lat && msg.lng) map.flyTo([msg.lat, msg.lng], 17, { duration: 0.7 });
      }

      if (msg.type === 'CYCLE_LAYER') {
        const order = ['google_street', 'dark_mode', 'google_satellite'];
        currentStyle = order[(order.indexOf(currentStyle) + 1) % order.length];
        applyTile(currentStyle);
      }

      if (msg.type === 'RENDER_POIS') {
        poiGroup.clearLayers();
        (msg.places || []).forEach((p) => {
          const isSel = p.id === msg.selectedId;
          let catCls = '';
          if (p.category === 'cafe') catCls = 'cafe-pin';
          if (p.category === 'fast_food') catCls = 'fastfood-pin';
          const icon = L.divIcon({
            className: 'w',
            html: '<div class="poi-marker ' + catCls + ' ' + (isSel ? 'active-pin' : '') + '"><span>' + (p.emoji || '🍴') + '</span></div>',
            iconSize: [38, 38],
            iconAnchor: [19, 38]
          });
          const m = L.marker([p.lat, p.lng], { icon, zIndexOffset: isSel ? 900 : 100 });
          m.on('click', () => {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SELECT_PLACE', placeId: p.id }));
            }
          });
          poiGroup.addLayer(m);
        });
      }

      if (msg.type === 'DRAW_ROUTE') {
        if (routeLine) map.removeLayer(routeLine);
        if (routeGlow) map.removeLayer(routeGlow);
        if (walkedLine) map.removeLayer(walkedLine);
        if (msg.coords && msg.coords.length > 0) {
          routeGlow = L.polyline(msg.coords, { color: '#059669', weight: 12, opacity: 0.35 }).addTo(map);
          routeLine = L.polyline(msg.coords, { color: '#10b981', weight: 6, opacity: 0.98 }).addTo(map);
          followUser = false;
          map.fitBounds(routeLine.getBounds(), { padding: [50, 50], maxZoom: 18 });
        }
      }

      if (msg.type === 'UPDATE_WALK_PATH') {
        if (routeLine && msg.remaining && msg.remaining.length > 1) {
          routeLine.setLatLngs(msg.remaining);
          routeGlow.setLatLngs(msg.remaining);
        }
        if (msg.walked && msg.walked.length > 1) {
          if (!walkedLine) {
            walkedLine = L.polyline(msg.walked, { color: '#475569', weight: 5, dashArray: '6, 8' }).addTo(map);
          } else {
            walkedLine.setLatLngs(msg.walked);
          }
        }
      }

      if (msg.type === 'CLEAR_ROUTE') {
        if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
        if (routeGlow) { map.removeLayer(routeGlow); routeGlow = null; }
        if (walkedLine) { map.removeLayer(walkedLine); walkedLine = null; }
      }
    }

    document.addEventListener('message', (e) => {
      try { handleCommand(JSON.parse(e.data)); } catch (err) {}
    });
    window.addEventListener('message', (e) => {
      try { handleCommand(JSON.parse(e.data)); } catch (err) {}
    });
  </script>
</body>
</html>
`;

const MapCanvas = forwardRef(({ onSelectPlaceId, onMapReady }, ref) => {
  const webviewRef = useRef(null);

  const sendCommand = (payload) => {
    if (webviewRef.current) {
      webviewRef.current.postMessage(JSON.stringify(payload));
    }
  };

  useImperativeHandle(ref, () => ({
    updateUser: (lat, lng, radius) => sendCommand({ type: 'UPDATE_USER', lat, lng, radius }),
    recenter: (lat, lng) => sendCommand({ type: 'RECENTER', lat, lng }),
    cycleLayer: () => sendCommand({ type: 'CYCLE_LAYER' }),
    renderPOIs: (places, selectedId) => sendCommand({ type: 'RENDER_POIS', places, selectedId }),
    drawRoute: (coords) => sendCommand({ type: 'DRAW_ROUTE', coords }),
    updateWalkPath: (remaining, walked) =>
      sendCommand({ type: 'UPDATE_WALK_PATH', remaining, walked }),
    clearRoute: () => sendCommand({ type: 'CLEAR_ROUTE' })
  }));

  return (
    <View style={styles.container}>
      <WebView
        ref={webviewRef}
        originWhitelist={['*']}
        source={{ html: MAP_HTML }}
        style={styles.webview}
        onLoadEnd={() => onMapReady && onMapReady()}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === 'SELECT_PLACE' && onSelectPlaceId) {
              onSelectPlaceId(data.placeId);
            }
          } catch (e) {}
        }}
        javaScriptEnabled
        domStorageEnabled
        geolocationEnabled
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117' },
  webview: { flex: 1, backgroundColor: 'transparent' }
});

export default MapCanvas;
