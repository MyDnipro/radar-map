/**
 * gps.js — Модуль GPS-навігації та відстеження місця розташування (v5.0)
 * Дизайн: ядро з плавним переливом кольорів + м'яка біла хвиля-спалах
 */

(function() {
  let watchId = null;
  let isGpsActive = false;
  let userMarker = null;
  let accuracyCircle = null;

  // Стартова позиція огляду міста з index.html
  function getHomeCenter() {
    return (typeof window.INITIAL_CENTER !== 'undefined' && Array.isArray(window.INITIAL_CENTER))
      ? window.INITIAL_CENTER
      : [48.478, 34.975];
  }

  function getHomeZoom() {
    return (typeof window.INITIAL_ZOOM !== 'undefined')
      ? window.INITIAL_ZOOM
      : (window.innerWidth < 768 ? 11.6 : 12.0);
  }

  // Оновлення кнопки навігації (компас)
  function updateGpsBtnUI(active) {
    const btn = document.getElementById("btnGpsHud");
    if (!btn) return;
    if (active) {
      btn.classList.add("active");
      btn.style.background = "#0284c7";
      btn.style.boxShadow = "0 0 14px rgba(2, 132, 199, 0.85)";
      btn.innerHTML = `<span>📍</span>`;
    } else {
      btn.classList.remove("active");
      btn.style.background = "";
      btn.style.boxShadow = "";
      btn.innerHTML = `<span>🧭</span>`;
    }
  }

  // Стилі переливу кольорів ядра та білої спалах-хвилі
  if (!document.getElementById("gpsMarkerStyle")) {
    const style = document.createElement("style");
    style.id = "gpsMarkerStyle";
    style.innerHTML = `
      @keyframes gpsColorShift {
        0% { background: #00f3ff; box-shadow: 0 0 10px #00f3ff; }
        33% { background: #3b82f6; box-shadow: 0 0 10px #3b82f6; }
        66% { background: #a855f7; box-shadow: 0 0 10px #a855f7; }
        100% { background: #00f3ff; box-shadow: 0 0 10px #00f3ff; }
      }
      @keyframes gpsWhiteFlashPulse {
        0% {
          transform: translate(-50%, -50%) scale(0.6);
          opacity: 0.95;
          border-color: #ffffff;
          box-shadow: 0 0 8px #ffffff;
        }
        60% {
          opacity: 0.45;
          border-color: rgba(255, 255, 255, 0.8);
        }
        100% {
          transform: translate(-50%, -50%) scale(2.8);
          opacity: 0;
          border-color: rgba(255, 255, 255, 0);
          box-shadow: 0 0 18px rgba(255, 255, 255, 0);
        }
      }
      .gps-user-wrap {
        position: relative;
        width: 26px;
        height: 26px;
      }
      .gps-white-wave {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        border: 2px solid #ffffff;
        animation: gpsWhiteFlashPulse 1.8s infinite cubic-bezier(0.15, 0.6, 0.35, 1);
        pointer-events: none;
      }
      .gps-white-wave:nth-child(2) {
        animation-delay: 0.9s;
      }
      .gps-core-dot {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid #ffffff;
        animation: gpsColorShift 4s infinite linear;
        z-index: 2;
      }
    `;
    document.head.appendChild(style);
  }

  // Створення маркера поточної позиції користувача
  function ensureUserMarker(latLng) {
    if (!window.map) return;

    if (!userMarker) {
      const pulseHtml = `
        <div class="gps-user-wrap">
          <div class="gps-white-wave"></div>
          <div class="gps-white-wave"></div>
          <div class="gps-core-dot"></div>
        </div>
      `;
      const gpsIcon = L.divIcon({
        className: 'user-gps-marker',
        html: pulseHtml,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      userMarker = L.marker(latLng, { icon: gpsIcon, zIndexOffset: 3000 }).addTo(window.map);
    } else {
      userMarker.setLatLng(latLng);
    }
  }

  // Перемикання режиму навігації
  window.toggleGpsMode = function() {
    if (!navigator.geolocation) {
      if (typeof window.showToast === "function") {
        window.showToast("⚠️ Геолокація не підтримується цим пристроєм");
      }
      return;
    }

    if (isGpsActive) {
      // ВИМКНЕННЯ НАВІГАЦІЇ
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      isGpsActive = false;
      updateGpsBtnUI(false);

      if (userMarker && window.map) {
        window.map.removeLayer(userMarker);
        userMarker = null;
      }
      if (accuracyCircle && window.map) {
        window.map.removeLayer(accuracyCircle);
        accuracyCircle = null;
      }

      if (typeof window.showToast === "function") {
        window.showToast("🧭 Навігацію вимкнено");
      }
    } else {
      // УВІМКНЕННЯ НАВІГАЦІЇ
      isGpsActive = true;
      updateGpsBtnUI(true);

      if (typeof window.showToast === "function") {
        window.showToast("📡 Пошук GPS...");
      }

      if (window.map) {
        window.map.flyTo(getHomeCenter(), getHomeZoom(), { animate: true, duration: 0.5 });
      }

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (!isGpsActive || !window.map) return;
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = pos.coords.accuracy || 20;
          const latLng = [lat, lng];

          ensureUserMarker(latLng);

          // Коло похибки
          if (!accuracyCircle) {
            accuracyCircle = L.circle(latLng, {
              radius: accuracy,
              color: '#ffffff',
              weight: 1,
              opacity: 0.55,
              fillColor: '#00f3ff',
              fillOpacity: 0.08
            }).addTo(window.map);
          } else {
            accuracyCircle.setLatLng(latLng);
            accuracyCircle.setRadius(accuracy);
          }

          // М'яке панорамування без стрибків масштабу
          if (!window.map.getBounds().contains(latLng)) {
            window.map.panTo(latLng);
          }
        },
        (err) => {
          console.warn("Помилка GPS:", err.message);
          if (typeof window.showToast === "function") {
            window.showToast("⚠️ Не вдалося визначити координати GPS");
          }
          window.toggleGpsMode();
        },
        {
          enableHighAccuracy: true,
          maximumAge: 5000,
          timeout: 12000
        }
      );
    }
  };
})();
