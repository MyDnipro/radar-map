// =========================================================================
// 🚗 МОДУЛЬ GPS-НАВІГАЦІЇ ТА ШТУРМАНА (GPS ENGINE v1.2)
// =========================================================================

(function() {
  // Режими: 0 - OFF, 1 - FREE (Огляд), 2 - FOLLOW (Слідування), 3 - ROTATE (По курсу)
  let gpsMode = 0; 
  let watchId = null;
  let carMarker = null;
  let currentLat = null;
  let currentLng = null;
  let currentHeading = 0;
  let currentSpeedKmH = 0;
  let isUserPanning = false;

  // Стиль іконки машинки (вид зверху з фарами та пульсуючим маячком)
  const carIconSvg = `
    <div class="nav-car-wrapper" id="navCarWrapper">
      <div class="nav-car-pulse"></div>
      <div class="nav-car-beam"></div>
      <svg class="nav-car-svg" viewBox="0 0 40 70" width="28" height="49">
        <!-- Тінь -->
        <rect x="7" y="5" width="26" height="60" rx="9" fill="rgba(0,0,0,0.35)"/>
        <!-- Корпус машинки -->
        <rect x="8" y="6" width="24" height="58" rx="8" fill="#0284c7" stroke="#38bdf8" stroke-width="2"/>
        <!-- Лобове скло -->
        <path d="M12 24 L28 24 L26 16 L14 16 Z" fill="#0f172a" stroke="#38bdf8" stroke-width="1"/>
        <!-- Дах -->
        <rect x="13" y="24" width="14" height="20" rx="3" fill="#0369a1"/>
        <!-- Заднє скло -->
        <path d="M13 45 L27 45 L25 51 L15 51 Z" fill="#0f172a"/>
        <!-- Передні фари -->
        <circle cx="11" cy="9" r="2.5" fill="#fef08a"/>
        <circle cx="29" cy="9" r="2.5" fill="#fef08a"/>
        <!-- Задні ліхтарі -->
        <circle cx="11" cy="61" r="2" fill="#ef4444"/>
        <circle cx="29" cy="61" r="2" fill="#ef4444"/>
      </svg>
    </div>
  `;

  // Створюємо CSS-стилі
  const styleEl = document.createElement("style");
  styleEl.innerHTML = `
    .nav-car-wrapper {
      position: relative;
      width: 40px;
      height: 70px;
      display: flex;
      align-items: center;
      justify-content: center;
      transform-origin: 50% 50%;
      transition: transform 0.2s linear;
    }
    .nav-car-beam {
      position: absolute;
      top: -24px;
      left: 6px;
      width: 28px;
      height: 35px;
      background: radial-gradient(ellipse at bottom, rgba(254, 240, 138, 0.45) 0%, rgba(254, 240, 138, 0) 75%);
      pointer-events: none;
    }
    /* Пульсуючий радарний маячок навколо авто в режимі 1 (Огляд) */
    .nav-car-pulse {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 54px;
      height: 54px;
      margin-top: -27px;
      margin-left: -27px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(0, 243, 255, 0.4) 10%, rgba(0, 243, 255, 0.05) 70%);
      border: 2px solid #00f3ff;
      box-shadow: 0 0 14px rgba(0, 243, 255, 0.8);
      pointer-events: none;
      opacity: 0;
      z-index: -1;
    }
    .nav-car-wrapper.is-mode-1 .nav-car-pulse {
      animation: carBeaconPing 1.7s infinite ease-out;
    }
    @keyframes carBeaconPing {
      0% {
        transform: scale(0.5);
        opacity: 0.95;
      }
      65% {
        opacity: 0.45;
      }
      100% {
        transform: scale(4.0);
        opacity: 0;
      }
    }

    /* Кнопка GPS (ліворуч від секундоміра) */
    .btn-gps-hud {
      position: fixed;
      right: 68px;
      bottom: 74px;
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: rgba(15, 23, 42, 0.9);
      border: 1.5px solid #00f3ff;
      color: #fff;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      cursor: pointer;
      z-index: 1000;
      box-shadow: 0 4px 14px rgba(0, 243, 255, 0.25);
      backdrop-filter: blur(8px);
      user-select: none;
      transition: transform 0.15s ease, background 0.2s, border-color 0.2s;
    }
    .btn-gps-hud:active { transform: scale(0.92); }
    .btn-gps-hud.mode-1 { border-color: #38bdf8; box-shadow: 0 0 12px rgba(56, 189, 248, 0.5); }
    .btn-gps-hud.mode-2 { border-color: #22c55e; background: rgba(6, 78, 59, 0.85); box-shadow: 0 0 14px rgba(34, 197, 94, 0.6); }
    .btn-gps-hud.mode-3 { border-color: #eab308; background: rgba(113, 63, 18, 0.85); box-shadow: 0 0 16px rgba(234, 179, 8, 0.7); }
    .btn-gps-hud-label { font-size: 8px; font-weight: 800; color: #94a3b8; margin-top: 1px; text-transform: uppercase; }

    /* Кнопка повернення до авто */
    .btn-recenter-car {
      position: fixed;
      right: 122px;
      bottom: 74px;
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: #0284c7;
      border: 1.5px solid #38bdf8;
      color: #fff;
      display: none;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      cursor: pointer;
      z-index: 1000;
      box-shadow: 0 4px 14px rgba(0,0,0,0.4);
      animation: pulse-gps-btn 1.6s infinite;
    }
    @keyframes pulse-gps-btn { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.08); } }

    /* Спідометр */
    .gps-speed-hud {
      position: fixed;
      left: 14px;
      bottom: 74px;
      background: rgba(15, 23, 42, 0.88);
      border: 1px solid #334155;
      padding: 3px 8px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
      font-size: 11px;
      font-weight: 800;
      color: #38bdf8;
      display: none;
      z-index: 1000;
      backdrop-filter: blur(6px);
    }
    #map.gps-rotating {
      transition: transform 0.25s linear;
      transform-origin: 50% 50%;
    }
  `;
  document.head.appendChild(styleEl);

  const btnGps = document.createElement("div");
  btnGps.id = "btnGpsHud";
  btnGps.className = "btn-gps-hud";
  btnGps.innerHTML = `<span>🧭</span><span class="btn-gps-hud-label">GPS</span>`;
  btnGps.onclick = () => toggleGpsMode();
  document.body.appendChild(btnGps);

  const btnRecenter = document.createElement("div");
  btnRecenter.id = "btnRecenterCar";
  btnRecenter.className = "btn-recenter-car";
  btnRecenter.innerHTML = `🎯`;
  btnRecenter.onclick = () => recenterCar();
  document.body.appendChild(btnRecenter);

  const speedHud = document.createElement("div");
  speedHud.id = "gpsSpeedHud";
  speedHud.className = "gps-speed-hud";
  speedHud.innerText = `0 км/год`;
  document.body.appendChild(speedHud);

  // Розрахунок масштабу машинки залежно від масштабу карти
  function getDynamicCarScale() {
    if (!window.map) return 1.0;
    const z = window.map.getZoom();
    if (z >= 16.5) return 1.0;
    const scale = 1.0 - (16.5 - z) * 0.14;
    return Math.max(0.35, Math.min(1.0, scale));
  }

  function applyCarVisuals() {
    const wrapper = document.getElementById("navCarWrapper");
    if (!wrapper) return;
    const rotateDeg = gpsMode === 3 ? 0 : currentHeading;
    const scale = getDynamicCarScale();
    wrapper.style.transform = `rotate(${rotateDeg}deg) scale(${scale})`;
    wrapper.classList.toggle("is-mode-1", gpsMode === 1);
  }

  function setupMapInteractionListeners() {
    if (!window.map) {
      setTimeout(setupMapInteractionListeners, 200);
      return;
    }
    window.map.on('dragstart', () => {
      if (gpsMode === 2 || gpsMode === 3) {
        isUserPanning = true;
        btnRecenter.style.display = "flex";
      }
    });
    window.map.on('zoom', () => {
      applyCarVisuals();
    });
  }
  setupMapInteractionListeners();

  function toggleGpsMode() {
    gpsMode = (gpsMode + 1) % 4;
    updateGpsButtonUI();

    if (gpsMode === 0) {
      stopGps();
      if (window.map) {
        const initCenter = (typeof INITIAL_CENTER !== 'undefined') ? INITIAL_CENTER : [48.484, 34.985];
        const initZoom = (typeof INITIAL_ZOOM !== 'undefined') ? INITIAL_ZOOM : (window.innerWidth < 768 ? 12 : 13);
        window.map.flyTo(initCenter, initZoom, { animate: true, duration: 0.8 });
      }
      if (typeof showToast === "function") showToast("⚪ Навігацію вимкнено (старт)");
    } else {
      if (!watchId) startGps();
      isUserPanning = false;
      btnRecenter.style.display = "none";

      if (gpsMode === 1) {
        resetMapRotation();
        if (typeof showToast === "function") showToast("📍 Режим: Вільний огляд");
      } else if (gpsMode === 2) {
        resetMapRotation();
        recenterCar(16.5);
        if (typeof showToast === "function") showToast("🧭 Режим: Штурман");
      } else if (gpsMode === 3) {
        recenterCar(16.5);
        if (typeof showToast === "function") showToast("🚗 Режим: По курсу");
      }
    }
    applyCarVisuals();
  }
  window.toggleGpsMode = toggleGpsMode;

  function updateGpsButtonUI() {
    btnGps.className = "btn-gps-hud";
    if (gpsMode === 0) {
      btnGps.innerHTML = `<span>🧭</span><span class="btn-gps-hud-label">GPS</span>`;
      speedHud.style.display = "none";
      btnRecenter.style.display = "none";
    } else if (gpsMode === 1) {
      btnGps.classList.add("mode-1");
      btnGps.innerHTML = `<span>📍</span><span class="btn-gps-hud-label">Огляд</span>`;
      speedHud.style.display = "block";
    } else if (gpsMode === 2) {
      btnGps.classList.add("mode-2");
      btnGps.innerHTML = `<span>🧭</span><span class="btn-gps-hud-label">Шлях</span>`;
      speedHud.style.display = "block";
    } else if (gpsMode === 3) {
      btnGps.classList.add("mode-3");
      btnGps.innerHTML = `<span>🚗</span><span class="btn-gps-hud-label">Курс</span>`;
      speedHud.style.display = "block";
    }
  }

  function startGps() {
    if (!navigator.geolocation) {
      alert("GPS не підтримується вашим браузером.");
      gpsMode = 0;
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
    if (carMarker && window.map) {
      window.map.removeLayer(carMarker);
      carMarker = null;
    }
    resetMapRotation();
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

    if (coords.heading !== null && !isNaN(coords.heading) && currentSpeedKmH >= 3) {
      currentHeading = Math.round(coords.heading);
    }

    updateCarMarker(currentLat, currentLng, currentHeading);

    if (!isUserPanning && window.map) {
      if (gpsMode === 2) {
        window.map.panTo([currentLat, currentLng], { animate: true, duration: 0.5 });
      } else if (gpsMode === 3) {
        window.map.panTo([currentLat, currentLng], { animate: false });
        rotateMapToHeading(currentHeading);
      }
    }
  }

  function onGpsError(err) {
    console.warn("Помилка GPS:", err.message);
  }

  function updateCarMarker(lat, lng, heading) {
    if (!window.map) return;

    if (!carMarker) {
      const customCarIcon = L.divIcon({
        className: 'nav-car-leaflet-icon',
        html: carIconSvg,
        iconSize: [40, 70],
        iconAnchor: [20, 35]
      });
      carMarker = L.marker([lat, lng], { icon: customCarIcon, zIndexOffset: 2000 }).addTo(window.map);
    } else {
      carMarker.setLatLng([lat, lng]);
    }

    applyCarVisuals();
  }

  function rotateMapToHeading(heading) {
    const mapEl = document.getElementById("map");
    if (!mapEl) return;
    mapEl.classList.add("gps-rotating");
    mapEl.style.transform = `rotate(${-heading}deg) scale(1.35)`;
  }

  function resetMapRotation() {
    const mapEl = document.getElementById("map");
    if (!mapEl) return;
    mapEl.style.transform = "";
    setTimeout(() => { mapEl.classList.remove("gps-rotating"); }, 260);
  }

  function recenterCar(targetZoom = null) {
    if (currentLat === null || currentLng === null || !window.map) return;
    isUserPanning = false;
    btnRecenter.style.display = "none";
    const zoom = targetZoom || window.map.getZoom();
    window.map.flyTo([currentLat, currentLng], zoom, { animate: true, duration: 0.6 });
    if (gpsMode === 3) {
      rotateMapToHeading(currentHeading);
    }
  }
  window.recenterCar = recenterCar;

})();
