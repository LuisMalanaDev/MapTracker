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
  ScrollView,
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
import BudgetSystemModal from './src/components/BudgetSystemModal';
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
  const lastHeadingTimeRef = useRef(0);
  const lastHeadingValRef = useRef(0);
  const lastDistCalcPosRef = useRef({ lat: 0, lng: 0 });
  const headingNeededRef = useRef(false);
  const lastRerouteTimeRef = useRef(0);
  const reroutingInFlightRef = useRef(false);

  const [userPos, setUserPos] = useState({ lat: 13.9414, lng: 121.6234 });
  const [heading, setHeading] = useState(0);
  const [gpsStatus, setGpsStatus] = useState('Locating...');
  const [weather, setWeather] = useState({ icon: '⛅', temp: '29°C', advice: 'Good walking weather' });
  const [mapReady, setMapReady] = useState(false);

  // Area / Municipality / Town / Barangay Filter State
  const [areaList, setAreaList] = useState(AREA_PRESETS);
  const [activeArea, setActiveArea] = useState(AREA_PRESETS[0]); // Default: 'gps' (Near Me)
  const [customAreaModalOpen, setCustomAreaModalOpen] = useState(false);
  const [cravingModalOpen, setCravingModalOpen] = useState(false);
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

  // Feature #14: Point-Your-Phone Compass Radar Modal + Parked/Hotel Return Pin
  const [radarModalOpen, setRadarModalOpen] = useState(false);
  const [savedPinSpot, setSavedPinSpot] = useState(null);

  // Centralized Budgeting System (WealthSync Edition) Connected to Map Tracker
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [budgetTab, setBudgetTab] = useState('overview'); // 'overview' | 'spend' | 'budgets' | 'history'
  const [accounts, setAccounts] = useState([
    { id: 'acc_gcash', name: 'GCash', type: 'GCASH', balance: 0 },
    { id: 'acc_maya', name: 'Maya', type: 'MAYA', balance: 0 },
    { id: 'acc_cash', name: 'Physical Cash', type: 'CASH', balance: 0 },
    { id: 'acc_bank', name: 'Bank', type: 'BANK', balance: 0 }
  ]);
  const [expectedIncome, setExpectedIncome] = useState(0);
  const [walletHistory, setWalletHistory] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [vaults, setVaults] = useState([]);

  const walletBalance = useMemo(
    () => accounts.reduce((sum, a) => sum + Number(a.balance || 0), 0),
    [accounts]
  );

  // Draft inputs for Map-Connected Quick Log (Place + Route Transpo)
  const [expensePlace, setExpensePlace] = useState(null);
  const [expensePlaceName, setExpensePlaceName] = useState('');
  const [expenseFoodInput, setExpenseFoodInput] = useState('');
  const [expenseTranspoInput, setExpenseTranspoInput] = useState('');

  // Load saved favorites, food/hotel diary, parked pin & Centralized Budgeting System state
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

    AsyncStorage.getItem('cravenav_saved_pin')
      .then((raw) => {
        if (raw) setSavedPinSpot(JSON.parse(raw));
      })
      .catch(() => {});

    AsyncStorage.getItem('cravenav_cbs_v3')
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.accounts)) setAccounts(parsed.accounts);
          if (typeof parsed.expected === 'number') setExpectedIncome(parsed.expected);
          if (Array.isArray(parsed.history)) setWalletHistory(parsed.history);
          if (Array.isArray(parsed.budgets)) setBudgets(parsed.budgets);
          if (Array.isArray(parsed.vaults)) setVaults(parsed.vaults);
        }
      })
      .catch(() => {});
  }, []);

  function persistCBS(
    nextAccounts = accounts,
    nextExpected = expectedIncome,
    nextHistory = walletHistory,
    nextBudgets = budgets,
    nextVaults = vaults
  ) {
    setAccounts(nextAccounts);
    setExpectedIncome(nextExpected);
    setWalletHistory(nextHistory);
    setBudgets(nextBudgets);
    setVaults(nextVaults);
    AsyncStorage.setItem(
      'cravenav_cbs_v3',
      JSON.stringify({
        accounts: nextAccounts,
        expected: nextExpected,
        history: nextHistory,
        budgets: nextBudgets,
        vaults: nextVaults
      })
    ).catch(() => {});
  }

  // Estimate realistic local Tricycle / Jeep / Ride transpo fare from map distance
  function estimateTranspoFare(distanceMeters, mode = travelMode) {
    if (mode === 'foot' && distanceMeters <= 600) return 0;
    const km = Math.max(0.5, distanceMeters / 1000);
    // Base ₱20 for first km + ₱10 per additional km
    return Math.round(20 + Math.max(0, km - 1) * 10);
  }

  // Estimate calories burned when walking
  function estimateWalkCalories(distanceMeters) {
    return Math.max(5, Math.round((distanceMeters / 1000) * 52));
  }

  // Real-time peak-hour crowd estimator
  const crowdBadge = useMemo(() => {
    const hr = new Date().getHours();
    if ((hr >= 11 && hr <= 13) || (hr >= 18 && hr <= 20)) {
      return { dot: '🔴', label: 'Peak Hour' };
    }
    if ((hr >= 8 && hr <= 10) || (hr >= 14 && hr <= 17)) {
      return { dot: '🟡', label: 'Moderate' };
    }
    return { dot: '🟢', label: 'Quiet Now' };
  }, []);

  // Open Centralized Budgeting System pre-connected to a Map Restaurant/Hotel & its Route Transpo Cost
  function openSpendForPlace(place) {
    if (hapticsEnabled) Vibration.vibrate(50);
    const target = place || selectedPlace;
    if (target) {
      const dist =
        liveNav && selectedPlace?.id === target.id
          ? liveNav.remainingMeters
          : target.distanceMeters || 1000;
      const autoFare = estimateTranspoFare(dist, 'driving');
      setExpensePlace(target);
      setExpensePlaceName(`${target.emoji || '🍽️'} ${target.name}`);
      setExpenseTranspoInput(String(autoFare));
    } else {
      setExpensePlace(null);
      setExpensePlaceName('');
      setExpenseTranspoInput('30');
    }
    setExpenseFoodInput('');
    setBudgetTab('spend');
    setBudgetModalOpen(true);
  }

  function handleUpdateWalletBalance(accId, newBalVal) {
    const nextAccs = accounts.map((a) =>
      a.id === accId ? { ...a, balance: Math.max(0, Number(newBalVal) || 0) } : a
    );
    persistCBS(nextAccs, expectedIncome, walletHistory, budgets, vaults);
    if (hapticsEnabled) Vibration.vibrate(50);
  }

  function handleRecordMapTripExpense(paymentMethod = 'CASH') {
    const foodVal = Math.max(0, parseFloat(expenseFoodInput) || 0);
    const transpoVal = Math.max(0, parseFloat(expenseTranspoInput) || 0);
    const total = foodVal + transpoVal;
    if (total <= 0) return;

    const now = new Date();
    const timeStr = `${now.toLocaleDateString()} • ${now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })}`;

    const isHotel = expensePlace?.category === 'hotel';
    const primaryCat =
      foodVal > 0
        ? isHotel
          ? 'Hotels & Staycation'
          : 'Food & Dining'
        : 'Transportation';

    const nextAccs = accounts.map((a) =>
      a.type === paymentMethod ? { ...a, balance: Number(a.balance || 0) - total } : a
    );

    const newEntries = [];
    if (foodVal > 0 && transpoVal > 0) {
      // Create unified map trip entry with breakdown + accurate category tracking
      newEntries.push({
        id: `tx_${Date.now()}`,
        type: 'EXPENSE',
        category: primaryCat,
        paymentMethod,
        description: expensePlaceName.trim() || 'Map Meal & Transpo Trip',
        emoji: expensePlace?.emoji || '🍔',
        foodCost: foodVal,
        transpoCost: transpoVal,
        amount: total,
        dateText: timeStr,
        areaLabel: activeArea?.label || 'Map Spot'
      });
    } else {
      newEntries.push({
        id: `tx_${Date.now()}`,
        type: 'EXPENSE',
        category: primaryCat,
        paymentMethod,
        description: expensePlaceName.trim() || primaryCat,
        emoji: expensePlace?.emoji || (transpoVal > 0 ? '🛵' : '🍔'),
        foodCost: foodVal,
        transpoCost: transpoVal,
        amount: total,
        dateText: timeStr,
        areaLabel: activeArea?.label || 'Map Spot'
      });
    }

    const nextHist = [...newEntries, ...walletHistory];
    persistCBS(nextAccs, expectedIncome, nextHist, budgets, vaults);
    setExpenseFoodInput('');
    setBudgetTab('overview');
    if (hapticsEnabled) Vibration.vibrate(70);
  }

  function handleRecordGeneralTransaction({ type, amount, category, paymentMethod, description }) {
    const val = Number(amount) || 0;
    if (val <= 0) return;
    const now = new Date();
    const timeStr = `${now.toLocaleDateString()} • ${now.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit'
    })}`;

    const nextAccs = accounts.map((a) => {
      if (a.type !== paymentMethod) return a;
      return {
        ...a,
        balance: type === 'INCOME' ? Number(a.balance || 0) + val : Number(a.balance || 0) - val
      };
    });

    const entry = {
      id: `tx_${Date.now()}`,
      type,
      category,
      paymentMethod,
      description: description || category,
      emoji: type === 'INCOME' ? '💵' : category === 'Transportation' ? '🛵' : '💸',
      foodCost: 0,
      transpoCost: 0,
      amount: val,
      dateText: timeStr
    };

    persistCBS(nextAccs, expectedIncome, [entry, ...walletHistory], budgets, vaults);
    if (hapticsEnabled) Vibration.vibrate(70);
  }

  function handleClaimExpectedSalary() {
    if (expectedIncome <= 0) return;
    handleRecordGeneralTransaction({
      type: 'INCOME',
      amount: expectedIncome,
      category: 'Salary / Wages',
      paymentMethod: 'CASH',
      description: 'Received Future Salary / Earnings'
    });
  }

  function handleUndoTransaction(tx) {
    const nextHist = walletHistory.filter((item) => item.id !== tx.id);
    const amt = Number(tx.amount || tx.totalAmount || 0);
    const method = tx.paymentMethod || 'CASH';
    const nextAccs = accounts.map((a) => {
      if (a.type !== method) return a;
      const isExp = tx.type === 'EXPENSE' || tx.type === 'expense';
      return {
        ...a,
        balance: isExp ? Number(a.balance || 0) + amt : Number(a.balance || 0) - amt
      };
    });
    persistCBS(nextAccs, expectedIncome, nextHist, budgets, vaults);
    if (hapticsEnabled) Vibration.vibrate(50);
  }

  function handleSaveBudgetCap(category, limit) {
    const existing = budgets.find((b) => b.category === category);
    const nextBudgets = existing
      ? budgets.map((b) => (b.category === category ? { ...b, limit } : b))
      : [...budgets, { id: `b_${Date.now()}`, category, limit }];
    persistCBS(accounts, expectedIncome, walletHistory, nextBudgets, vaults);
    if (hapticsEnabled) Vibration.vibrate(50);
  }

  function handleDeleteBudgetCap(id) {
    const nextBudgets = budgets.filter((b) => b.id !== id);
    persistCBS(accounts, expectedIncome, walletHistory, nextBudgets, vaults);
  }

  function handleCreateVault(name, targetAmount, currentAmount = 0) {
    const nextVaults = [
      ...vaults,
      { id: `v_${Date.now()}`, name, targetAmount, currentAmount }
    ];
    persistCBS(accounts, expectedIncome, walletHistory, budgets, nextVaults);
    if (hapticsEnabled) Vibration.vibrate(60);
  }

  function handleVaultAction(vaultId, actionType, amount) {
    const nextVaults = vaults.map((v) => {
      if (v.id !== vaultId) return v;
      const nextAmt =
        actionType === 'DEPOSIT'
          ? Number(v.currentAmount || 0) + amount
          : Math.max(0, Number(v.currentAmount || 0) - amount);
      return { ...v, currentAmount: nextAmt };
    });
    persistCBS(accounts, expectedIncome, walletHistory, budgets, nextVaults);
    if (hapticsEnabled) Vibration.vibrate(60);
  }

  function handleDeleteVault(vaultId) {
    const nextVaults = vaults.filter((v) => v.id !== vaultId);
    persistCBS(accounts, expectedIncome, walletHistory, budgets, nextVaults);
  }

  // Save or Return to Parked Bike/Car or Hotel Room
  function handlePinCurrentSpot() {
    const spot = {
      id: 'saved_return_pin',
      name: 'My Parked Spot / Hotel Room',
      lat: userPos.lat,
      lng: userPos.lng,
      category: 'hotel',
      emoji: '📌',
      typeLabel: 'Saved Return Point',
      address: `${userPos.lat.toFixed(5)}, ${userPos.lng.toFixed(5)}`,
      distanceMeters: 0,
      distanceText: '0 m',
      walkMinutes: 1
    };
    setSavedPinSpot(spot);
    AsyncStorage.setItem('cravenav_saved_pin', JSON.stringify(spot)).catch(() => {});
    if (hapticsEnabled) Vibration.vibrate(70);
  }

  const walletTotals = useMemo(() => {
    let foodTotal = 0;
    let transpoTotal = 0;
    walletHistory.forEach((tx) => {
      if (tx.type === 'expense') {
        foodTotal += tx.foodCost || 0;
        transpoTotal += tx.transpoCost || 0;
      }
    });
    return { foodTotal, transpoTotal, totalSpent: foodTotal + transpoTotal };
  }, [walletHistory]);

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
            timeInterval: 3000,
            distanceInterval: 5
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
          const now = Date.now();
          if (now - lastHeadingTimeRef.current < 180) return;
          // Prefer GPS-calibrated True North heading; fallback to Magnetic North
          const rawDeg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          if (typeof rawDeg === 'number' && !isNaN(rawDeg)) {
            // Circular shortest-angle smoothing to filter out hand tremor / magnetic noise
            const prev = lastHeadingValRef.current;
            const diff = ((((rawDeg - prev) % 360) + 540) % 360) - 180;
            if (Math.abs(diff) >= 2.5) {
              const smoothed = (prev + diff * 0.45 + 360) % 360;
              const rounded = Math.round(smoothed);
              lastHeadingTimeRef.current = now;
              lastHeadingValRef.current = smoothed;
              // Directly rotate the blue circle arrow & cone in the map WebView (zero React re-render lag!)
              mapRef.current?.updateHeading(rounded);
              // Only trigger React state re-render when Radar Modal or Active Navigation HUD is open
              if (headingNeededRef.current) {
                setHeading(rounded);
              }
            }
          }
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

  // Keep headingNeededRef synced so compass hardware never causes idle re-renders
  useEffect(() => {
    headingNeededRef.current = Boolean(radarModalOpen || selectedPlace);
  }, [radarModalOpen, selectedPlace]);

  // Sync user position with Map & Live Navigation Progress
  useEffect(() => {
    if (!mapReady) return;

    // Only recalculate allPlaces distances if user moved at least ~15 meters
    const movedDist = Math.hypot(
      userPos.lat - lastDistCalcPosRef.current.lat,
      userPos.lng - lastDistCalcPosRef.current.lng
    );
    if (allPlaces.length > 0 && movedDist > 0.00014) {
      lastDistCalcPosRef.current = { lat: userPos.lat, lng: userPos.lng };
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

        // Automatic Live Off-Route Street Rerouting (when user takes a different street/path)
        const now = Date.now();
        if (
          state.needsReroute &&
          !reroutingInFlightRef.current &&
          now - lastRerouteTimeRef.current > 4000
        ) {
          reroutingInFlightRef.current = true;
          lastRerouteTimeRef.current = now;
          calculateStreetRoute(userPos.lat, userPos.lng, selectedPlace, travelMode)
            .then((freshRoute) => {
              if (freshRoute && freshRoute.coords && freshRoute.coords.length >= 2) {
                setActiveRoute(freshRoute);
                const freshState = computeLiveWalkState(
                  userPos.lat,
                  userPos.lng,
                  freshRoute,
                  selectedPlace,
                  travelMode
                );
                if (freshState) {
                  setLiveNav(freshState);
                  mapRef.current?.updateWalkPath(
                    freshState.remainingCoords,
                    freshState.walkedCoords
                  );
                }
              }
            })
            .catch(() => {})
            .finally(() => {
              reroutingInFlightRef.current = false;
            });
        }

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

  // Feature #14: Compute restaurants & hotels directly in front of where phone is pointing (only when Radar modal is open)
  const radarPlaces = useMemo(() => {
    if (!radarModalOpen) return [];
    const pool = filteredPlaces.length > 0 ? filteredPlaces : allPlaces;
    return pool
      .map((p) => {
        const bearing = calculateBearing(userPos.lat, userPos.lng, p.lat, p.lng);
        const relDeg = (bearing - heading + 360) % 360;
        const signedAngle = relDeg > 180 ? relDeg - 360 : relDeg; // -180 to +180
        const absAngle = Math.abs(signedAngle);
        let sector = 'behind';
        if (absAngle <= 30) sector = 'ahead';
        else if (signedAngle > 30 && signedAngle <= 100) sector = 'right';
        else if (signedAngle < -30 && signedAngle >= -100) sector = 'left';
        return {
          ...p,
          bearing: Math.round(bearing),
          signedAngle: Math.round(signedAngle),
          absAngle: Math.round(absAngle),
          sector
        };
      })
      .sort((a, b) => a.absAngle - b.absAngle);
  }, [radarModalOpen, filteredPlaces, allPlaces, userPos, heading]);

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
    // Do not change or cancel destination when clicking on the map
    if (selectedPlace) return;
  }

  async function startNavigation(place, customMode = travelMode) {
    stopWalkSimulator();
    arrivedTriggeredRef.current = false;
    lastSpokenStepRef.current = -1;
    setSelectedPlace(place);
    setSheetMinimized(true);
    if (hapticsEnabled) Vibration.vibrate(60);

    // Immediately zoom map to frame ONLY You + Selected Destination clearly
    mapRef.current?.focusPair(place.lat, place.lng);

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
          places={
            selectedPlace
              ? [
                  {
                    ...selectedPlace,
                    livePinSub: liveNav
                      ? `${liveNav.remainingText} • ~${liveNav.remainingMins} min`
                      : `${selectedPlace.distanceText || ''} • ~${selectedPlace.walkMinutes || 1} min`
                  }
                ]
              : filteredPlaces
          }
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

      {/* Sleek Floating Top Search & Location Bar (Visible when NOT actively navigating) */}
      {!selectedPlace && (
        <View style={styles.topFloatingHeader}>
          {/* Top Row: Area Picker Pill + Live Wallet Balance Pill + Weather & Map Actions */}
          <View style={styles.topBarRow}>
            <TouchableOpacity
              style={styles.locationSelectorPill}
              onPress={() => setCustomAreaModalOpen(true)}
            >
              <View style={styles.gpsDot} />
              <Text style={styles.locationSelectorText} numberOfLines={1}>
                {activeArea.label}
              </Text>
              <Text style={styles.locationChevron}>▾</Text>
            </TouchableOpacity>

            <View style={styles.topRightActions}>
              {/* Live Map-Connected Wallet Pill */}
              <TouchableOpacity
                style={[
                  styles.walletTopPill,
                  walletBalance < 300 && styles.walletTopPillLow
                ]}
                onPress={() => {
                  setBudgetTab('overview');
                  setBudgetModalOpen(true);
                }}
              >
                <Text style={styles.walletTopPillText}>
                  💳 ₱{walletBalance.toLocaleString()}
                </Text>
              </TouchableOpacity>

              <View style={styles.weatherPill}>
                <Text style={styles.weatherPillText}>
                  {weather.icon} {weather.temp}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.topIconBtn}
                onPress={() => {
                  setActiveArea(areaList[0]);
                  mapRef.current?.recenter(userPos.lat, userPos.lng);
                }}
              >
                <Text style={{ fontSize: 14 }}>🎯</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.topIconBtn}
                onPress={() => mapRef.current?.cycleLayer()}
              >
                <Text style={{ fontSize: 14 }}>🗺️</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Second Row: Clean Modern Search Bar + Cravings (⚡) + Point-Your-Phone Radar (🧭) + Roulette (🎲) */}
          <View style={styles.floatingSearchRow}>
            <View style={styles.modernSearchBox}>
              <Text style={{ fontSize: 14, marginRight: 8, opacity: 0.7 }}>🔍</Text>
              <TextInput
                style={styles.modernSearchInput}
                placeholder="Search Jollibee, hotels, cafés, lomi..."
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
                  style={styles.clearSearchBtn}
                >
                  <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '700' }}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            <TouchableOpacity
              style={[
                styles.modernActionBtn,
                activeCraving && styles.modernActionBtnActive
              ]}
              onPress={() => setCravingModalOpen(true)}
            >
              <Text style={{ fontSize: 16 }}>⚡</Text>
            </TouchableOpacity>

            {/* Feature #14: Point-Your-Phone Live Compass Radar */}
            <TouchableOpacity
              style={styles.modernRadarBtn}
              onPress={() => setRadarModalOpen(true)}
            >
              <Text style={{ fontSize: 16 }}>🧭</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.modernRouletteBtn} onPress={spinRandomRestaurant}>
              <Text style={{ fontSize: 16 }}>🎲</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Pure Full-Screen Focus Mode Top Controls (Back/X + Fit Route + Quick Spend) */}
      {selectedPlace && (
        <View style={styles.focusOnlyTopBar}>
          <View style={styles.focusLeftRow}>
            <TouchableOpacity
              style={styles.focusBackBtn}
              activeOpacity={0.85}
              onPress={stopNavigation}
            >
              <Text style={styles.focusBackArrow}>←</Text>
              <Text style={styles.focusBackText}>Back</Text>
              <View style={styles.focusBackCloseCircle}>
                <Text style={styles.focusBackCloseX}>✕</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.focusFitBtn}
              activeOpacity={0.85}
              onPress={() => mapRef.current?.focusPair(selectedPlace.lat, selectedPlace.lng)}
            >
              <Text style={styles.focusFitBtnText}>🎯 Fit Route</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.focusSpendBtn}
            activeOpacity={0.85}
            onPress={() => openSpendForPlace(selectedPlace)}
          >
            <Text style={styles.focusSpendBtnText}>💸 Spend</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Clean Modern Bottom Sheet (Hidden completely when focused on a destination!) */}
      {!selectedPlace && (
        <View style={[styles.bottomSheet, sheetMinimized && styles.bottomSheetMinimized]}>
        <TouchableOpacity
          style={styles.sheetHandleWrap}
          onPress={() => setSheetMinimized(!sheetMinimized)}
        >
          <View style={styles.sheetHandle} />
        </TouchableOpacity>

        {/* Minimized Bar (When navigating or minimized) */}
        {sheetMinimized ? (
          <View style={styles.minimizedBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.minimizedTitle} numberOfLines={1}>
                {selectedPlace
                  ? `${selectedPlace.emoji} Focused on ${selectedPlace.name}`
                  : `${filteredPlaces.length} Places • Wallet: ₱${walletBalance.toLocaleString()}`}
              </Text>
              <Text style={styles.minimizedSub}>
                {selectedPlace
                  ? `Wallet: ₱${walletBalance.toLocaleString()} • Tap 💸₱ to log food & transpo`
                  : 'Tap handle to browse restaurants & hotels'}
              </Text>
            </View>
            {selectedPlace ? (
              <TouchableOpacity style={styles.minimizedStopBtn} onPress={stopNavigation}>
                <Text style={styles.minimizedStopText}>Show All Pins</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.minimizedExpandBtn}
                onPress={() => setSheetMinimized(false)}
              >
                <Text style={styles.minimizedExpandText}>Expand ▲</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {/* ONLY ONE Clean Category Tab Bar + Budget & Radar Quick Pills */}
            <View style={styles.categoryBarWrap}>
              <FlatList
                horizontal
                showsHorizontalScrollIndicator={false}
                data={[
                  { id: 'wallet_btn', label: `💳 Budget (₱${walletBalance.toLocaleString()})` },
                  { id: 'radar_btn', label: `🧭 Point Radar (${heading}°)` },
                  ...CATEGORIES
                ]}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.cleanChipsList}
                renderItem={({ item }) => {
                  if (item.id === 'wallet_btn') {
                    return (
                      <TouchableOpacity
                        style={styles.walletCategoryChip}
                        onPress={() => {
                          setBudgetTab('overview');
                          setBudgetModalOpen(true);
                        }}
                      >
                        <Text style={styles.walletCategoryChipText}>{item.label}</Text>
                      </TouchableOpacity>
                    );
                  }
                  if (item.id === 'radar_btn') {
                    return (
                      <TouchableOpacity
                        style={styles.radarCategoryChip}
                        onPress={() => setRadarModalOpen(true)}
                      >
                        <Text style={styles.radarCategoryChipText}>{item.label}</Text>
                      </TouchableOpacity>
                    );
                  }
                  const isActive = activeCategory === item.id;
                  return (
                    <TouchableOpacity
                      style={[styles.cleanChip, isActive && styles.cleanChipActive]}
                      onPress={() => setActiveCategory(item.id)}
                    >
                      <Text
                        style={[styles.cleanChipText, isActive && styles.cleanChipTextActive]}
                      >
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
              />
            </View>

            {/* Compact Sub-Header: Spot Count + Radius + Parked Pin + Walk/Ride Switch */}
            <View style={styles.subToolbar}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                <Text style={styles.spotCountText}>{filteredPlaces.length} spots</Text>
                <TouchableOpacity onPress={cycleRadius} style={styles.radiusPill}>
                  <Text style={styles.radiusPillText}>
                    {(radiusMeters / 1000).toFixed(1)} km ▾
                  </Text>
                </TouchableOpacity>
                {savedPinSpot ? (
                  <TouchableOpacity
                    onPress={() => startNavigation(savedPinSpot)}
                    onLongPress={() => {
                      setSavedPinSpot(null);
                      AsyncStorage.removeItem('cravenav_saved_pin').catch(() => {});
                    }}
                    style={styles.savedPinChip}
                  >
                    <Text style={styles.savedPinChipText}>📌 Return</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={handlePinCurrentSpot} style={styles.pinHereChip}>
                    <Text style={styles.pinHereChipText}>📌 Pin Spot</Text>
                  </TouchableOpacity>
                )}
              </View>

              <View style={styles.modeGroup}>
                <TouchableOpacity
                  style={[styles.modeBtn, travelMode === 'foot' && styles.modeBtnActive]}
                  onPress={() => {
                    setTravelMode('foot');
                    if (selectedPlace) startNavigation(selectedPlace, 'foot');
                  }}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      travelMode === 'foot' && styles.modeBtnTextActive
                    ]}
                  >
                    🚶 Walk
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeBtn, travelMode === 'driving' && styles.modeBtnActive]}
                  onPress={() => {
                    setTravelMode('driving');
                    if (selectedPlace) startNavigation(selectedPlace, 'driving');
                  }}
                >
                  <Text
                    style={[
                      styles.modeBtnText,
                      travelMode === 'driving' && styles.modeBtnTextActive
                    ]}
                  >
                    🛵 Ride
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Clean Modern Places List */}
            {loadingPlaces ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>
                  Scanning places in {activeArea.label}...
                </Text>
              </View>
            ) : (
              <FlatList
                data={filteredPlaces}
                keyExtractor={(item) => item.id}
                initialNumToRender={8}
                maxToRenderPerBatch={6}
                windowSize={5}
                removeClippedSubviews={Platform.OS === 'android'}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
                showsVerticalScrollIndicator={false}
                renderItem={({ item }) => {
                  const isSel = selectedPlace && selectedPlace.id === item.id;
                  const isFav = favorites.includes(item.id);
                  const diaryEntry = diary[item.id];
                  const estFare = estimateTranspoFare(item.distanceMeters, 'driving');
                  const estKcal = estimateWalkCalories(item.distanceMeters);
                  const typicalSpotCost =
                    item.category === 'hotel'
                      ? 1200
                      : item.category === 'cafe' || item.category === 'fast_food'
                      ? 160
                      : 250;
                  const estTripTotal = typicalSpotCost + estFare;
                  const budgetFit =
                    walletBalance <= 0
                      ? { dot: '💳', text: `Est. ~₱${estTripTotal} trip`, color: '#94a3b8' }
                      : walletBalance >= estTripTotal
                      ? { dot: '🟢', text: `Fits Budget (~₱${estTripTotal})`, color: '#34d399' }
                      : walletBalance > estFare
                      ? { dot: '🟡', text: `Tight Budget (₱${walletBalance.toLocaleString()} left)`, color: '#fbbf24' }
                      : { dot: '🔴', text: `Low Balance (₱${walletBalance.toLocaleString()} left)`, color: '#f87171' };
                  const etaText =
                    item.distanceMeters > 3500 || travelMode === 'driving'
                      ? `🛵 ${Math.max(1, Math.round(item.distanceMeters / 450))}m • ~₱${estFare}`
                      : `🚶 ${item.walkMinutes}m • 🔥${estKcal} cal`;

                  return (
                    <TouchableOpacity
                      style={[styles.placeCard, isSel && styles.placeCardSelected]}
                      activeOpacity={0.85}
                      onPress={() => startNavigation(item)}
                    >
                      <View style={styles.cardMainRow}>
                        <View
                          style={[
                            styles.cardEmojiBox,
                            item.category === 'hotel' && styles.cardEmojiHotel,
                            item.category === 'cafe' && styles.cardEmojiCafe
                          ]}
                        >
                          <Text style={{ fontSize: 22 }}>{item.emoji}</Text>
                        </View>

                        <View style={{ flex: 1, marginHorizontal: 12 }}>
                          <Text style={styles.placeName} numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text style={styles.placeMeta} numberOfLines={1}>
                            {item.typeLabel} • {crowdBadge.dot} {crowdBadge.label} •{' '}
                            <Text style={{ color: budgetFit.color, fontWeight: '700' }}>
                              {budgetFit.dot} {budgetFit.text}
                            </Text>
                          </Text>
                          {diaryEntry ? (
                            <Text style={styles.diaryBadge} numberOfLines={1}>
                              {'⭐'.repeat(diaryEntry.rating)}{' '}
                              {diaryEntry.note ? `"${diaryEntry.note}"` : 'Tried'}
                            </Text>
                          ) : (
                            <Text style={styles.placeAddressSub} numberOfLines={1}>
                              📍 {item.address} • Transpo ~₱{estFare}
                            </Text>
                          )}
                        </View>

                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.distValueText}>{item.distanceText}</Text>
                          <Text style={styles.etaSubText}>{etaText}</Text>
                        </View>
                      </View>

                      <View style={styles.cardFooterRow}>
                        <View style={styles.cardIconActions}>
                          <TouchableOpacity
                            style={styles.cardActionPill}
                            onPress={() => toggleFavorite(item.id)}
                          >
                            <Text style={{ fontSize: 12.5 }}>{isFav ? '❤️' : '🤍'}</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.cardActionPill}
                            onPress={() => openDiaryModal(item)}
                          >
                            <Text style={styles.cardActionPillText}>
                              {diaryEntry ? '📝 Note' : '⭐ Rate'}
                            </Text>
                          </TouchableOpacity>

                          {/* Connected to Map Budget Tracker! */}
                          <TouchableOpacity
                            style={styles.cardSpendPill}
                            onPress={() => openSpendForPlace(item)}
                          >
                            <Text style={styles.cardSpendPillText}>💸 Spend</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={styles.cardActionPill}
                            onPress={() => sharePlaceAndETA(item)}
                          >
                            <Text style={styles.cardActionPillText}>📤</Text>
                          </TouchableOpacity>
                        </View>

                        <View style={[styles.goBtn, isSel && styles.goBtnActive]}>
                          <Text style={styles.goBtnText}>
                            {isSel ? 'Focused ✓' : 'Focus & Go ➔'}
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
      )}

      {/* ===================================================================== */}
      {/* CENTRALIZED BUDGETING SYSTEM (WEALTHSYNC) CONNECTED TO MAP TRACKER    */}
      {/* ===================================================================== */}
      <BudgetSystemModal
        visible={budgetModalOpen}
        onClose={() => setBudgetModalOpen(false)}
        activeTab={budgetTab}
        setActiveTab={setBudgetTab}
        accounts={accounts}
        transactions={walletHistory}
        budgets={budgets}
        vaults={vaults}
        futureSalary={expectedIncome}
        onUpdateFutureSalary={(val) =>
          persistCBS(accounts, val, walletHistory, budgets, vaults)
        }
        onReceiveFutureSalary={handleClaimExpectedSalary}
        onUpdateWalletBalance={handleUpdateWalletBalance}
        onRecordMapTripExpense={handleRecordMapTripExpense}
        onRecordGeneralTransaction={handleRecordGeneralTransaction}
        onSaveBudgetCap={handleSaveBudgetCap}
        onDeleteBudgetCap={handleDeleteBudgetCap}
        onCreateVault={handleCreateVault}
        onVaultAction={handleVaultAction}
        onDeleteVault={handleDeleteVault}
        onDeleteTransaction={handleUndoTransaction}
        selectedMapPlace={expensePlace || selectedPlace}
        nearbyPlaces={filteredPlaces.length > 0 ? filteredPlaces : allPlaces}
        estimateTranspoFare={(dist) => estimateTranspoFare(dist, 'driving')}
        prefillPlaceName={expensePlaceName}
        setPrefillPlaceName={setExpensePlaceName}
        prefillFoodCost={expenseFoodInput}
        setPrefillFoodCost={setExpenseFoodInput}
        prefillTranspoCost={expenseTranspoInput}
        setPrefillTranspoCost={setExpenseTranspoInput}
      />

      {/* ===================================================================== */}
      {/* NEW FEATURE #14: 🧭 POINT-YOUR-PHONE LIVE COMPASS RADAR MODAL         */}
      {/* ===================================================================== */}
      <Modal visible={radarModalOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 380, maxHeight: '86%' }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>🧭 Point-Your-Phone Radar</Text>
              <TouchableOpacity onPress={() => setRadarModalOpen(false)}>
                <Text style={{ color: '#94a3b8', fontSize: 18, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubLeft}>
              Rotate your phone! Scanning spots directly in front of your heading ({heading}°):
            </Text>

            {/* Live Circular Radar Visualizer */}
            <View style={styles.radarCircle}>
              <View style={styles.radarRingInner} />
              <View style={styles.radarCone} />
              <View style={styles.radarCenterDot} />
              <Text style={styles.radarHeadingBadge}>⬆️ Facing {heading}°</Text>
              {radarPlaces.slice(0, 10).map((rp) => {
                const rad = ((rp.signedAngle - 90) * Math.PI) / 180;
                const distRatio = Math.min(1, Math.max(0.2, rp.distanceMeters / radiusMeters));
                const rPx = distRatio * 56;
                const bx = 70 + Math.cos(rad) * rPx - 10;
                const by = 70 + Math.sin(rad) * rPx - 10;
                return (
                  <View
                    key={rp.id}
                    style={[
                      styles.radarBlip,
                      { left: bx, top: by },
                      rp.sector === 'ahead' && styles.radarBlipAhead
                    ]}
                  >
                    <Text style={{ fontSize: 11 }}>{rp.emoji}</Text>
                  </View>
                );
              })}
            </View>

            <ScrollView style={{ width: '100%' }} showsVerticalScrollIndicator={false}>
              <Text style={styles.budgetSectionTitle}>
                🎯 Directly Ahead of Your Phone (±30°)
              </Text>
              {radarPlaces.filter((p) => p.sector === 'ahead').length === 0 ? (
                <Text style={styles.emptyHistoryText}>
                  No spots within ±30° of {heading}°. Slowly rotate your phone left or right!
                </Text>
              ) : (
                radarPlaces
                  .filter((p) => p.sector === 'ahead')
                  .slice(0, 6)
                  .map((p) => (
                    <TouchableOpacity
                      key={p.id}
                      style={styles.radarSpotRow}
                      onPress={() => {
                        setRadarModalOpen(false);
                        startNavigation(p);
                      }}
                    >
                      <Text style={{ fontSize: 22, marginRight: 10 }}>{p.emoji}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.txTitle} numberOfLines={1}>
                          {p.name}
                        </Text>
                        <Text style={styles.txSub}>
                          ⬆️ Straight Ahead ({p.absAngle}° off) • {p.distanceText} • ~₱
                          {estimateTranspoFare(p.distanceMeters, 'driving')} fare
                        </Text>
                      </View>
                      <Text style={{ color: '#34d399', fontWeight: '800', fontSize: 12 }}>
                        Focus ➔
                      </Text>
                    </TouchableOpacity>
                  ))
              )}

              <Text style={[styles.budgetSectionTitle, { marginTop: 10 }]}>
                ↔️ Slightly Left or Right
              </Text>
              {radarPlaces
                .filter((p) => p.sector === 'left' || p.sector === 'right')
                .slice(0, 6)
                .map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={styles.radarSpotRow}
                    onPress={() => {
                      setRadarModalOpen(false);
                      startNavigation(p);
                    }}
                  >
                    <Text style={{ fontSize: 20, marginRight: 10 }}>{p.emoji}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txTitle} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={styles.txSub}>
                        {p.sector === 'left' ? '↖️ Turn Left' : '↗️ Turn Right'} ({p.absAngle}°) •{' '}
                        {p.distanceText}
                      </Text>
                    </View>
                    <Text style={{ color: '#60a5fa', fontWeight: '800', fontSize: 12 }}>
                      Go ➔
                    </Text>
                  </TouchableOpacity>
                ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Clean Area / City / Municipality / Barangay Picker Modal */}
      <Modal visible={customAreaModalOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 370 }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>📍 Choose Area or Town</Text>
              <TouchableOpacity onPress={() => setCustomAreaModalOpen(false)}>
                <Text style={{ color: '#94a3b8', fontSize: 18, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubLeft}>
              Select a city/municipality below or type any barangay, town, or country:
            </Text>

            <View style={styles.customTownSearchRow}>
              <TextInput
                style={[styles.diaryInput, { flex: 1, marginBottom: 0 }]}
                placeholder="Type any town / city (e.g. Unisan, Tokyo)..."
                placeholderTextColor="#64748b"
                value={customAreaInput}
                onChangeText={setCustomAreaInput}
                onSubmitEditing={handleAddCustomArea}
              />
              <TouchableOpacity style={styles.customTownGoBtn} onPress={handleAddCustomArea}>
                <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>Go</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.areaGrid}>
              {areaList.map((item) => {
                const isAct = activeArea && activeArea.id === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.areaGridItem, isAct && styles.areaGridItemActive]}
                    onPress={() => {
                      handleSelectArea(item);
                      setCustomAreaModalOpen(false);
                    }}
                  >
                    <Text
                      style={[styles.areaGridText, isAct && styles.areaGridTextActive]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>

      {/* Quick Cravings & Hotel Filter Modal (Keeps main UI super clean!) */}
      <Modal visible={cravingModalOpen} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { maxWidth: 370 }]}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>⚡ Quick Cravings & Stays</Text>
              <TouchableOpacity onPress={() => setCravingModalOpen(false)}>
                <Text style={{ color: '#94a3b8', fontSize: 18, fontWeight: '700' }}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubLeft}>
              Tap what you're looking for to deep-search {activeArea.label}:
            </Text>

            <View style={styles.areaGrid}>
              {CRAVINGS.map((item) => {
                const isAct = activeCraving === item.id;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.areaGridItem, isAct && styles.areaGridItemActive]}
                    onPress={() => {
                      handleCravingPress(item);
                      setCravingModalOpen(false);
                    }}
                  >
                    <Text
                      style={[styles.areaGridText, isAct && styles.areaGridTextActive]}
                      numberOfLines={1}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {activeCraving && (
              <TouchableOpacity
                style={{ marginTop: 14 }}
                onPress={() => {
                  setActiveCraving(null);
                  setSearchQuery('');
                  setCravingModalOpen(false);
                }}
              >
                <Text style={{ color: '#f87171', fontSize: 13, fontWeight: '700' }}>
                  ✕ Clear Craving Filter
                </Text>
              </TouchableOpacity>
            )}
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
                placeholder="Write a note (e.g. Clean rooms / Best lomi in town)"
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
                {rouletteWinner.typeLabel} • {rouletteWinner.distanceText} away • ~₱
                {estimateTranspoFare(rouletteWinner.distanceMeters, 'driving')} ride
              </Text>
              <TouchableOpacity
                style={styles.modalPrimaryBtn}
                onPress={() => {
                  const target = rouletteWinner;
                  setRouletteWinner(null);
                  startNavigation(target);
                }}
              >
                <Text style={styles.modalPrimaryBtnText}>🚶 Focus & Show Path</Text>
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

      {/* Arrival Celebration Modal (Connected to Budget Tracker & Diary!) */}
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
                  openSpendForPlace(p);
                }}
              >
                <Text style={styles.modalPrimaryBtnText}>💸 Log Food & Transpo Spend</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalSecondaryBtn, { marginTop: 8 }]}
                onPress={() => {
                  const p = arrivalPlace;
                  setArrivalPlace(null);
                  openDiaryModal(p);
                }}
              >
                <Text style={styles.modalSecondaryBtnText}>⭐ Rate & Add Note</Text>
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
    backgroundColor: '#0b0f19',
    paddingTop: Platform.OS === 'android' ? RNStatusBar.currentHeight || 0 : 0
  },
  mapWrap: { flex: 1 },

  // Floating Top Header (Modern Glass Card Stack)
  topFloatingHeader: {
    position: 'absolute',
    top: Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) + 10 : 50,
    left: 14,
    right: 14,
    zIndex: 25,
    gap: 8
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  locationSelectorPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    maxWidth: '58%'
  },
  gpsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10b981',
    marginRight: 8
  },
  locationSelectorText: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700'
  },
  locationChevron: {
    color: '#94a3b8',
    fontSize: 12,
    marginLeft: 6
  },
  topRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  weatherPill: {
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)'
  },
  weatherPillText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700'
  },
  topIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.94)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  floatingSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  modernSearchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 46,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)'
  },
  modernSearchInput: {
    flex: 1,
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '500'
  },
  clearSearchBtn: {
    paddingHorizontal: 6,
    paddingVertical: 4
  },
  modernActionBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  modernActionBtnActive: {
    backgroundColor: '#3b82f6',
    borderColor: '#60a5fa'
  },
  modernRouletteBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.4)',
    alignItems: 'center',
    justifyContent: 'center'
  },

  // Navigation HUD
  navHud: {
    position: 'absolute',
    top: Platform.OS === 'android' ? (RNStatusBar.currentHeight || 24) + 10 : 50,
    left: 14,
    right: 14,
    backgroundColor: 'rgba(15, 23, 42, 0.96)',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.45)',
    padding: 14,
    zIndex: 30
  },
  turnBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  turnIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#10b981',
    alignItems: 'center',
    justifyContent: 'center'
  },
  turnIconText: { fontSize: 22 },
  turnInstruction: { color: '#fff', fontSize: 14.5, fontWeight: '800' },
  turnSub: { color: '#34d399', fontSize: 12, marginTop: 2, fontWeight: '600' },
  shareHudBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  closeHudBtn: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  compassBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.14)',
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginBottom: 10
  },
  compassArrow: { fontSize: 15, marginRight: 8 },
  compassText: { color: '#93c5fd', fontSize: 11.5 },
  statsGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 12,
    paddingVertical: 9,
    marginBottom: 10
  },
  statCell: { flex: 1, alignItems: 'center' },
  statDivider: { width: 1, height: 22, backgroundColor: 'rgba(255,255,255,0.08)' },
  statVal: { color: '#fff', fontSize: 14.5, fontWeight: '800' },
  statLbl: { color: '#64748b', fontSize: 9.5, fontWeight: '700', marginTop: 2 },
  progressTrack: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 99,
    overflow: 'hidden',
    marginBottom: 10
  },
  progressFill: { height: '100%', backgroundColor: '#10b981' },
  navControlsRow: { flexDirection: 'row', gap: 6 },
  navBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center'
  },
  navBtnActive: { backgroundColor: 'rgba(59, 130, 246, 0.32)' },
  navBtnText: { color: '#f1f5f9', fontSize: 11, fontWeight: '700' },
  stepsDrawer: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    gap: 4
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8
  },
  stepRowActive: { backgroundColor: 'rgba(16,185,129,0.18)' },
  stepText: { color: '#cbd5e1', fontSize: 11.5, flex: 1 },
  stepDist: { color: '#94a3b8', fontSize: 11, marginLeft: 8 },

  // Clean Modern Bottom Sheet
  bottomSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '46%',
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    zIndex: 25
  },
  bottomSheetMinimized: { height: 74 },
  sheetHandleWrap: { alignItems: 'center', paddingVertical: 8 },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.22)'
  },
  minimizedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18
  },
  minimizedTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '800' },
  minimizedSub: { color: '#64748b', fontSize: 11.5, marginTop: 2 },
  minimizedStopBtn: {
    backgroundColor: 'rgba(239, 68, 68, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.4)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10
  },
  minimizedStopText: { color: '#fca5a5', fontSize: 11.5, fontWeight: '700' },
  minimizedExpandBtn: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10
  },
  minimizedExpandText: { color: '#e2e8f0', fontSize: 11.5, fontWeight: '700' },

  categoryBarWrap: { height: 40, marginBottom: 4 },
  cleanChipsList: { paddingHorizontal: 16, alignItems: 'center', gap: 8 },
  cleanChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'
  },
  cleanChipActive: {
    backgroundColor: '#f8fafc',
    borderColor: '#ffffff'
  },
  cleanChipText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  cleanChipTextActive: { color: '#0f172a', fontWeight: '800' },

  subToolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginBottom: 4
  },
  spotCountText: { color: '#94a3b8', fontSize: 12, fontWeight: '700' },
  radiusPill: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)'
  },
  radiusPillText: { color: '#e2e8f0', fontSize: 11.5, fontWeight: '700' },
  refreshMiniBtn: {
    padding: 4,
    borderRadius: 999
  },
  modeGroup: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 999,
    padding: 2
  },
  modeBtn: { paddingHorizontal: 11, paddingVertical: 5, borderRadius: 999 },
  modeBtnActive: { backgroundColor: '#10b981' },
  modeBtnText: { color: '#94a3b8', fontSize: 11.5, fontWeight: '700' },
  modeBtnTextActive: { color: '#ffffff' },

  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: '#64748b', fontSize: 13, fontWeight: '600', textAlign: 'center' },

  // Modern Place Cards
  placeCard: {
    backgroundColor: '#162033',
    borderRadius: 18,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'
  },
  placeCardSelected: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.12)'
  },
  cardMainRow: { flexDirection: 'row', alignItems: 'center' },
  cardEmojiBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 87, 34, 0.14)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  cardEmojiHotel: { backgroundColor: 'rgba(56, 189, 248, 0.14)' },
  cardEmojiCafe: { backgroundColor: 'rgba(168, 85, 247, 0.14)' },
  placeName: { color: '#f8fafc', fontSize: 15, fontWeight: '800' },
  placeMeta: { color: '#94a3b8', fontSize: 12, marginTop: 2 },
  diaryBadge: { color: '#fbbf24', fontSize: 11.5, fontWeight: '600', marginTop: 3 },
  distValueText: { color: '#f8fafc', fontSize: 13.5, fontWeight: '800' },
  etaSubText: { color: '#64748b', fontSize: 11.5, fontWeight: '600', marginTop: 2 },

  cardFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)'
  },
  cardIconActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardActionPill: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8
  },
  cardActionPillText: { color: '#cbd5e1', fontSize: 11.5, fontWeight: '600' },
  goBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10
  },
  goBtnActive: { backgroundColor: '#059669' },
  goBtnText: { color: '#ffffff', fontSize: 12, fontWeight: '800' },

  // Modals
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.78)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#0f172a',
    borderRadius: 24,
    padding: 22,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)'
  },
  modalHeaderRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6
  },
  modalTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '800' },
  modalSub: {
    color: '#94a3b8',
    fontSize: 12.5,
    textAlign: 'center',
    marginTop: 6,
    marginBottom: 14
  },
  modalSubLeft: {
    width: '100%',
    color: '#94a3b8',
    fontSize: 12.5,
    marginBottom: 12
  },
  customTownSearchRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 14
  },
  customTownGoBtn: {
    backgroundColor: '#10b981',
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  areaGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  areaGridItem: {
    width: '48%',
    backgroundColor: '#162033',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'
  },
  areaGridItemActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderColor: '#10b981'
  },
  areaGridText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700'
  },
  areaGridTextActive: {
    color: '#34d399',
    fontWeight: '800'
  },
  diaryInput: {
    width: '100%',
    backgroundColor: '#162033',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#fff',
    fontSize: 13,
    marginBottom: 14
  },
  modalPrimaryBtn: {
    width: '100%',
    backgroundColor: '#10b981',
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: 'center'
  },
  modalPrimaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  modalSecondaryBtn: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingVertical: 11,
    borderRadius: 14,
    alignItems: 'center'
  },
  modalSecondaryBtnText: { color: '#e2e8f0', fontSize: 13, fontWeight: '700' },

  // Wallet & Radar Top Bar & Category Pills
  walletTopPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
    borderWidth: 1,
    borderColor: '#10b981',
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 999
  },
  walletTopPillLow: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    borderColor: '#f87171'
  },
  walletTopPillText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '800'
  },
  modernRadarBtn: {
    width: 46,
    height: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.45)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  spendHudBtn: {
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 11,
    backgroundColor: 'rgba(16, 185, 129, 0.18)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  walletCategoryChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderWidth: 1,
    borderColor: '#10b981'
  },
  walletCategoryChipText: {
    color: '#34d399',
    fontSize: 12,
    fontWeight: '800'
  },
  radarCategoryChip: {
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(56, 189, 248, 0.16)',
    borderWidth: 1,
    borderColor: '#38bdf8'
  },
  radarCategoryChipText: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '800'
  },
  pinHereChip: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)'
  },
  pinHereChipText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '700'
  },
  savedPinChip: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    borderWidth: 1,
    borderColor: '#f59e0b'
  },
  savedPinChipText: {
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: '800'
  },
  placeAddressSub: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2
  },
  cardSpendPill: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8
  },
  cardSpendPillText: {
    color: '#34d399',
    fontSize: 11.5,
    fontWeight: '800'
  },

  // Budget Tracker Modal Styles
  walletHeroCard: {
    width: '100%',
    backgroundColor: '#132a28',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.4)',
    marginTop: 6,
    marginBottom: 12
  },
  walletHeroLabel: {
    color: '#6ee7b7',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6
  },
  walletHeroBalance: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    marginTop: 2
  },
  futureEarnBox: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    alignItems: 'flex-end'
  },
  futureEarnLabel: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '800'
  },
  futureEarnVal: {
    color: '#38bdf8',
    fontSize: 14,
    fontWeight: '800',
    marginTop: 1
  },
  walletStatsStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)'
  },
  walletStatItem: {
    color: '#cbd5e1',
    fontSize: 11.5,
    fontWeight: '700'
  },
  claimSalaryBtn: {
    marginTop: 10,
    backgroundColor: '#10b981',
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center'
  },
  claimSalaryBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800'
  },
  budgetTabRow: {
    width: '100%',
    flexDirection: 'row',
    backgroundColor: '#162033',
    borderRadius: 12,
    padding: 3,
    marginBottom: 12
  },
  budgetTabBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 9,
    alignItems: 'center'
  },
  budgetTabBtnActive: {
    backgroundColor: '#0f172a'
  },
  budgetTabBtnText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700'
  },
  budgetTabBtnTextActive: {
    color: '#ffffff',
    fontWeight: '800'
  },
  budgetOverviewBox: {
    width: '100%'
  },
  budgetSectionTitle: {
    color: '#94a3b8',
    fontSize: 11.5,
    fontWeight: '800',
    marginBottom: 8,
    textTransform: 'uppercase'
  },
  budgetActionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#162033',
    padding: 12,
    borderRadius: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'
  },
  budgetActionTitle: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '800'
  },
  budgetActionSub: {
    color: '#94a3b8',
    fontSize: 11.5,
    marginTop: 2
  },
  inputLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6
  },
  quickPlacePickChip: {
    backgroundColor: '#162033',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    marginRight: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'
  },
  quickPlacePickText: {
    color: '#e2e8f0',
    fontSize: 11.5,
    fontWeight: '700'
  },
  quickAmountRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12
  },
  quickAmtChip: {
    backgroundColor: '#162033',
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)'
  },
  quickAmtText: {
    color: '#34d399',
    fontSize: 11.5,
    fontWeight: '800'
  },
  mathPreviewBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center'
  },
  mathPreviewLine: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: '600'
  },
  mathPreviewResult: {
    color: '#34d399',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 3
  },
  dividerLine: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 14
  },
  emptyHistoryText: {
    color: '#64748b',
    fontSize: 12.5,
    textAlign: 'center',
    paddingVertical: 18
  },
  txRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#162033',
    padding: 12,
    borderRadius: 12,
    marginBottom: 8
  },
  txTitle: {
    color: '#f8fafc',
    fontSize: 13.5,
    fontWeight: '800'
  },
  txSub: {
    color: '#94a3b8',
    fontSize: 11.5,
    marginTop: 2
  },
  txDate: {
    color: '#64748b',
    fontSize: 10.5,
    marginTop: 2
  },
  txAmount: {
    fontSize: 14,
    fontWeight: '900'
  },

  // Feature #14: Point-Your-Phone Radar Styles
  radarCircle: {
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#0b1324',
    borderWidth: 2,
    borderColor: 'rgba(56, 189, 248, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
    position: 'relative',
    overflow: 'hidden'
  },
  radarRingInner: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.2)',
    position: 'absolute'
  },
  radarCone: {
    position: 'absolute',
    top: 0,
    width: 68,
    height: 70,
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40
  },
  radarCenterDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#3b82f6',
    borderWidth: 2,
    borderColor: '#fff'
  },
  radarHeadingBadge: {
    position: 'absolute',
    bottom: 6,
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '800'
  },
  radarBlip: {
    position: 'absolute',
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  radarBlipAhead: {
    backgroundColor: 'rgba(16, 185, 129, 0.45)',
    borderWidth: 1,
    borderColor: '#34d399'
  },
  radarSpotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#162033',
    padding: 11,
    borderRadius: 12,
    marginBottom: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)'
  },
  focusOnlyTopBar: {
    position: 'absolute',
    top: Platform.OS === 'android' ? (RNStatusBar.currentHeight || 28) + 12 : 52,
    left: 14,
    right: 14,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  focusLeftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  focusBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(11, 15, 25, 0.92)',
    paddingVertical: 9,
    paddingLeft: 14,
    paddingRight: 10,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.18)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 8,
    elevation: 8,
    gap: 8
  },
  focusFitBtn: {
    backgroundColor: 'rgba(11, 15, 25, 0.92)',
    paddingVertical: 9,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: 'rgba(56, 189, 248, 0.4)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 7
  },
  focusFitBtnText: {
    color: '#38bdf8',
    fontSize: 12.5,
    fontWeight: '800'
  },
  focusSpendBtn: {
    backgroundColor: 'rgba(6, 78, 59, 0.94)',
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: '#10b981',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 7
  },
  focusSpendBtnText: {
    color: '#34d399',
    fontSize: 12.5,
    fontWeight: '800'
  },
  focusBackArrow: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900'
  },
  focusBackText: {
    color: '#ffffff',
    fontSize: 13.5,
    fontWeight: '800',
    letterSpacing: 0.3
  },
  focusBackCloseCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(239, 68, 68, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2
  },
  focusBackCloseX: {
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: '900'
  }
});
