// ============================================================================
// app.js — Main Controller, UI State, Favorites & Random Restaurant Roulette
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  let allPlaces = [];
  let filteredPlaces = [];
  let selectedPlace = null;
  let activeCategory = 'all';
  let currentRadius = 1500;
  let favoriteIds = new Set(JSON.parse(localStorage.getItem('cravenav_favs') || '[]'));

  // DOM References
  const placesListEl = document.getElementById('placesList');
  const resultsCountEl = document.getElementById('resultsCount');
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const radiusSelect = document.getElementById('radiusSelect');
  const navHud = document.getElementById('navHud');
  const turnIconBox = document.getElementById('turnIconBox');
  const turnInstruction = document.getElementById('turnInstruction');
  const turnSub = document.getElementById('turnSub');
  const statDistVal = document.getElementById('statDistVal');
  const statEtaVal = document.getElementById('statEtaVal');
  const statPctVal = document.getElementById('statPctVal');
  const progressFill = document.getElementById('progressFill');
  const progressDestName = document.getElementById('progressDestName');
  const stepsDrawer = document.getElementById('stepsDrawer');

  // 1. Initialize Map & GPS
  window.MapEngine.init();
  window.GPSTracker.startTracking();

  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  // 2. Listen for Live GPS Updates
  window.GPSTracker.onPositionUpdate(async (pos, isInitial) => {
    window.MapEngine.updateUserPosition(pos.lat, pos.lng, pos.accuracy, currentRadius);

    if (isInitial) {
      await loadNearbyRestaurants(pos.lat, pos.lng);
    } else {
      // Recalculate live distances for list
      allPlaces = window.PlacesService.recalculateDistances(allPlaces, pos.lat, pos.lng);
      applyFilter();
    }

    // If actively navigating to a restaurant, update live walk progress!
    if (selectedPlace && window.RouteEngine.getActiveRoute()) {
      const live = window.RouteEngine.updateLiveProgress(pos.lat, pos.lng);
      if (live) {
        renderLiveNavHUD(live);
        window.MapEngine.updateWalkedPath(live.remainingCoords, live.walkedCoords);
        if (live.justArrived) {
          showArrivalModal(live.destination);
        }
      }
    }
  });

  // 3. Load Nearby Restaurants from Overpass
  async function loadNearbyRestaurants(lat, lng) {
    placesListEl.innerHTML = `<div style="padding:28px;text-align:center;color:#94a3b8;font-size:13px;">
      🔍 Scanning restaurants within ${(currentRadius / 1000).toFixed(1)} km...
    </div>`;

    allPlaces = await window.PlacesService.fetchNearbyRestaurants(lat, lng, currentRadius);
    applyFilter();
  }

  // 4. Filter & Render Places List + Map Pins
  function applyFilter() {
    const q = (searchInput.value || '').trim().toLowerCase();

    filteredPlaces = allPlaces.filter((p) => {
      if (activeCategory === 'favorites' && !favoriteIds.has(p.id)) return false;
      if (activeCategory !== 'all' && activeCategory !== 'favorites' && p.category !== activeCategory) {
        return false;
      }
      if (q && !p.name.toLowerCase().includes(q) && !p.typeLabel.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    resultsCountEl.textContent = `${filteredPlaces.length} spots found`;
    renderPlacesList();
    window.MapEngine.renderPOIMarkers(
      filteredPlaces,
      selectedPlace ? selectedPlace.id : null,
      (place) => startNavigationToPlace(place)
    );
  }

  function renderPlacesList() {
    if (filteredPlaces.length === 0) {
      placesListEl.innerHTML = `<div style="padding:28px 16px;text-align:center;color:#94a3b8;font-size:13px;">
        🍽️ No spots matched this filter.<br><br>
        <small>Tip: Press <b>Enter</b> in the search box to search any place globally, or increase the scan radius!</small>
      </div>`;
      return;
    }

    placesListEl.innerHTML = filteredPlaces
      .map((p) => {
        const isSel = selectedPlace && selectedPlace.id === p.id;
        const isFav = favoriteIds.has(p.id);
        return `
        <div class="place-card ${isSel ? 'selected' : ''}" data-id="${p.id}">
          <div class="place-card-top">
            <div class="place-info">
              <div class="place-emoji">${p.emoji}</div>
              <div>
                <div class="place-name">${escapeHtml(p.name)}</div>
                <div class="place-meta">${escapeHtml(p.typeLabel)} • ${escapeHtml(p.address)}</div>
              </div>
            </div>
            <div class="distance-pill">${p.distanceText}</div>
          </div>
          <div class="place-card-actions">
            <div class="eta-label">
              <span>🚶 ~${p.walkMinutes} min walk</span>
              <button class="fav-toggle-btn" data-fav="${p.id}" title="Save Favorite" style="background:none;border:none;cursor:pointer;font-size:14px;">
                ${isFav ? '❤️' : '🤍'}
              </button>
            </div>
            <button class="go-btn" data-go="${p.id}">
              ${isSel ? '🧭 Navigating' : '🚶 Show Path'}
            </button>
          </div>
        </div>
      `;
      })
      .join('');

    // Attach click listeners
    placesListEl.querySelectorAll('.place-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.fav-toggle-btn')) return;
        const id = card.getAttribute('data-id');
        const place = filteredPlaces.find((item) => item.id === id);
        if (place) startNavigationToPlace(place);
      });
    });

    placesListEl.querySelectorAll('.fav-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-fav');
        if (favoriteIds.has(id)) favoriteIds.delete(id);
        else favoriteIds.add(id);
        localStorage.setItem('cravenav_favs', JSON.stringify([...favoriteIds]));
        applyFilter();
      });
    });
  }

  // 5. Start Real-Time Street Navigation to Selected Restaurant
  async function startNavigationToPlace(place) {
    window.GPSTracker.stopSimulation();
    selectedPlace = place;
    applyFilter();

    const userPos = window.GPSTracker.getPosition();
    navHud.classList.add('active');
    turnInstruction.textContent = `Calculating path to ${place.name}...`;
    turnSub.textContent = place.address;

    const route = await window.RouteEngine.calculateRoute(userPos.lat, userPos.lng, place);
    window.MapEngine.drawRoute(route.coords, true);

    const live = window.RouteEngine.updateLiveProgress(userPos.lat, userPos.lng);
    if (live) renderLiveNavHUD(live);

    // Minimize drawer on mobile so user can see the full street route
    if (window.innerWidth <= 860) {
      document.getElementById('sidebarPanel').classList.add('minimized');
    }
  }

  function renderLiveNavHUD(live) {
    turnIconBox.textContent = live.currentStep ? live.currentStep.icon : '⬆️';
    turnInstruction.textContent = live.currentStep
      ? live.currentStep.instruction
      : `Head toward ${live.destination.name}`;
    turnSub.textContent = `Destination: ${live.destination.name}`;

    statDistVal.textContent = live.remainingText;
    statEtaVal.textContent = `${live.remainingMins} min`;
    statPctVal.textContent = `${live.progressPercent}%`;

    progressFill.style.width = `${live.progressPercent}%`;
    progressDestName.textContent = live.destination.name;

    // Render turn-by-turn steps list
    stepsDrawer.innerHTML = (live.steps || [])
      .map(
        (s, idx) => `
        <div class="step-row ${idx === live.activeStepIdx ? 'current-step' : ''}">
          <span>${s.icon} ${escapeHtml(s.instruction)}</span>
          <span style="color:#94a3b8;margin-left:8px;">${s.distanceText}</span>
        </div>
      `
      )
      .join('');
  }

  // 6. Search Input & Global Search on Enter
  let searchDebounce = null;
  searchInput.addEventListener('input', () => {
    clearSearchBtn.style.display = searchInput.value ? 'block' : 'none';
    applyFilter();

    clearTimeout(searchDebounce);
    if (searchInput.value.trim().length >= 3) {
      searchDebounce = setTimeout(async () => {
        const pos = window.GPSTracker.getPosition();
        const remoteResults = await window.PlacesService.searchPlacesByQuery(
          searchInput.value.trim(),
          pos.lat,
          pos.lng
        );
        if (remoteResults.length > 0) {
          // Merge remote search hits with local places
          const existingIds = new Set(allPlaces.map((p) => p.id));
          remoteResults.forEach((r) => {
            if (!existingIds.has(r.id)) allPlaces.push(r);
          });
          allPlaces = window.PlacesService.recalculateDistances(allPlaces, pos.lat, pos.lng);
          applyFilter();
        }
      }, 450);
    }
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    applyFilter();
  });

  // 7. Category Filter Chips
  document.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      activeCategory = chip.getAttribute('data-cat');
      applyFilter();
    });
  });

  // 8. Radius Selector
  radiusSelect.addEventListener('change', async () => {
    currentRadius = parseInt(radiusSelect.value, 10);
    window.MapEngine.setRadiusMeters(currentRadius);
    const pos = window.GPSTracker.getPosition();
    await loadNearbyRestaurants(pos.lat, pos.lng);
  });

  // 9. Travel Mode Switcher (Walk vs Ride)
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.getAttribute('data-mode');
      window.RouteEngine.setTravelMode(mode);
      if (selectedPlace) {
        await startNavigationToPlace(selectedPlace);
      }
    });
  });

  // 10. Navigation HUD Action Buttons
  document.getElementById('simWalkBtn').addEventListener('click', (e) => {
    const activeRoute = window.RouteEngine.getActiveRoute();
    if (!activeRoute) return;
    const started = window.GPSTracker.toggleSimulation(activeRoute.coords);
    const btn = e.currentTarget;
    if (started) {
      btn.classList.add('sim-active');
      btn.innerHTML = '⏸️ Pause Walk Sim';
    } else {
      btn.classList.remove('sim-active');
      btn.innerHTML = '🚶 Simulate Walk';
    }
  });

  document.getElementById('toggleStepsBtn').addEventListener('click', () => {
    stepsDrawer.classList.toggle('open');
  });

  document.getElementById('voiceToggleBtn').addEventListener('click', (e) => {
    const active = window.RouteEngine.toggleVoice();
    e.currentTarget.innerHTML = active ? '🔊 Voice: ON' : '🔇 Voice: OFF';
  });

  document.getElementById('stopNavBtn').addEventListener('click', () => {
    window.GPSTracker.stopSimulation();
    window.RouteEngine.stopNavigation();
    window.MapEngine.clearRoute();
    selectedPlace = null;
    navHud.classList.remove('active');
    applyFilter();
  });

  // 11. Map Floating Action Buttons
  document.getElementById('recenterBtn').addEventListener('click', () => {
    const pos = window.GPSTracker.getPosition();
    window.MapEngine.recenterOnUser(pos.lat, pos.lng);
  });

  document.getElementById('layerBtn').addEventListener('click', () => {
    window.MapEngine.cycleTileStyle();
  });

  document.getElementById('rescanBtn').addEventListener('click', async () => {
    const pos = window.GPSTracker.getPosition();
    await loadNearbyRestaurants(pos.lat, pos.lng);
  });

  // 12. "Can't Decide?" Random Restaurant Roulette
  document.getElementById('rouletteBtn').addEventListener('click', () => {
    const pool = filteredPlaces.length > 0 ? filteredPlaces : allPlaces;
    if (pool.length === 0) return;

    const winner = pool[Math.floor(Math.random() * pool.length)];
    const modal = document.getElementById('rouletteModal');
    document.getElementById('rouletteEmoji').textContent = winner.emoji;
    document.getElementById('rouletteName').textContent = winner.name;
    document.getElementById('rouletteDesc').textContent = `${winner.typeLabel} • Only ${winner.distanceText} away (~${winner.walkMinutes} min walk)`;
    modal.classList.add('open');

    document.getElementById('rouletteGoBtn').onclick = () => {
      modal.classList.remove('open');
      startNavigationToPlace(winner);
    };
  });

  document.getElementById('closeRouletteBtn').addEventListener('click', () => {
    document.getElementById('rouletteModal').classList.remove('open');
  });

  // 13. Arrival Modal
  function showArrivalModal(place) {
    const modal = document.getElementById('arrivalModal');
    document.getElementById('arrivalPlaceName').textContent = place.name;
    modal.classList.add('open');
  }

  document.getElementById('closeArrivalBtn').addEventListener('click', () => {
    document.getElementById('arrivalModal').classList.remove('open');
  });

  // Mobile bottom sheet toggle
  document.getElementById('mobileSheetToggle').addEventListener('click', () => {
    document.getElementById('sidebarPanel').classList.toggle('minimized');
  });

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
});
