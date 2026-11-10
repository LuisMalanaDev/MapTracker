// ============================================================================
// App.js — CraveNav Expo (React Native) Live Restaurant & Walking Path Tracker
// ============================================================================

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  Modal,
  SafeAreaView,
  Platform,
  StatusBar as RNStatusBar
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';

import MapCanvas from './src/components/MapCanvas';
import {
  fetchNearbyRestaurants,
  searchPlacesByQuery,
  recalculateDistances
} from './src/services/placesService';
import {
  calculateStreetRoute,
  computeLiveWalkState,
  interpolateRouteSteps
} from './src/services/routeService';

const CATEGORIES = [
  { id: 'all', label: '🍽️ All Food' },
  { id: 'restaurant', label: '🍜 Restaurants' },
  { id: 'fast_food', label: '🍔 Fast Food' },
  { id: 'cafe', label: '☕ Cafés & Boba' },
  { id: 'favorites', label: '❤️ Saved' }
];

const RADII = [
  { label: '800 m', value: 800 },
  { label: '1.5 km', value: 1500 },
  { label: '3.0 km', value: 3000 },
  { label: '5.0 km', value: 5000 }
];

export default function App() {
  useKeepAwake();

  const mapRef = useRef(null);
  const simTimerRef = useRef(null);
  const lastSpokenStepRef = useRef(-1);
  const arrivedTriggeredRef = useRef(false);

  const [userPos, setUserPos] = useState({ lat: 13.9414, lng: 121.6234 });
  const [gpsStatus, setGpsStatus] = useState('Locating...');
  const [mapReady, setMapReady] = useState(false);

  const [allPlaces, setAllPlaces] = useState([]);
  const [loadingPlaces, setLoadingPlaces] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [radiusMeters, setRadiusMeters] = useState(1500);
  const [travelMode, setTravelMode] = useState('foot'); // 'foot' | 'driving'
  const [favorites, setFavorites] = useState([]);
  const [sheetMinimized, setSheetMinimized] = useState(false);

  // Active Navigation State
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [activeRoute, setActiveRoute] = useState(null);
  const [liveNav, setLiveNav] = useState(null);
  const [showStepsList, setShowStepsList] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);

  // Modals
  const [rouletteWinner, setRouletteWinner] = useState(null);
  const [arrivalPlace, setArrivalPlace] = useState(null);

  // Load saved favorites
  useEffect(() => {
    AsyncStorage.getItem('cravenav_favs')
      .then((raw) => {
        if (raw) setFavorites(JSON.parse(raw));
      })
      .catch(() => {});
  }, []);

  // Start Native Hardware GPS Tracking
  useEffect(() => {
    let subscription = null;
    let initialLoaded = false;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setGpsStatus('City Center GPS');
          loadNearby(13.9414, 121.6234, radiusMeters);
          return;
        }

        // 1. Instant last known position so it never hangs indoors
        const lastKnown = await Location.getLastKnownPositionAsync();
        if (lastKnown && lastKnown.coords) {
          initialLoaded = true;
          setUserPos({
            lat: lastKnown.coords.latitude,
            lng: lastKnown.coords.longitude
          });
          setGpsStatus('Live GPS Locked');
          loadNearby(lastKnown.coords.latitude, lastKnown.coords.longitude, radiusMeters);
        }

        // 2. Continuous live GPS stream
        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 1000,
            distanceInterval: 1
          },
          (loc) => {
            if (simTimerRef.current) return;
            const lat = loc.coords.latitude;
            const lng = loc.coords.longitude;
            setUserPos({ lat, lng });
            setGpsStatus('Live GPS Tracking');

            if (!initialLoaded) {
              initialLoaded = true;
              loadNearby(lat, lng, radiusMeters);
            }
          }
        );

        // 3. Safety fallback if indoors and no GPS fix after 3.5 seconds
        setTimeout(() => {
          if (!initialLoaded) {
            initialLoaded = true;
            loadNearby(userPos.lat, userPos.lng, radiusMeters);
          }
        }, 3500);
      } catch (e) {
        setGpsStatus('GPS Fallback');
        loadNearby(13.9414, 121.6234, radiusMeters);
      }
    })();

    return () => {
      if (subscription) subscription.remove();
      if (simTimerRef.current) clearInterval(simTimerRef.current);
    };
  }, []);

  // Sync user position with Map & Live Navigation Progress
  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.updateUser(userPos.lat, userPos.lng, radiusMeters);

    if (allPlaces.length > 0) {
      setAllPlaces((prev) => recalculateDistances(prev, userPos.lat, userPos.lng));
    }

    if (activeRoute && selectedPlace) {
      const state = computeLiveWalkState(
        userPos.lat,
        userPos.lng,
        activeRoute,
        selectedPlace,
        travelMode
      );
      if (state) {
        setLiveNav(state);
        mapRef.current?.updateWalkPath(state.remainingCoords, state.walkedCoords);

        if (
          voiceEnabled &&
          state.activeStepIdx !== lastSpokenStepRef.current &&
          state.currentStep
        ) {
          lastSpokenStepRef.current = state.activeStepIdx;
          Speech.stop();
          Speech.speak(state.currentStep.instruction);
        }

        if (state.isArrived && !arrivedTriggeredRef.current) {
          arrivedTriggeredRef.current = true;
          stopWalkSimulator();
          setArrivalPlace(selectedPlace);
          if (voiceEnabled) {
            Speech.speak(`You have arrived at ${selectedPlace.name}. Enjoy your meal!`);
          }
        }
      }
    }
  }, [userPos, mapReady]);

  async function loadNearby(lat, lng, rad) {
    setLoadingPlaces(true);
    const spots = await fetchNearbyRestaurants(lat, lng, rad);
    setAllPlaces(spots);
    setLoadingPlaces(false);
  }

  // Remote search debounce
  useEffect(() => {
    if (searchQuery.trim().length < 3) return;
    const timer = setTimeout(async () => {
      const results = await searchPlacesByQuery(searchQuery.trim(), userPos.lat, userPos.lng);
      if (results.length > 0) {
        setAllPlaces((prev) => {
          const ids = new Set(prev.map((p) => p.id));
          const merged = [...prev];
          results.forEach((r) => {
            if (!ids.has(r.id)) merged.push(r);
          });
          return recalculateDistances(merged, userPos.lat, userPos.lng);
        });
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const filteredPlaces = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allPlaces.filter((p) => {
      if (activeCategory === 'favorites' && !favorites.includes(p.id)) return false;
      if (activeCategory !== 'all' && activeCategory !== 'favorites' && p.category !== activeCategory) {
        return false;
      }
      if (q && !p.name.toLowerCase().includes(q) && !p.typeLabel.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [allPlaces, activeCategory, searchQuery, favorites]);

  // Update map markers whenever filteredPlaces or selectedPlace changes
  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.renderPOIs(filteredPlaces, selectedPlace ? selectedPlace.id : null);
  }, [filteredPlaces, selectedPlace, mapReady]);

  async function startNavigation(place, customMode = travelMode) {
    stopWalkSimulator();
    arrivedTriggeredRef.current = false;
    lastSpokenStepRef.current = -1;
    setSelectedPlace(place);
    setSheetMinimized(true);

    const route = await calculateStreetRoute(userPos.lat, userPos.lng, place, customMode);
    setActiveRoute(route);
    mapRef.current?.drawRoute(route.coords);

    const state = computeLiveWalkState(userPos.lat, userPos.lng, route, place, customMode);
    setLiveNav(state);

    if (voiceEnabled && route.steps && route.steps[0]) {
      Speech.stop();
      Speech.speak(`Starting route to ${place.name}. ${route.steps[0].instruction}`);
    }
  }

  function stopNavigation() {
    stopWalkSimulator();
    setSelectedPlace(null);
    setActiveRoute(null);
    setLiveNav(null);
    setShowStepsList(false);
    setSheetMinimized(false);
    mapRef.current?.clearRoute();
  }

  function toggleWalkSimulator() {
    if (isSimulating) {
      stopWalkSimulator();
      return;
    }
    if (!activeRoute || !activeRoute.coords || activeRoute.coords.length < 2) return;

    setIsSimulating(true);
    setGpsStatus('Simulating Walk...');
    const densePts = interpolateRouteSteps(activeRoute.coords, 0.00012);
    let idx = 0;

    simTimerRef.current = setInterval(() => {
      if (idx >= densePts.length) {
        stopWalkSimulator();
        return;
      }
      const pt = densePts[idx];
      setUserPos({ lat: pt[0], lng: pt[1] });
      idx++;
    }, 450);
  }

  function stopWalkSimulator() {
    if (simTimerRef.current) {
      clearInterval(simTimerRef.current);
      simTimerRef.current = null;
    }
    setIsSimulating(false);
    setGpsStatus('Live GPS Tracking');
  }

  function toggleFavorite(id) {
    setFavorites((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      AsyncStorage.setItem('cravenav_favs', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function spinRandomRestaurant() {
    const pool = filteredPlaces.length > 0 ? filteredPlaces : allPlaces;
    if (pool.length === 0) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setRouletteWinner(pick);
  }

  function cycleRadius() {
    const idx = Math.max(0, RADII.findIndex((r) => r.value === radiusMeters));
    const next = RADII[(idx + 1) % RADII.length].value;
    setRadiusMeters(next);
    loadNearby(userPos.lat, userPos.lng, next);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />

      {/* Fullscreen Map Canvas */}
      <View style={styles.mapWrap}>
        <MapCanvas
          ref={mapRef}
          userPos={userPos}
          radiusMeters={radiusMeters}
          places={filteredPlaces}
          selectedId={selectedPlace ? selectedPlace.id : null}
          remainingCoords={liveNav ? liveNav.remainingCoords : activeRoute ? activeRoute.coords : []}
          walkedCoords={liveNav ? liveNav.walkedCoords : []}
          onMapReady={() => {
            setMapReady(true);
          }}
          onSelectPlaceId={(placeId) => {
            const found = allPlaces.find((p) => p.id === placeId);
            if (found) startNavigation(found);
          }}
        />
      </View>

      {/* Top Navigation HUD (Visible when routing to a restaurant) */}
      {selectedPlace && liveNav && (
        <View style={styles.navHud}>
          <View style={styles.turnBanner}>
            <View style={styles.turnIconBox}>
              <Text style={styles.turnIconText}>
                {liveNav.currentStep ? liveNav.currentStep.icon : '⬆️'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.turnInstruction} numberOfLines={2}>
                {liveNav.currentStep ? liveNav.currentStep.instruction : `Head to ${selectedPlace.name}`}
              </Text>
              <Text style={styles.turnSub} numberOfLines={1}>
                Destination: {selectedPlace.name}
              </Text>
            </View>
          </View>

          {/* Live Shrinking Distance, ETA & Progress % */}
          <View style={styles.statsGrid}>
            <View style={styles.statCell}>
              <Text style={styles.statVal}>{liveNav.remainingText}</Text>
              <Text style={styles.statLbl}>REMAINING</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statVal}>{liveNav.remainingMins} min</Text>
              <Text style={styles.statLbl}>EST. TIME</Text>
            </View>
            <View style={styles.statCell}>
              <Text style={styles.statVal}>{liveNav.progressPercent}%</Text>
              <Text style={styles.statLbl}>CLOSER</Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${liveNav.progressPercent}%` }]} />
          </View>

          {/* Controls Row */}
          <View style={styles.navControlsRow}>
            <TouchableOpacity
              style={[styles.navBtn, isSimulating && styles.navBtnActive]}
              onPress={toggleWalkSimulator}
            >
              <Text style={styles.navBtnText}>
                {isSimulating ? '⏸️ Pause Sim' : '🚶 Sim Walk'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => setShowStepsList(!showStepsList)}
            >
              <Text style={styles.navBtnText}>📋 Steps</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => setVoiceEnabled(!voiceEnabled)}
            >
              <Text style={styles.navBtnText}>{voiceEnabled ? '🔊 Voice' : '🔇 Mute'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.navBtn, styles.stopBtn]} onPress={stopNavigation}>
              <Text style={[styles.navBtnText, { color: '#fca5a5' }]}>✕ End</Text>
            </TouchableOpacity>
          </View>

          {showStepsList && (
            <View style={styles.stepsDrawer}>
              {(liveNav.steps || []).slice(0, 5).map((s, i) => (
                <View
                  key={i}
                  style={[styles.stepRow, i === liveNav.activeStepIdx && styles.stepRowActive]}
                >
                  <Text style={styles.stepText} numberOfLines={1}>
                    {s.icon} {s.instruction}
                  </Text>
                  <Text style={styles.stepDist}>{s.distanceText}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Right Floating Map Controls */}
      <View style={styles.fabCol}>
        <TouchableOpacity
          style={styles.fabBtn}
          onPress={() => mapRef.current?.recenter(userPos.lat, userPos.lng)}
        >
          <Text style={styles.fabText}>🎯</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.fabBtn}
          onPress={() => loadNearby(userPos.lat, userPos.lng, radiusMeters)}
        >
          <Text style={styles.fabText}>🔄</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.fabBtn} onPress={() => mapRef.current?.cycleLayer()}>
          <Text style={styles.fabText}>🗺️</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Restaurant Explorer Sheet */}
      <View style={[styles.bottomSheet, sheetMinimized && styles.bottomSheetMinimized]}>
        <TouchableOpacity
          style={styles.sheetHandleWrap}
          onPress={() => setSheetMinimized(!sheetMinimized)}
        >
          <View style={styles.sheetHandle} />
        </TouchableOpacity>

        {/* Brand Header */}
        <View style={styles.headerRow}>
          <View style={styles.brandGroup}>
            <View style={styles.brandIcon}>
              <Text style={{ fontSize: 19 }}>🍜</Text>
            </View>
            <View>
              <Text style={styles.brandTitle}>CraveNav</Text>
              <Text style={styles.brandSub}>Live Restaurant & Path Tracker</Text>
            </View>
          </View>
          <View style={styles.gpsBadge}>
            <View style={styles.gpsDot} />
            <Text style={styles.gpsBadgeText}>{gpsStatus}</Text>
          </View>
        </View>

        {!sheetMinimized && (
          <>
            {/* Search + Roulette */}
            <View style={styles.searchRow}>
              <View style={styles.searchBox}>
                <Text style={{ marginRight: 6 }}>🔍</Text>
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search restaurants, Jollibee, café..."
                  placeholderTextColor="#64748b"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchQuery('')}>
                    <Text style={{ color: '#94a3b8', paddingHorizontal: 4 }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity style={styles.rouletteBtn} onPress={spinRandomRestaurant}>
                <Text style={{ fontSize: 18 }}>🎲</Text>
              </TouchableOpacity>
            </View>

            {/* Category Chips */}
            <View style={{ height: 42 }}>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={CATEGORIES}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.chipsList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[styles.chip, activeCategory === item.id && styles.chipActive]}
                    onPress={() => setActiveCategory(item.id)}
                  >
                    <Text
                      style={[
                        styles.chipText,
                        activeCategory === item.id && styles.chipTextActive
                      ]}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            </View>

            {/* Sub-toolbar: Count, Radius, Walk/Ride */}
            <View style={styles.subToolbar}>
              <TouchableOpacity onPress={cycleRadius} style={styles.radiusPill}>
                <Text style={styles.subToolbarText}>
                  {filteredPlaces.length} spots • {(radiusMeters / 1000).toFixed(1)} km ▾
                </Text>
              </TouchableOpacity>

              <View style={styles.modeGroup}>
                <TouchableOpacity
                  style={[styles.modeBtn, travelMode === 'foot' && styles.modeBtnActive]}
                  onPress={() => {
                    setTravelMode('foot');
                    if (selectedPlace) startNavigation(selectedPlace, 'foot');
                  }}
                >
                  <Text style={styles.modeBtnText}>🚶 Walk</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeBtn, travelMode === 'driving' && styles.modeBtnActive]}
                  onPress={() => {
                    setTravelMode('driving');
                    if (selectedPlace) startNavigation(selectedPlace, 'driving');
                  }}
                >
                  <Text style={styles.modeBtnText}>🛵 Ride</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Places List */}
            {loadingPlaces ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>🔍 Scanning nearby restaurants...</Text>
              </View>
            ) : (
              <FlatList
                data={filteredPlaces}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 20 }}
                renderItem={({ item }) => {
                  const isSel = selectedPlace && selectedPlace.id === item.id;
                  const isFav = favorites.includes(item.id);
                  return (
                    <TouchableOpacity
                      style={[styles.placeCard, isSel && styles.placeCardSelected]}
                      onPress={() => startNavigation(item)}
                    >
                      <View style={styles.cardTop}>
                        <View style={styles.cardEmojiBox}>
                          <Text style={{ fontSize: 20 }}>{item.emoji}</Text>
                        </View>
                        <View style={{ flex: 1, marginHorizontal: 10 }}>
                          <Text style={styles.placeName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.placeMeta} numberOfLines={1}>
                            {item.typeLabel} • {item.address}
                          </Text>
                        </View>
                        <View style={styles.distPill}>
                          <Text style={styles.distPillText}>{item.distanceText}</Text>
                        </View>
                      </View>

                      <View style={styles.cardBottom}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={styles.etaLabel}>🚶 ~{item.walkMinutes} min walk</Text>
                          <TouchableOpacity
                            onPress={() => toggleFavorite(item.id)}
                            style={{ marginLeft: 10 }}
                          >
                            <Text style={{ fontSize: 15 }}>{isFav ? '❤️' : '🤍'}</Text>
                          </TouchableOpacity>
                        </View>
                        <View style={styles.goBtn}>
                          <Text style={styles.goBtnText}>
                            {isSel ? '🧭 Navigating' : '🚶 Show Path'}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </>
        )}
      </View>

      {/* Random Restaurant Roulette Modal */}
      <Modal visible={!!rouletteWinner} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          {rouletteWinner && (
            <View style={styles.modalCard}>
              <Text style={{ fontSize: 48, marginBottom: 8 }}>{rouletteWinner.emoji}</Text>
              <Text style={styles.modalTitle}>{rouletteWinner.name}</Text>
              <Text style={styles.modalSub}>
                {rouletteWinner.typeLabel} • {rouletteWinner.distanceText} away (~
                {rouletteWinner.walkMinutes} min walk)
              </Text>
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={() => {
                  const target = rouletteWinner;
                  setRouletteWinner(null);
                  startNavigation(target);
                }}
              >
                <Text style={styles.modalPrimaryBtnText}>🚶 Show Path & Let's Go!</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setRouletteWinner(null)}
                style={{ marginTop: 12 }}
              >
                <Text style={{ color: '#94a3b8', fontSize: 13 }}>Close</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      {/* Arrival Celebration Modal */}
      <Modal visible={!!arrivalPlace} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          {arrivalPlace && (
            <View style={styles.modalCard}>
              <Text style={{ fontSize: 48, marginBottom: 8 }}>🎉🍽️</Text>
              <Text style={styles.modalTitle}>You Have Arrived!</Text>
              <Text style={styles.modalSub}>
                You made it to {arrivalPlace.name}! Enjoy your meal!
              </Text>
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={() => setArrivalPlace(null)}
              >
                <Text style={styles.modalPrimaryBtnText}>Awesome, Let's Eat!</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#e5e3df',
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight || 0 : 0
  },
  mapWrap: { flex: 1 },
  fabCol: {
    position: 'absolute',
    right: 12,
    top: Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) + 12 : 52,
    gap: 10,
    zIndex: 20
  },
  fabBtn: {
    width: 44,
    height: 44,
    borderRadius: 13,
    backgroundColor: 'rgba(16, 22, 34, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  fabText: { fontSize: 18 },
  navHud: {
    position: 'absolute',
    top: Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) + 10 : 50,
    left: 12,
    right: 66,
    backgroundColor: 'rgba(12, 18, 28, 0.95)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.45)',
    padding: 12,
    zIndex: 30
  },
  turnBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  turnIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center'
  },
  turnIconText: { fontSize: 22 },
  turnInstruction: { color: '#fff', fontSize: 14, fontWeight: '800' },
  turnSub: { color: '#34d399', fontSize: 11.5, marginTop: 2 },
  statsGrid: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 10,
    paddingVertical: 8,
    marginBottom: 8
  },
  statCell: { flex: 1, alignItems: 'center' },
  statVal: { color: '#fff', fontSize: 14, fontWeight: '800' },
  statLbl: { color: '#94a3b8', fontSize: 9.5, marginTop: 2 },
  progressTrack: {
    height: 7,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 99,
    overflow: 'hidden',
    marginBottom: 10
  },
  progressFill: { height: '100%', backgroundColor: '#10b981' },
  navControlsRow: { flexDirection: 'row', gap: 6 },
  navBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center'
  },
  navBtnActive: { backgroundColor: 'rgba(59, 130, 246, 0.35)' },
  stopBtn: { backgroundColor: 'rgba(239, 68, 68, 0.2)', flex: 0.7 },
  navBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  stepsDrawer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    gap: 4
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 6
  },
  stepRowActive: { backgroundColor: 'rgba(16,185,129,0.2)' },
  stepText: { color: '#cbd5e1', fontSize: 11.5, flex: 1 },
  stepDist: { color: '#94a3b8', fontSize: 11, marginLeft: 8 },
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '48%',
    backgroundColor: 'rgba(16, 22, 34, 0.96)',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    zIndex: 25
  },
  bottomSheetMinimized: { height: 78 },
  sheetHandleWrap: { alignItems: 'center', paddingVertical: 8 },
  sheetHandle: {
    width: 40,
    height: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.28)'
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 10
  },
  brandGroup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#ff5722',
    alignItems: 'center',
    justifyContent: 'center'
  },
  brandTitle: { color: '#fff', fontSize: 16, fontWeight: '800' },
  brandSub: { color: '#94a3b8', fontSize: 11 },
  gpsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 99
  },
  gpsDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10b981',
    marginRight: 6
  },
  gpsBadgeText: { color: '#34d399', fontSize: 11, fontWeight: '700' },
  searchRow: { flexDirection: 'row', paddingHorizontal: 14, gap: 8, marginBottom: 8 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 14, 23, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 11,
    paddingHorizontal: 10,
    height: 40
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 13 },
  rouletteBtn: {
    width: 40,
    height: 40,
    borderRadius: 11,
    backgroundColor: 'rgba(245, 158, 11, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  chipsList: { paddingHorizontal: 14, alignItems: 'center', gap: 6 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginRight: 6
  },
  chipActive: { backgroundColor: '#ff5722' },
  chipText: { color: '#94a3b8', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  subToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    marginBottom: 6
  },
  radiusPill: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.06)'
  },
  subToolbarText: { color: '#cbd5e1', fontSize: 11.5, fontWeight: '600' },
  modeGroup: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 8,
    padding: 2
  },
  modeBtn: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 6 },
  modeBtnActive: { backgroundColor: '#3b82f6' },
  modeBtnText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: '#94a3b8', fontSize: 13 },
  placeCard: {
    backgroundColor: 'rgba(26, 35, 52, 0.85)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)'
  },
  placeCardSelected: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.14)'
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardEmojiBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  placeName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  placeMeta: { color: '#94a3b8', fontSize: 11.5, marginTop: 2 },
  distPill: {
    backgroundColor: 'rgba(59, 130, 246, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8
  },
  distPillText: { color: '#60a5fa', fontSize: 11.5, fontWeight: '700' },
  cardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.06)'
  },
  etaLabel: { color: '#cbd5e1', fontSize: 11.5 },
  goBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8
  },
  goBtnText: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#131b2e',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)'
  },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '800', textAlign: 'center' },
  modalSub: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 18
  },
  modalPrimaryBtn: {
    width: '100%',
    backgroundColor: '#ff5722',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center'
  },
  modalPrimaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' }
});
