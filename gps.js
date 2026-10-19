/**
 * gps.js — Модуль GPS-навігації та відстеження місця розташування (v4.0)
 */

(function() {
  let watchId = null;
  let isGpsActive = false;
  let userMarker = null;
  let accuracyCircle = null;

  // Визначаємо стартову позицію з index.html (з фокусом на Покровський)
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

  // Створення маркера поточної позиції користувача
  function ensureUserMarker(latLng) {
    if (!window.map) return;

    if (!userMarker) {
      const pulseHtml = `
        <div style="position:relative; width:20px; height:20px;">
          <div style="position:absolute; width:100%; height:100%; border-radius:50%; background:#00f3ff; opacity:0.8; animation: pulseGps 1.5s infinite;"></div>
          <div style="position:absolute; top:3px; left:3px; width:14px; height:14px; border-radius:50%; background:#0284c7; border:2px solid #ffffff; box-shadow:0 0 6px rgba(0,0,0,0.5);"></div>
        </div>
      `;
      const gpsIcon = L.divIcon({
        className: 'user-gps-marker',
        html: pulseHtml,
        iconSize: [20, 20],
        iconAnchor: [10, 10]
      });

      userMarker = L.marker(latLng, { icon: gpsIcon, zIndexOffset: 3000 }).addTo(window.map);
    } else {
      userMarker.setLatLng(latLng);
    }
  }

  // Додавання стилю пульсації для GPS-маркера
  if (!document.getElementById("gpsMarkerStyle")) {
    const style = document.createElement("style");
    style.id = "gpsMarkerStyle";
    style.innerHTML = `
      @keyframes pulseGps {
        0% { transform: scale(0.9); opacity: 0.9; }
        70% { transform: scale(2.2); opacity: 0; }
        100% { transform: scale(0.9); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
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

      // Плавне повернення до єдиного стартового ракурсу (Покровський)
      if (window.map) {
        window.map.flyTo(getHomeCenter(), getHomeZoom(), { animate: true, duration: 0.85 });
      }

      if (typeof window.showToast === "function") {
        window.showToast("🧭 Навігацію вимкнено (огляд маршруту)");
      }
    } else {
      // УВІМКНЕННЯ НАВІГАЦІЇ
      isGpsActive = true;
      updateGpsBtnUI(true);

      if (typeof window.showToast === "function") {
        window.showToast("📡 Пошук супутників GPS...");
      }

      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          if (!isGpsActive || !window.map) return;
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const accuracy = pos.coords.accuracy || 20;
          const latLng = [lat, lng];

          ensureUserMarker(latLng);

          // Коло радіуса точності GPS
          if (!accuracyCircle) {
            accuracyCircle = L.circle(latLng, {
              radius: accuracy,
              color: '#00f3ff',
              weight: 1,
              opacity: 0.5,
              fillColor: '#00f3ff',
              fillOpacity: 0.12
            }).addTo(window.map);
          } else {
            accuracyCircle.setLatLng(latLng);
            accuracyCircle.setRadius(accuracy);
          }

          // Центруємо карту на водієві
          window.map.setView(latLng, 16, { animate: true });
        },
        (err) => {
          console.warn("Помилка GPS:", err.message);
          if (typeof window.showToast === "function") {
            window.showToast("⚠️ Не вдалося отримати координати GPS");
          }
          window.toggleGpsMode(); // вимикаємо активний стан
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
