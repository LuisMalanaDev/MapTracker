// ============================================================================
// src/components/MapCanvas.js — Self-Contained Google Maps Tile & Route Engine
// Zero External CDN Scripts • Zero API Key Required • Works in Expo Go & APK
// ============================================================================

import React, { useRef, useEffect, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import { WebView } from 'react-native-webview';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const SELF_CONTAINED_MAP_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; user-select: none; -webkit-user-select: none; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #e5e3df;
      touch-action: none;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }
    #viewport {
      position: relative;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      background: #e5e3df;
    }
    #tileContainer, #routeCanvas, #markerContainer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }
    #routeCanvas { pointer-events: none; z-index: 2; }
    #markerContainer { pointer-events: none; z-index: 3; }
    .map-tile {
      position: absolute;
      width: 256px;
      height: 256px;
      pointer-events: none;
    }
    .dark-tile {
      filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%);
    }
    .user-marker {
      position: absolute;
      width: 24px;
      height: 24px;
      margin-left: -12px;
      margin-top: -12px;
      z-index: 999;
      pointer-events: none;
      transition: left 0.35s linear, top 0.35s linear;
    }
    .user-dot {
      width: 18px;
      height: 18px;
      background: #3b82f6;
      border: 3px solid #fff;
      border-radius: 50%;
      position: absolute;
      top: 3px;
      left: 3px;
      box-shadow: 0 0 12px rgba(59,130,246,0.95);
    }
    .user-pulse {
      width: 44px;
      height: 44px;
      background: rgba(59,130,246,0.32);
      border-radius: 50%;
      position: absolute;
      top: -10px;
      left: -10px;
      animation: pulse 2s infinite ease-out;
    }
    @keyframes pulse {
      0% { transform: scale(0.4); opacity: 1; }
      100% { transform: scale(1.9); opacity: 0; }
    }
    .poi-pin {
      position: absolute;
      width: 38px;
      height: 38px;
      margin-left: -19px;
      margin-top: -38px;
      border-radius: 50% 50% 50% 6px;
      transform: rotate(-45deg);
      background: linear-gradient(135deg, #ff5722, #ff8a50);
      border: 2px solid #fff;
      box-shadow: 0 5px 14px rgba(0,0,0,0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: auto;
      cursor: pointer;
    }
    .poi-pin.cafe { background: linear-gradient(135deg, #a855f7, #c084fc); }
    .poi-pin.fast_food { background: linear-gradient(135deg, #f59e0b, #fbbf24); }
    .poi-pin.selected {
      transform: rotate(-45deg) scale(1.25);
      background: linear-gradient(135deg, #10b981, #34d399);
      z-index: 900;
    }
    .poi-pin span {
      transform: rotate(45deg);
      font-size: 18px;
    }
    .zoom-controls {
      position: absolute;
      left: 12px;
      top: 12px;
      z-index: 10;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .zoom-btn {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: rgba(16, 22, 34, 0.9);
      color: #fff;
      border: 1px solid rgba(255,255,255,0.15);
      font-size: 20px;
      font-weight: bold;
      display: flex;
      align-items: center;
      justify-content: center;
    }
  </style>
</head>
<body>
  <div id="viewport">
    <div id="tileContainer"></div>
    <canvas id="routeCanvas"></canvas>
    <div id="markerContainer"></div>
    <div class="zoom-controls">
      <button class="zoom-btn" onclick="changeZoom(1)">+</button>
      <button class="zoom-btn" onclick="changeZoom(-1)">−</button>
    </div>
  </div>

  <script>
    const tileContainer = document.getElementById('tileContainer');
    const routeCanvas = document.getElementById('routeCanvas');
    const markerContainer = document.getElementById('markerContainer');
    const ctx = routeCanvas.getContext('2d');

    let centerLat = 13.9414;
    let centerLng = 121.6234;
    let zoom = 16;
    let userLat = 13.9414;
    let userLng = 121.6234;
    let userHeading = 0;
    let radiusMeters = 1500;
    let places = [];
    let selectedId = null;
    let remainingRoute = [];
    let walkedRoute = [];
    let followUser = true;
    let tileStyle = 0; // 0: Google Street, 1: Dark Mode, 2: Google Satellite

    const TILE_URLS = [
      (x, y, z) => 'https://mt1.google.com/vt/lyrs=m&x=' + x + '&y=' + y + '&z=' + z,
      (x, y, z) => 'https://mt1.google.com/vt/lyrs=m&x=' + x + '&y=' + y + '&z=' + z,
      (x, y, z) => 'https://mt1.google.com/vt/lyrs=y&x=' + x + '&y=' + y + '&z=' + z
    ];

    function lng2tileX(lon, z) {
      return ((lon + 180) / 360) * Math.pow(2, z);
    }
    function lat2tileY(lat, z) {
      const rad = (lat * Math.PI) / 180;
      return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * Math.pow(2, z);
    }
    function tileX2lng(x, z) {
      return (x / Math.pow(2, z)) * 360 - 180;
    }
    function tileY2lat(y, z) {
      const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
      return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    }

    function latLngToScreen(lat, lng) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const centerX = lng2tileX(centerLng, zoom);
      const centerY = lat2tileY(centerLat, zoom);
      const ptX = lng2tileX(lng, zoom);
      const ptY = lat2tileY(lat, zoom);
      return {
        x: w / 2 + (ptX - centerX) * 256,
        y: h / 2 + (ptY - centerY) * 256
      };
    }

    function render() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      if (routeCanvas.width !== w || routeCanvas.height !== h) {
        routeCanvas.width = w;
        routeCanvas.height = h;
      }

      // 1. Render Tiles
      const centerX = lng2tileX(centerLng, zoom);
      const centerY = lat2tileY(centerLat, zoom);
      const startX = Math.floor(centerX - (w / 2) / 256) - 1;
      const endX = Math.floor(centerX + (w / 2) / 256) + 1;
      const startY = Math.floor(centerY - (h / 2) / 256) - 1;
      const endY = Math.floor(centerY + (h / 2) / 256) + 1;
      const maxTile = Math.pow(2, zoom);

      let tilesHtml = '';
      const isDark = tileStyle === 1;
      for (let x = startX; x <= endX; x++) {
        for (let y = startY; y <= endY; y++) {
          if (y < 0 || y >= maxTile) continue;
          const wrappedX = ((x % maxTile) + maxTile) % maxTile;
          const left = Math.round(w / 2 + (x - centerX) * 256);
          const top = Math.round(h / 2 + (y - centerY) * 256);
          const src = TILE_URLS[tileStyle](wrappedX, y, zoom);
          tilesHtml += '<img class="map-tile ' + (isDark ? 'dark-tile' : '') + '" src="' + src + '" style="left:' + left + 'px;top:' + top + 'px;" />';
        }
      }
      tileContainer.innerHTML = tilesHtml;

      // 2. Render Route & Radar Circle on Canvas
      ctx.clearRect(0, 0, w, h);
      const uPt = latLngToScreen(userLat, userLng);
      const metersPerPixel = (156543.03392 * Math.cos((userLat * Math.PI) / 180)) / Math.pow(2, zoom);
      const radPx = radiusMeters / metersPerPixel;

      ctx.beginPath();
      ctx.arc(uPt.x, uPt.y, radPx, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 87, 34, 0.65)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 87, 34, 0.04)';
      ctx.fill();
      ctx.setLineDash([]);

      if (walkedRoute.length > 1) {
        ctx.beginPath();
        walkedRoute.forEach((pt, idx) => {
          const s = latLngToScreen(pt[0], pt[1]);
          if (idx === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.strokeStyle = '#64748b';
        ctx.lineWidth = 5;
        ctx.setLineDash([6, 6]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (remainingRoute.length > 1) {
        ctx.beginPath();
        remainingRoute.forEach((pt, idx) => {
          const s = latLngToScreen(pt[0], pt[1]);
          if (idx === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.strokeStyle = 'rgba(16, 185, 129, 0.32)';
        ctx.lineWidth = 13;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.stroke();

        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 6;
        ctx.stroke();
      }

      // 3. Render Markers
      let markersHtml = '<div class="user-marker" style="left:' + uPt.x + 'px;top:' + uPt.y + 'px;"><div class="user-pulse"></div><div class="user-dot"></div></div>';

      places.forEach((p) => {
        const pt = latLngToScreen(p.lat, p.lng);
        if (pt.x < -50 || pt.x > w + 50 || pt.y < -50 || pt.y > h + 50) return;
        const isSel = p.id === selectedId;
        const cls = 'poi-pin ' + (p.category || '') + (isSel ? ' selected' : '');
        markersHtml += '<div class="' + cls + '" style="left:' + pt.x + 'px;top:' + pt.y + 'px;" onclick="selectPlace(\\'' + p.id + '\\')"><span>' + (p.emoji || '🍴') + '</span></div>';
      });
      markerContainer.innerHTML = markersHtml;
    }

    function changeZoom(delta) {
      zoom = Math.max(3, Math.min(19, zoom + delta));
      render();
    }

    function selectPlace(id) {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'SELECT_PLACE', placeId: id }));
      }
    }

    // Touch Pan Dragging, Pinch-to-Zoom & Tap-on-Map to Route
    let isDragging = false;
    let didMove = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    let initialPinchDist = null;
    const vp = document.getElementById('viewport');

    function screenToLatLng(sx, sy) {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const cx = lng2tileX(centerLng, zoom) + (sx - w / 2) / 256;
      const cy = lat2tileY(centerLat, zoom) + (sy - h / 2) / 256;
      return {
        lat: tileY2lat(cy, zoom),
        lng: tileX2lng(cx, zoom)
      };
    }

    vp.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        isDragging = true;
        didMove = false;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        lastX = startX;
        lastY = startY;
      } else if (e.touches.length === 2) {
        isDragging = false;
        didMove = true;
        initialPinchDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
      }
    });

    vp.addEventListener('touchmove', (e) => {
      if (e.touches.length === 2 && initialPinchDist) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        if (Math.abs(dist - initialPinchDist) > 42) {
          changeZoom(dist > initialPinchDist ? 1 : -1);
          initialPinchDist = dist;
        }
        return;
      }
      if (!isDragging || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - lastX;
      const dy = e.touches[0].clientY - lastY;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
      if (Math.abs(e.touches[0].clientX - startX) > 8 || Math.abs(e.touches[0].clientY - startY) > 8) {
        didMove = true;
      }
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        followUser = false;
        const cx = lng2tileX(centerLng, zoom) - dx / 256;
        const cy = lat2tileY(centerLat, zoom) - dy / 256;
        centerLng = tileX2lng(cx, zoom);
        centerLat = tileY2lat(cy, zoom);
        render();
      }
    });

    vp.addEventListener('touchend', (e) => {
      initialPinchDist = null;
      if (isDragging && !didMove && e.changedTouches && e.changedTouches.length === 1) {
        const target = e.target;
        if (!target.closest || (!target.closest('.poi-pin') && !target.closest('.zoom-btn'))) {
          const tx = e.changedTouches[0].clientX;
          const ty = e.changedTouches[0].clientY;
          const coords = screenToLatLng(tx, ty);
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(
              JSON.stringify({ type: 'MAP_TAP', lat: coords.lat, lng: coords.lng })
            );
          }
        }
      }
      isDragging = false;
    });

    window.handleCommand = function(msg) {
      if (!msg || !msg.type) return;
      if (msg.type === 'SYNC_STATE') {
        if (msg.userPos) {
          userLat = msg.userPos.lat;
          userLng = msg.userPos.lng;
          if (followUser) {
            centerLat = userLat;
            centerLng = userLng;
          }
        }
        if (msg.radius) radiusMeters = msg.radius;
        if (msg.places) places = msg.places;
        if (msg.selectedId !== undefined) selectedId = msg.selectedId;
        if (msg.remainingRoute !== undefined) remainingRoute = msg.remainingRoute;
        if (msg.walkedRoute !== undefined) walkedRoute = msg.walkedRoute;
        render();
      }
      if (msg.type === 'RECENTER') {
        followUser = true;
        centerLat = msg.lat || userLat;
        centerLng = msg.lng || userLng;
        zoom = 16;
        render();
      }
      if (msg.type === 'CYCLE_LAYER') {
        tileStyle = (tileStyle + 1) % 3;
        render();
      }
      if (msg.type === 'DRAW_ROUTE') {
        remainingRoute = msg.coords || [];
        walkedRoute = [];
        if (remainingRoute.length > 0) {
          followUser = false;
          const mid = remainingRoute[Math.floor(remainingRoute.length / 2)];
          centerLat = mid[0];
          centerLng = mid[1];
          zoom = 16;
        }
        render();
      }
    };

    window.addEventListener('resize', render);
    render();
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'MAP_READY' }));
    }
  </script>
</body>
</html>
`;

const MapCanvas = forwardRef(
  (
    {
      userPos,
      radiusMeters,
      places,
      selectedId,
      remainingCoords,
      walkedCoords,
      onSelectPlaceId,
      onMapTap,
      onMapReady
    },
    ref
  ) => {
    const webviewRef = useRef(null);

    const sendCommand = (payload) => {
      if (webviewRef.current) {
        const json = JSON.stringify(payload);
        webviewRef.current.injectJavaScript(
          `if(window.handleCommand){window.handleCommand(${json});} true;`
        );
      }
    };

    // Automatically push state whenever props update
    useEffect(() => {
      sendCommand({
        type: 'SYNC_STATE',
        userPos,
        radius: radiusMeters,
        places,
        selectedId,
        remainingRoute: remainingCoords || [],
        walkedRoute: walkedCoords || []
      });
    }, [userPos, radiusMeters, places, selectedId, remainingCoords, walkedCoords]);

    useImperativeHandle(ref, () => ({
      updateUser: (lat, lng, radius) =>
        sendCommand({ type: 'SYNC_STATE', userPos: { lat, lng }, radius }),
      recenter: (lat, lng) => sendCommand({ type: 'RECENTER', lat, lng }),
      cycleLayer: () => sendCommand({ type: 'CYCLE_LAYER' }),
      renderPOIs: (list, selId) =>
        sendCommand({ type: 'SYNC_STATE', places: list, selectedId: selId }),
      drawRoute: (coords) => sendCommand({ type: 'DRAW_ROUTE', coords }),
      updateWalkPath: (remaining, walked) =>
        sendCommand({
          type: 'SYNC_STATE',
          remainingRoute: remaining,
          walkedRoute: walked
        }),
      clearRoute: () =>
        sendCommand({ type: 'SYNC_STATE', remainingRoute: [], walkedRoute: [] })
    }));

    return (
      <View style={styles.container}>
        <WebView
          ref={webviewRef}
          originWhitelist={['*']}
          source={{ html: SELF_CONTAINED_MAP_HTML, baseUrl: 'https://mt1.google.com' }}
          style={styles.webview}
          mixedContentMode="always"
          javaScriptEnabled
          domStorageEnabled
          onLoadEnd={() => {
            sendCommand({
              type: 'SYNC_STATE',
              userPos,
              radius: radiusMeters,
              places,
              selectedId,
              remainingRoute: remainingCoords || [],
              walkedRoute: walkedCoords || []
            });
            if (onMapReady) onMapReady();
          }}
          onMessage={(event) => {
            try {
              const data = JSON.parse(event.nativeEvent.data);
              if (data.type === 'SELECT_PLACE' && onSelectPlaceId) {
                onSelectPlaceId(data.placeId);
              }
              if (data.type === 'MAP_TAP' && onMapTap) {
                onMapTap(data.lat, data.lng);
              }
            } catch (e) {}
          }}
        />
      </View>
    );
  }
);

const styles = StyleSheet.create({
  container: {
    width: SCREEN_W,
    height: SCREEN_H,
    backgroundColor: '#e5e3df'
  },
  webview: {
    width: SCREEN_W,
    height: SCREEN_H,
    backgroundColor: '#e5e3df'
  }
});

export default MapCanvas;
