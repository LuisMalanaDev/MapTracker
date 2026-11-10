// ============================================================================
// src/components/MapCanvas.js — 100% Native Google Maps via react-native-maps
// ============================================================================

import React, { useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import MapView, { Marker, Polyline, Circle } from 'react-native-maps';

const MAP_TYPES = ['standard', 'hybrid', 'satellite'];

const MapCanvas = forwardRef(({ onSelectPlaceId, onMapReady }, ref) => {
  const mapViewRef = useRef(null);

  const [userCoord, setUserCoord] = useState({ latitude: 13.9414, longitude: 121.6234 });
  const [radiusMeters, setRadiusMeters] = useState(1500);
  const [places, setPlaces] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [remainingCoords, setRemainingCoords] = useState([]);
  const [walkedCoords, setWalkedCoords] = useState([]);
  const [mapTypeIdx, setMapTypeIdx] = useState(0);
  const [followUser, setFollowUser] = useState(true);
  const [hasCenteredInitial, setHasCenteredInitial] = useState(false);

  const toLatLngObj = (arr) =>
    (arr || []).map((pt) => ({
      latitude: Number(pt[0]),
      longitude: Number(pt[1])
    }));

  useImperativeHandle(ref, () => ({
    updateUser: (lat, lng, radius) => {
      if (!lat || !lng) return;
      const nextCoord = { latitude: Number(lat), longitude: Number(lng) };
      setUserCoord(nextCoord);
      if (radius) setRadiusMeters(Number(radius));

      if (!hasCenteredInitial || followUser) {
        setHasCenteredInitial(true);
        mapViewRef.current?.animateToRegion(
          {
            ...nextCoord,
            latitudeDelta: 0.012,
            longitudeDelta: 0.012
          },
          500
        );
      }
    },

    recenter: (lat, lng) => {
      setFollowUser(true);
      const target =
        lat && lng ? { latitude: Number(lat), longitude: Number(lng) } : userCoord;
      mapViewRef.current?.animateToRegion(
        {
          ...target,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008
        },
        650
      );
    },

    cycleLayer: () => {
      setMapTypeIdx((prev) => (prev + 1) % MAP_TYPES.length);
    },

    renderPOIs: (list, selId) => {
      setPlaces(list || []);
      setSelectedId(selId || null);
    },

    drawRoute: (coords) => {
      const formatted = toLatLngObj(coords);
      setRemainingCoords(formatted);
      setWalkedCoords([]);
      setFollowUser(false);

      if (formatted.length > 1 && mapViewRef.current) {
        mapViewRef.current.fitToCoordinates(formatted, {
          edgePadding: { top: 140, right: 60, bottom: 320, left: 60 },
          animated: true
        });
      }
    },

    updateWalkPath: (remaining, walked) => {
      setRemainingCoords(toLatLngObj(remaining));
      setWalkedCoords(toLatLngObj(walked));
    },

    clearRoute: () => {
      setRemainingCoords([]);
      setWalkedCoords([]);
    }
  }));

  return (
    <View style={styles.container}>
      <MapView
        ref={mapViewRef}
        style={styles.map}
        mapType={MAP_TYPES[mapTypeIdx]}
        initialRegion={{
          latitude: 13.9414,
          longitude: 121.6234,
          latitudeDelta: 0.015,
          longitudeDelta: 0.015
        }}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={true}
        showsBuildings={true}
        onMapReady={() => onMapReady && onMapReady()}
        onPanDrag={() => setFollowUser(false)}
      >
        {/* Radar Scan Radius Circle */}
        <Circle
          center={userCoord}
          radius={radiusMeters}
          strokeColor="rgba(255, 87, 34, 0.6)"
          fillColor="rgba(255, 87, 34, 0.05)"
          strokeWidth={2}
        />

        {/* User / Simulator Live Blue Beacon */}
        <Marker coordinate={userCoord} anchor={{ x: 0.5, y: 0.5 }} zIndex={999}>
          <View style={styles.userBeaconOuter}>
            <View style={styles.userBeaconInner} />
          </View>
        </Marker>

        {/* Walked Street Path (Grey) */}
        {walkedCoords.length > 1 && (
          <Polyline
            coordinates={walkedCoords}
            strokeColor="#64748b"
            strokeWidth={5}
            lineDashPattern={[8, 8]}
          />
        )}

        {/* Remaining Street Path (Glowing Emerald Green) */}
        {remainingCoords.length > 1 && (
          <>
            <Polyline
              coordinates={remainingCoords}
              strokeColor="rgba(16, 185, 129, 0.3)"
              strokeWidth={12}
            />
            <Polyline
              coordinates={remainingCoords}
              strokeColor="#10b981"
              strokeWidth={6}
            />
          </>
        )}

        {/* Restaurant Pins */}
        {places.map((p) => {
          const isSel = p.id === selectedId;
          let pinBg = '#ff5722';
          if (p.category === 'cafe') pinBg = '#a855f7';
          if (p.category === 'fast_food') pinBg = '#f59e0b';
          if (isSel) pinBg = '#10b981';

          return (
            <Marker
              key={p.id}
              coordinate={{ latitude: Number(p.lat), longitude: Number(p.lng) }}
              title={p.name}
              description={`${p.typeLabel} • ${p.distanceText}`}
              onPress={() => onSelectPlaceId && onSelectPlaceId(p.id)}
              zIndex={isSel ? 900 : 100}
            >
              <View
                style={[
                  styles.pinBubble,
                  { backgroundColor: pinBg },
                  isSel && styles.pinBubbleSelected
                ]}
              >
                <Text style={styles.pinEmoji}>{p.emoji || '🍴'}</Text>
              </View>
            </Marker>
          );
        })}
      </MapView>
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { width: '100%', height: '100%' },
  userBeaconOuter: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(59, 130, 246, 0.28)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  userBeaconInner: {
    width: 15,
    height: 15,
    borderRadius: 8,
    backgroundColor: '#3b82f6',
    borderWidth: 2.5,
    borderColor: '#ffffff'
  },
  pinBubble: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    borderColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 5
  },
  pinBubbleSelected: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 3
  },
  pinEmoji: { fontSize: 17 }
});

export default MapCanvas;
