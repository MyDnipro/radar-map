/**
 * Radar Dnipro — Модуль "Живий ефір" (ticker.js)
 * Фантомний рядок останніх повідомлень із радіо-іконкою [📻]
 */
(function() {
  let isEnabled = localStorage.getItem("radar_ticker_enabled") !== "false";
  let currentIndex = 0;
  let activePointsList = [];
  let rotationTimer = null;
  let latestSeenTime = 0;

  // 1. Стилі для капсули та згорнутої іконки
  const style = document.createElement("style");
  style.textContent = `
    /* Основна капсула ефіру */
    #liveTickerCapsule {
      position: absolute !important;
      top: 62px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      z-index: 2050 !important;
      max-width: calc(100vw - 30px);
      width: max-content;
      min-width: 240px;
      height: 32px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(10px);
      border: 1px solid #38bdf8;
      border-radius: 16px;
      padding: 0 8px 0 10px;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5), 0 0 10px rgba(56, 189, 248, 0.25);
      user-select: none;
      box-sizing: border-box;
      cursor: pointer;
      transition: opacity 0.3s ease, transform 0.2s ease, border-color 0.3s ease;
    }
    #liveTickerCapsule:active { transform: translateX(-50%) scale(0.98); }
    #liveTickerCapsule.flash-new {
      border-color: #00f3ff !important;
      box-shadow: 0 0 20px rgba(0, 243, 255, 0.6) !important;
    }

    .ticker-radio-icon {
      font-size: 14px;
      line-height: 1;
      filter: drop-shadow(0 0 4px rgba(56, 189, 248, 0.6));
    }

    .ticker-body-text {
      flex: 1;
      font-size: 11px;
      color: #f8fafc;
      font-weight: 700;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: opacity 0.35s ease;
      line-height: 1.2;
    }

    .ticker-btn-close {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: #1e293b;
      color: #94a3b8;
      font-size: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      margin-left: 2px;
      flex-shrink: 0;
      transition: background 0.15s, color 0.15s;
    }
    .ticker-btn-close:hover { background: #ef4444; color: #fff; }

    /* Згорнута міні-кнопка радіо */
    #tickerMiniToggle {
      position: absolute !important;
      top: 62px !important;
      right: 15px !important;
      z-index: 2050 !important;
      width: 32px;
      height: 32px;
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.9);
      backdrop-filter: blur(8px);
      border: 1px solid #475569;
      display: none;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
      font-size: 14px;
      user-select: none;
      transition: transform 0.15s ease, border-color 0.2s ease;
    }
    #tickerMiniToggle:active { transform: scale(0.92); }
  `;
  document.head.appendChild(style);

  // 2. Створення елементів розмітки
  const capsule = document.createElement("div");
  capsule.id = "liveTickerCapsule";
  capsule.innerHTML = `
    <span class="ticker-radio-icon">📻</span>
    <span id="tickerText" class="ticker-body-text">Ефір підключається...</span>
    <span id="tickerBtnClose" class="ticker-btn-close" title="Сховати ефір">✕</span>
  `;
  document.body.appendChild(capsule);

  const miniToggle = document.createElement("div");
  miniToggle.id = "tickerMiniToggle";
  miniToggle.title = "Увімкнути живий ефір";
  miniToggle.innerText = "📻";
  document.body.appendChild(miniToggle);

  // Захист від передачі кліків на карту Leaflet
  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(capsule);
    L.DomEvent.disableScrollPropagation(capsule);
    L.DomEvent.disableClickPropagation(miniToggle);
  }

  const textEl = document.getElementById("tickerText");
  const closeBtn = document.getElementById("tickerBtnClose");

  // 3. Збирання свіжих точок
  function getRecentSortedPoints() {
    if (!Array.isArray(window.allPoints)) return [];
    return window.allPoints
      .slice()
      .filter(p => p && p.lat && p.lng)
      .sort((a, b) => (b.time || b.timestamp || 0) - (a.time || a.timestamp || 0));
  }

  // 4. Показ конкретної точки
  function displayPoint(p, isBrandNew = false) {
    if (!p) {
      textEl.innerText = "Спокійно • Нових повідомлень немає";
      return;
    }

    textEl.style.opacity = "0";

    setTimeout(() => {
      const isClean = (typeof window.isCleanPoint === "function") ? window.isCleanPoint(p) : (p.color === "green");
      const stDot = isClean ? "🟢" : "🔴";

      const timeVal = p.time || p.timestamp || 0;
      let timeStr = "";
      if (timeVal) {
        const d = new Date(timeVal);
        timeStr = String(d.getHours()).padStart(2, '0') + ":" + String(d.getMinutes()).padStart(2, '0') + " • ";
      }

      const msg = p.text || p.raw_text || p.address || "Повідомлення";
      textEl.innerHTML = `${stDot} <span style="color:#94a3b8; font-size:10px;">${timeStr}</span>${msg}`;
      textEl.style.opacity = "1";

      capsule.onclick = (e) => {
        if (e.target.id === "tickerBtnClose") return;
        if (window.map && window.map.flyTo) {
          window.map.flyTo([p.lat, p.lng], 16, { animate: true, duration: 0.85 });
          if (typeof window.showToast === "function") window.showToast(`🎯 Фокус на точку ефіру!`);
        }
      };

      if (isBrandNew) {
        capsule.classList.add("flash-new");
        setTimeout(() => capsule.classList.remove("flash-new"), 1500);
      }
    }, 200);
  }

  // 5. Ротація повідомлень
  function stepRotation() {
    activePointsList = getRecentSortedPoints();
    if (activePointsList.length === 0) {
      displayPoint(null);
      return;
    }

    // Перевірка появи нової точки (позачерговий показ)
    const newestTime = activePointsList[0].time || activePointsList[0].timestamp || 0;
    if (newestTime > latestSeenTime && latestSeenTime !== 0) {
      latestSeenTime = newestTime;
      currentIndex = 0;
      displayPoint(activePointsList[0], true);
      return;
    }
    latestSeenTime = Math.max(latestSeenTime, newestTime);

    if (currentIndex >= activePointsList.length) currentIndex = 0;
    displayPoint(activePointsList[currentIndex]);
    currentIndex = (currentIndex + 1) % activePointsList.length;
  }

  function startCycle() {
    if (rotationTimer) clearInterval(rotationTimer);
    stepRotation();
    rotationTimer = setInterval(stepRotation, 7000);
  }

  function stopCycle() {
    if (rotationTimer) clearInterval(rotationTimer);
  }

  // 6. Управління станом вкл / викл
  function applyVisibilityState() {
    if (isEnabled) {
      capsule.style.display = "flex";
      miniToggle.style.display = "none";
      startCycle();
    } else {
      capsule.style.display = "none";
      miniToggle.style.display = "flex";
      stopCycle();
    }
  }

  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    isEnabled = false;
    localStorage.setItem("radar_ticker_enabled", "false");
    applyVisibilityState();
    if (typeof window.showToast === "function") window.showToast("📻 Ефір згорнуто у значок");
  });

  miniToggle.addEventListener("click", () => {
    isEnabled = true;
    localStorage.setItem("radar_ticker_enabled", "true");
    applyVisibilityState();
    if (typeof window.showToast === "function") window.showToast("📻 Живий ефір активовано!");
  });

  // Запуск після ініціалізації мапи
  setTimeout(() => {
    applyVisibilityState();
  }, 1200);
})();
