// ============================================================================
// App.js — CraveNav Expo (React Native) Live Restaurant, Hotel & Path Tracker
// Includes: Hotels & Resorts, Municipality/Town/Barangay Filter Bar, Live Compass,
//           Craving Pills, Haptic Vibrations, Share ETA, Weather & Food Diary
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
  StatusBar as RNStatusBar,
  Vibration,
  Share
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';

import MapCanvas from './src/components/MapCanvas';
import {
  AREA_PRESETS,
  fetchNearbyRestaurants,
  searchPlacesByQuery,
  geocodeAreaLocation,
  recalculateDistances,
  reverseGeocodePoint,
  fetchLocalWeather
} from './src/services/placesService';
import {
  calculateStreetRoute,
  computeLiveWalkState,
  interpolateRouteSteps,
  calculateBearing,
  getCompassGuidance
} from './src/services/routeService';

const CATEGORIES = [
  { id: 'all', label: '🍽️ All Spots' },
  { id: 'hotel', label: '🏨 Hotels & Stays' },
  { id: 'restaurant', label: '🍜 Restaurants' },
  { id: 'fast_food', label: '🍔 Fast Food' },
  { id: 'cafe', label: '☕ Cafés & Boba' },
  { id: 'favorites', label: '❤️ Saved' },
  { id: 'tried', label: '✅ Tried' }
];

const CRAVINGS = [
  { id: 'hotels', label: '🏨 Hotels & Inns', query: 'hotel inn motel lodge' },
  { id: 'resorts', label: '🌴 Resorts & Staycation', query: 'resort villa staycation' },
  { id: 'lomi', label: '🍜 Lomi & Goto', query: 'lomi goto mami' },
  { id: 'samgyup', label: '🥩 Samgyup & Wings', query: 'samgyup unli wings bbq' },
  { id: 'boba', label: '🧋 Milk Tea & Coffee', query: 'milk tea cafe coffee' },
  { id: 'pares', label: '🍲 Pares & Silog', query: 'pares silog eatery' },
  { id: 'pizza', label: '🍕 Pizza & Pasta', query: 'pizza pasta' },
  { id: 'burger', label: '🍔 Burgers & Fries', query: 'burger fast food' },
  { id: 'dessert', label: '🍰 Desserts & Bakery', query: 'bakery ice cream cake' }
];

const RADII = [
  { label: '1.0 km', value: 1000 },
  { label: '2.0 km', value: 2000 },
  { label: '4.0 km', value: 4000 },
  { label: '8.0 km', value: 8000 }
];

export default function App() {
  useKeepAwake();

  const mapRef = useRef(null);
  const simTimerRef = useRef(null);
  const lastSpokenStepRef = useRef(-1);
  const arrivedTriggeredRef = useRef(false);

  const [userPos, setUserPos] = useState({ lat: 13.9414, lng: 121.6234 });
  const [heading, setHeading] = useState(0);
  const [gpsStatus, setGpsStatus] = useState('Locating...');
  const [weather, setWeather] = useState({ icon: '⛅', temp: '29°C', advice: 'Good walking weather' });
  const [mapReady, setMapReady] = useState(false);

  // Area / Municipality / Town / Barangay Filter State
  const [areaList, setAreaList] = useState(AREA_PRESETS);
  const [activeArea, setActiveArea] = useState(AREA_PRESETS[0]); // Default: 'gps' (Near Me)
  const [customAreaModalOpen, setCustomAreaModalOpen] = useState(false);
  const [customAreaInput, setCustomAreaInput] = useState('');

  const [allPlaces, setAllPlaces] = useState([]);
  const [loadingPlaces, setLoadingPlaces] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCraving, setActiveCraving] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [radiusMeters, setRadiusMeters] = useState(2000);
  const [travelMode, setTravelMode] = useState('foot'); // 'foot' | 'driving'
  const [favorites, setFavorites] = useState([]);
  const [diary, setDiary] = useState({});
  const [sheetMinimized, setSheetMinimized] = useState(false);

  // Active Navigation State
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [activeRoute, setActiveRoute] = useState(null);
  const [liveNav, setLiveNav] = useState(null);
  const [showStepsList, setShowStepsList] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);

  // Modals
  const [rouletteWinner, setRouletteWinner] = useState(null);
  const [arrivalPlace, setArrivalPlace] = useState(null);
  const [diaryModalPlace, setDiaryModalPlace] = useState(null);
  const [draftRating, setDraftRating] = useState(5);
  const [draftNote, setDraftNote] = useState('');

  // Load saved favorites & food/hotel diary
  useEffect(() => {
    AsyncStorage.getItem('cravenav_favs')
      .then((raw) => {
        if (raw) setFavorites(JSON.parse(raw));
      })
      .catch(() => {});

    AsyncStorage.getItem('cravenav_diary')
      .then((raw) => {
        if (raw) setDiary(JSON.parse(raw));
      })
      .catch(() => {});
  }, []);

  // Effective scan center (either Live GPS or the selected Municipality/Town/Barangay)
  const scanCenter = useMemo(() => {
    if (activeArea && activeArea.id !== 'gps' && activeArea.lat && activeArea.lng) {
      return { lat: activeArea.lat, lng: activeArea.lng, label: activeArea.query || activeArea.label };
    }
    return { lat: userPos.lat, lng: userPos.lng, label: '' };
  }, [activeArea, userPos]);

  // Start Native Hardware GPS + Compass Heading Tracking
  useEffect(() => {
    let gpsSub = null;
    let headingSub = null;
    let initialLoaded = false;

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setGpsStatus('City Center GPS');
          loadNearby(13.9414, 121.6234, radiusMeters, 13.9414, 121.6234, '');
          return;
        }

        const lastKnown = await Location.getLastKnownPositionAsync();
        if (lastKnown && lastKnown.coords) {
          initialLoaded = true;
          const lat = lastKnown.coords.latitude;
          const lng = lastKnown.coords.longitude;
          setUserPos({ lat, lng });
          setGpsStatus('Live GPS Locked');
          loadNearby(lat, lng, radiusMeters, lat, lng, '');
          fetchLocalWeather(lat, lng).then(setWeather);
        }

        gpsSub = await Location.watchPositionAsync(
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
              loadNearby(lat, lng, radiusMeters, lat, lng, '');
              fetchLocalWeather(lat, lng).then(setWeather);
            }
          }
        );

        headingSub = await Location.watchHeadingAsync((h) => {
          const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (typeof deg === 'number') setHeading(Math.round(deg));
        });

        setTimeout(() => {
          if (!initialLoaded) {
            initialLoaded = true;
            loadNearby(userPos.lat, userPos.lng, radiusMeters, userPos.lat, userPos.lng, '');
          }
        }, 3500);
      } catch (e) {
        setGpsStatus('GPS Fallback');
        loadNearby(13.9414, 121.6234, radiusMeters, 13.9414, 121.6234, '');
      }
    })();

    return () => {
      if (gpsSub) gpsSub.remove();
      if (headingSub) headingSub.remove();
      if (simTimerRef.current) clearInterval(simTimerRef.current);
    };
  }, []);

  const compassInfo = useMemo(() => {
    if (!selectedPlace) return null;
    const targetBearing = calculateBearing(
      userPos.lat,
      userPos.lng,
      selectedPlace.lat,
      selectedPlace.lng
    );
    const relativeDeg = (targetBearing - heading + 360) % 360;
    return {
      targetBearing: Math.round(targetBearing),
      ...getCompassGuidance(relativeDeg)
    };
  }, [userPos, heading, selectedPlace]);

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

        if (state.activeStepIdx !== lastSpokenStepRef.current && state.currentStep) {
          lastSpokenStepRef.current = state.activeStepIdx;
          if (hapticsEnabled) {
            Vibration.vibrate([0, 160, 100, 200]);
          }
          if (voiceEnabled) {
            Speech.stop();
            Speech.speak(state.currentStep.instruction);
          }
        }

        if (state.isArrived && !arrivedTriggeredRef.current) {
          arrivedTriggeredRef.current = true;
          stopWalkSimulator();
          if (hapticsEnabled) {
            Vibration.vibrate([0, 250, 120, 250, 120, 400]);
          }
          setArrivalPlace(selectedPlace);
          if (voiceEnabled) {
            Speech.speak(`You have arrived at ${selectedPlace.name}!`);
          }
        }
      }
    }
  }, [userPos, mapReady]);

  async function loadNearby(scanLat, scanLng, rad, uLat = userPos.lat, uLng = userPos.lng, areaName = '') {
    setLoadingPlaces(true);
    const spots = await fetchNearbyRestaurants(scanLat, scanLng, rad, uLat, uLng, areaName);
    setAllPlaces(spots);
    setLoadingPlaces(false);
  }

  // Handle selecting a City, Municipality, Town, or Barangay filter
  async function handleSelectArea(area) {
    if (hapticsEnabled) Vibration.vibrate(50);
    setActiveArea(area);
    setActiveCraving(null);
    setSearchQuery('');

    if (area.id === 'gps') {
      mapRef.current?.recenter(userPos.lat, userPos.lng);
      fetchLocalWeather(userPos.lat, userPos.lng).then(setWeather);
      await loadNearby(userPos.lat, userPos.lng, radiusMeters, userPos.lat, userPos.lng, '');
    } else {
      mapRef.current?.panToArea(area.lat, area.lng, 14);
      fetchLocalWeather(area.lat, area.lng).then(setWeather);
      await loadNearby(area.lat, area.lng, Math.max(radiusMeters, 3000), userPos.lat, userPos.lng, area.query);
    }
  }

  // Add any custom Town, Municipality, Barangay, or Province
  async function handleAddCustomArea() {
    if (!customAreaInput.trim()) return;
    const found = await geocodeAreaLocation(customAreaInput.trim());
    setCustomAreaModalOpen(false);
    setCustomAreaInput('');
    if (found) {
      setAreaList((prev) => [prev[0], found, ...prev.slice(1)]);
      handleSelectArea(found);
    }
  }

  // Remote Google Maps + Multi-Engine Search (Scoped to active Town/Municipality or GPS)
  useEffect(() => {
    if (searchQuery.trim().length < 2) return;
    let cancelled = false;
    setLoadingPlaces(true);

    const timer = setTimeout(async () => {
      const results = await searchPlacesByQuery(
        searchQuery.trim(),
        scanCenter.lat,
        scanCenter.lng,
        userPos.lat,
        userPos.lng,
        scanCenter.label
      );
      if (cancelled) return;
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
      setLoadingPlaces(false);
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const normalizeStr = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/['’`\-.,]/g, '');

  const filteredPlaces = useMemo(() => {
    const q = normalizeStr(searchQuery.trim());
    return allPlaces.filter((p) => {
      if (activeCategory === 'favorites' && !favorites.includes(p.id)) return false;
      if (activeCategory === 'tried' && !diary[p.id]) return false;
      if (
        activeCategory !== 'all' &&
        activeCategory !== 'favorites' &&
        activeCategory !== 'tried' &&
        p.category !== activeCategory
      ) {
        return false;
      }
      if (q) {
        const hay = normalizeStr(`${p.name} ${p.typeLabel} ${p.address}`);
        const words = q.split(/\s+/).filter(Boolean);
        return words.some((w) => hay.includes(w));
      }
      return true;
    });
  }, [allPlaces, activeCategory, searchQuery, favorites, diary]);

  useEffect(() => {
    if (!mapReady) return;
    mapRef.current?.renderPOIs(filteredPlaces, selectedPlace ? selectedPlace.id : null);
  }, [filteredPlaces, selectedPlace, mapReady]);

  async function handleCravingPress(craving) {
    if (activeCraving === craving.id) {
      setActiveCraving(null);
      setSearchQuery('');
      return;
    }
    setActiveCraving(craving.id);
    if (craving.id === 'hotels' || craving.id === 'resorts') {
      setActiveCategory('hotel');
    } else {
      setActiveCategory('all');
    }
    setLoadingPlaces(true);
    const hits = await searchPlacesByQuery(
      craving.query,
      scanCenter.lat,
      scanCenter.lng,
      userPos.lat,
      userPos.lng,
      scanCenter.label
    );
    if (hits.length > 0) {
      setAllPlaces((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        const merged = [...prev];
        hits.forEach((r) => {
          if (!ids.has(r.id)) merged.push(r);
        });
        return recalculateDistances(merged, userPos.lat, userPos.lng);
      });
    }
    setSearchQuery(craving.query.split(' ')[0]);
    setLoadingPlaces(false);
  }

  async function handleMapTap(lat, lng) {
    if (hapticsEnabled) Vibration.vibrate(70);
    const spot = await reverseGeocodePoint(lat, lng, userPos.lat, userPos.lng);
    setAllPlaces((prev) => recalculateDistances([spot, ...prev], userPos.lat, userPos.lng));
    startNavigation(spot);
  }

  async function startNavigation(place, customMode = travelMode) {
    stopWalkSimulator();
    arrivedTriggeredRef.current = false;
    lastSpokenStepRef.current = -1;
    setSelectedPlace(place);
    setSheetMinimized(true);
    if (hapticsEnabled) Vibration.vibrate(60);

    // Automatically switch to Ride mode if destination is in another town (> 3.5 km away)
    const effectiveMode =
      place.distanceMeters > 3500 && customMode === 'foot' ? 'driving' : customMode;
    if (effectiveMode !== travelMode) setTravelMode(effectiveMode);

    const route = await calculateStreetRoute(userPos.lat, userPos.lng, place, effectiveMode);
    setActiveRoute(route);
    mapRef.current?.drawRoute(route.coords);

    const state = computeLiveWalkState(userPos.lat, userPos.lng, route, place, effectiveMode);
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

  async function sharePlaceAndETA(place) {
    if (!place) return;
    const dist = liveNav ? liveNav.remainingText : place.distanceText;
    const mins = liveNav ? liveNav.remainingMins : place.walkMinutes;
    const gmapUrl = `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
    try {
      await Share.share({
        message: `${place.emoji || '📍'} Heading to ${place.name} (${place.address})!\n📍 Distance: ${dist} away (~${mins} min)\n🗺️ Google Maps Pin: ${gmapUrl}`
      });
    } catch (e) {}
  }

  function openDiaryModal(place) {
    const existing = diary[place.id] || { rating: 5, note: '' };
    setDraftRating(existing.rating || 5);
    setDraftNote(existing.note || '');
    setDiaryModalPlace(place);
  }

  function saveDiaryEntry() {
    if (!diaryModalPlace) return;
    const nextDiary = {
      ...diary,
      [diaryModalPlace.id]: {
        rating: draftRating,
        note: draftNote.trim(),
        visitedAt: new Date().toLocaleDateString()
      }
    };
    setDiary(nextDiary);
    AsyncStorage.setItem('cravenav_diary', JSON.stringify(nextDiary)).catch(() => {});
    setDiaryModalPlace(null);
    if (hapticsEnabled) Vibration.vibrate(60);
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
    if (hapticsEnabled) Vibration.vibrate(80);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    setRouletteWinner(pick);
  }

  function cycleRadius() {
    const idx = Math.max(0, RADII.findIndex((r) => r.value === radiusMeters));
    const next = RADII[(idx + 1) % RADII.length].value;
    setRadiusMeters(next);
    loadNearby(scanCenter.lat, scanCenter.lng, next, userPos.lat, userPos.lng, scanCenter.label);
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
          onMapReady={() => setMapReady(true)}
          onSelectPlaceId={(placeId) => {
            const found = allPlaces.find((p) => p.id === placeId);
            if (found) startNavigation(found);
          }}
          onMapTap={handleMapTap}
        />
      </View>

      {/* Top Navigation HUD */}
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
            <TouchableOpacity
              style={styles.shareHudBtn}
              onPress={() => sharePlaceAndETA(selectedPlace)}
            >
              <Text style={{ fontSize: 16 }}>📤</Text>
            </TouchableOpacity>
          </View>

          {compassInfo && (
            <View style={styles.compassBanner}>
              <Text style={styles.compassArrow}>{compassInfo.arrow}</Text>
              <Text style={styles.compassText}>
                Compass: <Text style={{ color: '#fff', fontWeight: '800' }}>{compassInfo.label}</Text>{' '}
                ({compassInfo.targetBearing}° • Facing {heading}°)
              </Text>
            </View>
          )}

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

          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${liveNav.progressPercent}%` }]} />
          </View>

          <View style={styles.navControlsRow}>
            <TouchableOpacity
              style={[styles.navBtn, isSimulating && styles.navBtnActive]}
              onPress={toggleWalkSimulator}
            >
              <Text style={styles.navBtnText}>
                {isSimulating ? '⏸️ Pause' : '🚶 Sim Walk'}
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

            <TouchableOpacity
              style={styles.navBtn}
              onPress={() => setHapticsEnabled(!hapticsEnabled)}
            >
              <Text style={styles.navBtnText}>{hapticsEnabled ? '📳 Buzz' : '📴 Off'}</Text>
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
          onPress={() => {
            setActiveArea(areaList[0]);
            mapRef.current?.recenter(userPos.lat, userPos.lng);
          }}
        >
          <Text style={styles.fabText}>🎯</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.fabBtn}
          onPress={() =>
            loadNearby(
              scanCenter.lat,
              scanCenter.lng,
              radiusMeters,
              userPos.lat,
              userPos.lng,
              scanCenter.label
            )
          }
        >
          <Text style={styles.fabText}>🔄</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.fabBtn} onPress={() => mapRef.current?.cycleLayer()}>
          <Text style={styles.fabText}>🗺️</Text>
        </TouchableOpacity>
      </View>

      {/* Bottom Restaurant & Hotel Explorer Sheet */}
      <View style={[styles.bottomSheet, sheetMinimized && styles.bottomSheetMinimized]}>
        <TouchableOpacity
          style={styles.sheetHandleWrap}
          onPress={() => setSheetMinimized(!sheetMinimized)}
        >
          <View style={styles.sheetHandle} />
        </TouchableOpacity>

        {/* Brand Header + Live Weather Badge */}
        <View style={styles.headerRow}>
          <View style={styles.brandGroup}>
            <View style={styles.brandIcon}>
              <Text style={{ fontSize: 19 }}>🍜</Text>
            </View>
            <View>
              <Text style={styles.brandTitle}>CraveNav • Food & Hotels</Text>
              <Text style={styles.brandSub}>
                {weather.icon} {weather.temp} • {weather.advice}
              </Text>
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
                  placeholder="Search restaurants, hotels, resorts, cafés..."
                  placeholderTextColor="#64748b"
                  value={searchQuery}
                  onChangeText={(txt) => {
                    setSearchQuery(txt);
                    if (!txt) setActiveCraving(null);
                  }}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => {
                      setSearchQuery('');
                      setActiveCraving(null);
                    }}
                  >
                    <Text style={{ color: '#94a3b8', paddingHorizontal: 4 }}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
              <TouchableOpacity style={styles.rouletteBtn} onPress={spinRandomRestaurant}>
                <Text style={{ fontSize: 18 }}>🎲</Text>
              </TouchableOpacity>
            </View>

            {/* NEW: Municipality / Town / Barangay / City Filter Bar */}
            <View style={{ height: 34, marginBottom: 4 }}>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={[...areaList, { id: 'add_custom', label: '➕ Any Town / Brgy...' }]}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.chipsList}
                renderItem={({ item }) => {
                  if (item.id === 'add_custom') {
                    return (
                      <TouchableOpacity
                        style={styles.addAreaChip}
                        onPress={() => setCustomAreaModalOpen(true)}
                      >
                        <Text style={styles.addAreaText}>{item.label}</Text>
                      </TouchableOpacity>
                    );
                  }
                  const isAct = activeArea && activeArea.id === item.id;
                  return (
                    <TouchableOpacity
                      style={[styles.areaChip, isAct && styles.areaChipActive]}
                      onPress={() => handleSelectArea(item)}
                    >
                      <Text style={[styles.areaChipText, isAct && styles.areaChipTextActive]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
              />
            </View>

            {/* 1-Tap Craving & Hotel Quick Pills */}
            <View style={{ height: 32, marginBottom: 4 }}>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={CRAVINGS}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.chipsList}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.cravingChip,
                      activeCraving === item.id && styles.cravingChipActive
                    ]}
                    onPress={() => handleCravingPress(item)}
                  >
                    <Text
                      style={[
                        styles.cravingText,
                        activeCraving === item.id && styles.cravingTextActive
                      ]}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                )}
              />
            </View>

            {/* Category Chips (All Spots, Hotels & Stays, Restaurants, Fast Food, Cafés, Saved, Tried) */}
            <View style={{ height: 36 }}>
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
                  {filteredPlaces.length} spots in {activeArea.label.replace(/^[^\w]+/, '')} •{' '}
                  {(radiusMeters / 1000).toFixed(1)} km ▾
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
                <Text style={styles.emptyText}>
                  🔍 Scanning restaurants & hotels in {activeArea.label}...
                </Text>
              </View>
            ) : (
              <FlatList
                data={filteredPlaces}
                keyExtractor={(item) => item.id}
                contentContainerStyle={{ paddingHorizontal: 14, paddingBottom: 20 }}
                renderItem={({ item }) => {
                  const isSel = selectedPlace && selectedPlace.id === item.id;
                  const isFav = favorites.includes(item.id);
                  const diaryEntry = diary[item.id];
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
                          {diaryEntry && (
                            <Text style={styles.diaryBadge} numberOfLines={1}>
                              ✅ Tried: {'⭐'.repeat(diaryEntry.rating)}{' '}
                              {diaryEntry.note ? `— "${diaryEntry.note}"` : ''}
                            </Text>
                          )}
                        </View>
                        <View style={styles.distPill}>
                          <Text style={styles.distPillText}>{item.distanceText}</Text>
                        </View>
                      </View>

                      <View style={styles.cardBottom}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                          <Text style={styles.etaLabel}>
                            {item.distanceMeters > 3500
                              ? `🛵 ~${Math.max(1, Math.round(item.distanceMeters / 450))}m ride`
                              : `🚶 ~${item.walkMinutes}m walk`}
                          </Text>
                          <TouchableOpacity onPress={() => toggleFavorite(item.id)}>
                            <Text style={{ fontSize: 15 }}>{isFav ? '❤️' : '🤍'}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => openDiaryModal(item)}>
                            <Text style={{ fontSize: 13, color: '#fbbf24', fontWeight: '700' }}>
                              {diaryEntry ? '📝 Edit Note' : '⭐ Rate'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => sharePlaceAndETA(item)}>
                            <Text style={{ fontSize: 14 }}>📤</Text>
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

      {/* Custom Town / Municipality / Barangay Modal */}
      <Modal visible={customAreaModalOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={{ fontSize: 38, marginBottom: 6 }}>🗺️</Text>
            <Text style={styles.modalTitle}>Jump to Any Town or Barangay</Text>
            <Text style={styles.modalSub}>
              Enter any Municipality (Bayan), Barangay, District, or City to scan all its
              restaurants & hotels:
            </Text>

            <TextInput
              style={styles.diaryInput}
              placeholder="e.g. Ibabang Dupay, Atimonan, Unisan, Calamba..."
              placeholderTextColor="#64748b"
              value={customAreaInput}
              onChangeText={setCustomAreaInput}
              onSubmitEditing={handleAddCustomArea}
            />

            <TouchableOpacity style={styles.modalPrimaryBtn} onPress={handleAddCustomArea}>
              <Text style={styles.modalPrimaryBtnText}>🔍 Scan This Area</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setCustomAreaModalOpen(false)}
              style={{ marginTop: 12 }}
            >
              <Text style={{ color: '#94a3b8', fontSize: 13 }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Personal Food & Hotel Diary Modal */}
      <Modal visible={!!diaryModalPlace} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          {diaryModalPlace && (
            <View style={styles.modalCard}>
              <Text style={{ fontSize: 38, marginBottom: 6 }}>{diaryModalPlace.emoji}</Text>
              <Text style={styles.modalTitle}>{diaryModalPlace.name}</Text>
              <Text style={styles.modalSub}>Save Your Rating & Personal Note</Text>

              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <TouchableOpacity key={star} onPress={() => setDraftRating(star)}>
                    <Text style={{ fontSize: 28, opacity: star <= draftRating ? 1 : 0.25 }}>
                      ⭐
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                style={styles.diaryInput}
                placeholder="Write a note (e.g. Great room / Best overload lomi)"
                placeholderTextColor="#64748b"
                value={draftNote}
                onChangeText={setDraftNote}
              />

              <TouchableOpacity style={styles.modalPrimaryBtn} onPress={saveDiaryEntry}>
                <Text style={styles.modalPrimaryBtnText}>✅ Save to Diary</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setDiaryModalPlace(null)}
                style={{ marginTop: 12 }}
              >
                <Text style={{ color: '#94a3b8', fontSize: 13 }}>Cancel</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Modal>

      {/* Random Roulette Modal */}
      <Modal visible={!!rouletteWinner} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          {rouletteWinner && (
            <View style={styles.modalCard}>
              <Text style={{ fontSize: 48, marginBottom: 8 }}>{rouletteWinner.emoji}</Text>
              <Text style={styles.modalTitle}>{rouletteWinner.name}</Text>
              <Text style={styles.modalSub}>
                {rouletteWinner.typeLabel} • {rouletteWinner.distanceText} away
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
              <Text style={{ fontSize: 48, marginBottom: 8 }}>🎉🏁</Text>
              <Text style={styles.modalTitle}>You Have Arrived!</Text>
              <Text style={styles.modalSub}>You made it to {arrivalPlace.name}!</Text>
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={() => {
                  const p = arrivalPlace;
                  setArrivalPlace(null);
                  openDiaryModal(p);
                }}
              >
                <Text style={styles.modalPrimaryBtnText}>⭐ Rate & Add Note</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setArrivalPlace(null)}
                style={{ marginTop: 12 }}
              >
                <Text style={{ color: '#94a3b8', fontSize: 13 }}>Done</Text>
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
    backgroundColor: 'rgba(12, 18, 28, 0.96)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.45)',
    padding: 12,
    zIndex: 30
  },
  turnBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
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
  shareHudBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  compassBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.35)',
    borderRadius: 9,
    paddingVertical: 5,
    paddingHorizontal: 10,
    marginBottom: 8
  },
  compassArrow: { fontSize: 16, marginRight: 8 },
  compassText: { color: '#93c5fd', fontSize: 11.5 },
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
  navControlsRow: { flexDirection: 'row', gap: 5 },
  navBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center'
  },
  navBtnActive: { backgroundColor: 'rgba(59, 130, 246, 0.35)' },
  stopBtn: { backgroundColor: 'rgba(239, 68, 68, 0.2)', flex: 0.75 },
  navBtnText: { color: '#fff', fontSize: 10.5, fontWeight: '700' },
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
    height: '56%',
    backgroundColor: 'rgba(16, 22, 34, 0.96)',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    zIndex: 25
  },
  bottomSheetMinimized: { height: 78 },
  sheetHandleWrap: { alignItems: 'center', paddingVertical: 7 },
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
    paddingBottom: 6
  },
  brandGroup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#ff5722',
    alignItems: 'center',
    justifyContent: 'center'
  },
  brandTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  brandSub: { color: '#38bdf8', fontSize: 11, fontWeight: '600' },
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
  searchRow: { flexDirection: 'row', paddingHorizontal: 14, gap: 8, marginBottom: 5 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(10, 14, 23, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 11,
    paddingHorizontal: 10,
    height: 36
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 12.5 },
  rouletteBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(245, 158, 11, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.45)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  chipsList: { paddingHorizontal: 14, alignItems: 'center', gap: 6 },
  areaChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    marginRight: 6
  },
  areaChipActive: {
    backgroundColor: '#10b981',
    borderColor: '#34d399'
  },
  areaChipText: { color: '#6ee7b7', fontSize: 11, fontWeight: '700' },
  areaChipTextActive: { color: '#fff' },
  addAreaChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(245, 158, 11, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    marginRight: 6
  },
  addAreaText: { color: '#fbbf24', fontSize: 11, fontWeight: '700' },
  cravingChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
    marginRight: 6
  },
  cravingChipActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#60a5fa'
  },
  cravingText: { color: '#93c5fd', fontSize: 11, fontWeight: '600' },
  cravingTextActive: { color: '#fff' },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginRight: 6
  },
  chipActive: { backgroundColor: '#ff5722' },
  chipText: { color: '#94a3b8', fontSize: 11.5, fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  subToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 5,
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
  subToolbarText: { color: '#cbd5e1', fontSize: 11, fontWeight: '600' },
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
  emptyText: { color: '#94a3b8', fontSize: 13, textAlign: 'center' },
  placeCard: {
    backgroundColor: 'rgba(26, 35, 52, 0.85)',
    borderRadius: 12,
    padding: 11,
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
  diaryBadge: { color: '#fbbf24', fontSize: 11, fontWeight: '600', marginTop: 3 },
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
  modalTitle: { color: '#fff', fontSize: 19, fontWeight: '800', textAlign: 'center' },
  modalSub: {
    color: '#94a3b8',
    fontSize: 12.5,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 14
  },
  diaryInput: {
    width: '100%',
    backgroundColor: 'rgba(10, 14, 23, 0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 13,
    marginBottom: 14
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
