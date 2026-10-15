// =========================================================================
// 🧭 МОДУЛЬ GPS-НАВІГАЦІЇ ТА ШТУРМАНА (GPS ENGINE v2.0 - SINGLE MODE)
// =========================================================================

(function() {
  let isGpsActive = false;
  let watchId = null;
  let userMarker = null;
  let currentLat = null;
  let currentLng = null;
  let currentSpeedKmH = 0;
  let isUserPanning = false;

  // Стиль мерцающего жёлтого кружка
  const yellowDotSvg = `
    <div class="nav-yellow-dot-wrapper">
      <div class="nav-yellow-dot-pulse"></div>
      <div class="nav-yellow-dot-core"></div>
    </div>
  `;

  // Подключение стилей для мерцающего маячка и кнопки возврата
  const styleEl = document.createElement("style");
  styleEl.innerHTML = `
    .nav-yellow-dot-wrapper {
      position: relative;
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .nav-yellow-dot-core {
      width: 14px;
      height: 14px;
      background: #eab308;
      border: 2.5px solid #ffffff;
      border-radius: 50%;
      box-shadow: 0 0 10px #facc15, 0 0 16px rgba(234, 179, 8, 0.85);
      z-index: 2;
    }
    .nav-yellow-dot-pulse {
      position: absolute;
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: rgba(234, 179, 8, 0.4);
      border: 1.5px solid #facc15;
      box-shadow: 0 0 14px rgba(250, 204, 21, 0.8);
      animation: yellowGpsPulse 1.6s infinite ease-out;
      pointer-events: none;
      z-index: 1;
    }
    @keyframes yellowGpsPulse {
      0% { transform: scale(0.4); opacity: 1; }
      60% { opacity: 0.45; }
      100% { transform: scale(2.6); opacity: 0; }
    }

    /* Кнопка повернення до своєї геопозиції під час ручного зміщення карти */
    .btn-recenter-car {
      position: fixed;
      right: 15px;
      bottom: 120px;
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.94);
      border: 1.5px solid #eab308;
      color: #facc15;
      display: none;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      cursor: pointer;
      z-index: 2100;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      animation: pulse-gps-recenter 1.6s infinite;
      backdrop-filter: blur(8px);
    }
    @keyframes pulse-gps-recenter {
      0%, 100% { transform: scale(1); }
      50% { transform: scale(1.08); }
    }

    /* Спідометр */
    .gps-speed-hud {
      position: fixed;
      left: 15px;
      bottom: 70px;
      background: rgba(15, 23, 42, 0.92);
      border: 1.5px solid #334155;
      padding: 4px 9px;
      border-radius: 10px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      font-size: 11px;
      font-weight: 800;
      color: #facc15;
      display: none;
      z-index: 1000;
      backdrop-filter: blur(8px);
      box-shadow: 0 4px 14px rgba(0,0,0,0.4);
    }
  `;
  document.head.appendChild(styleEl);

  const btnRecenter = document.createElement("div");
  btnRecenter.id = "btnRecenterCar";
  btnRecenter.className = "btn-recenter-car";
  btnRecenter.innerHTML = `🎯`;
  btnRecenter.onclick = () => recenterUserLocation();
  document.body.appendChild(btnRecenter);

  const speedHud = document.createElement("div");
  speedHud.id = "gpsSpeedHud";
  speedHud.className = "gps-speed-hud";
  speedHud.innerText = `0 км/год`;
  document.body.appendChild(speedHud);

  function setupMapPanningListener() {
    if (!window.map) {
      setTimeout(setupMapPanningListener, 200);
      return;
    }
    window.map.on('dragstart', () => {
      if (isGpsActive) {
        isUserPanning = true;
        btnRecenter.style.display = "flex";
      }
    });
  }
  setupMapPanningListener();

  function toggleGpsMode() {
    isGpsActive = !isGpsActive;
    updateGpsButtonUI();

    if (!isGpsActive) {
      stopGps();
      if (window.map) {
        const initCenter = (typeof INITIAL_CENTER !== 'undefined') ? INITIAL_CENTER : [48.484, 34.985];
        const initZoom = (typeof INITIAL_ZOOM !== 'undefined') ? INITIAL_ZOOM : (window.innerWidth < 768 ? 12 : 13);
        window.map.flyTo(initCenter, initZoom, { animate: true, duration: 0.8 });
      }
      if (typeof showToast === "function") showToast("⚪ Навігацію вимкнено (старт)");
    } else {
      isUserPanning = false;
      btnRecenter.style.display = "none";
      startGps();
      if (typeof showToast === "function") showToast("🧭 Навігація: Автоштурман");
    }
  }
  window.toggleGpsMode = toggleGpsMode;

  function updateGpsButtonUI() {
    const btnGps = document.getElementById("btnGpsHud");
    if (!btnGps) return;

    if (isGpsActive) {
      btnGps.classList.add("active");
      speedHud.style.display = "block";
    } else {
      btnGps.classList.remove("active");
      speedHud.style.display = "none";
      btnRecenter.style.display = "none";
    }
  }

  function startGps() {
    if (!navigator.geolocation) {
      alert("GPS не підтримується вашим браузером.");
      isGpsActive = false;
      updateGpsButtonUI();
      return;
    }

    watchId = navigator.geolocation.watchPosition(
      onGpsSuccess,
      onGpsError,
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 }
    );
  }

  function stopGps() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (userMarker && window.map) {
      window.map.removeLayer(userMarker);
      userMarker = null;
    }
    isUserPanning = false;
  }

  function onGpsSuccess(pos) {
    const coords = pos.coords;
    currentLat = coords.latitude;
    currentLng = coords.longitude;

    if (coords.speed !== null && !isNaN(coords.speed)) {
      currentSpeedKmH = Math.round(coords.speed * 3.6);
      speedHud.innerText = `${currentSpeedKmH} км/год`;
    }

    updateUserMarker(currentLat, currentLng);

    // Центрирование без изменения зума
    if (isGpsActive && !isUserPanning && window.map) {
      window.map.panTo([currentLat, currentLng], { animate: true, duration: 0.5 });
    }
  }

  function onGpsError(err) {
    console.warn("Помилка GPS:", err.message);
  }

  function updateUserMarker(lat, lng) {
    if (!window.map) return;

    if (!userMarker) {
      const yellowDotIcon = L.divIcon({
        className: 'nav-yellow-dot-leaflet',
        html: yellowDotSvg,
        iconSize: [24, 24],
        iconAnchor: [12, 12]
      });
      userMarker = L.marker([lat, lng], { icon: yellowDotIcon, zIndexOffset: 2000 }).addTo(window.map);
    } else {
      userMarker.setLatLng([lat, lng]);
    }
  }

  function recenterUserLocation() {
    if (currentLat === null || currentLng === null || !window.map) return;
    isUserPanning = false;
    btnRecenter.style.display = "none";
    // Сохраняем текущий зум карты
    window.map.panTo([currentLat, currentLng], { animate: true, duration: 0.5 });
  }
  window.recenterUserLocation = recenterUserLocation;

})();
