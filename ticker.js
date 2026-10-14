/**
 * Radar Dnipro — Модуль "Радіо ефір" з розумним маскуванням (ticker.js)
 * - 4 рядки на екрані + плавний скрол до 100 повідомлень назад
 * - Перемикач: "Мій шлях" / "Все місто"
 * - Динамічний "ластик": ховаються тільки ті рядки, які реально накриті попапом карти
 * - Автоматичне утримання екрана (завжди увімкнено)
 */
(function() {
  let isRadioActive = localStorage.getItem("radar_radio_active") === "true";
  let radioMode = localStorage.getItem("radar_radio_mode") || "route";
  let lastDataSignature = "";

  // Словник фільтрації за 8 контрольними точками маршруту
  const CHECKPOINT_REGEXES = [
    /кайдак/i, /ровд/i,
    /водолечеб/i, /водолікарн/i, /пр[\s.]*свободи/i,
    /комбайн/i, /ударник/i,
    /краснозавод/i, /белелюб/i, /дтрз/i,
    /павлов/i,
    /речпорт/i, /річпорт/i, /десантник/i,
    /водокачк/i,
    /\bстан\s*550\b/i, /\bстан550\b/i
  ];

  function isCheckpointMessage(point) {
    if (!point) return false;
    const fullText = ((point.text || "") + " " + (point.raw_text || "") + " " + (point.address || "")).toLowerCase();
    return CHECKPOINT_REGEXES.some(rgx => rgx.test(fullText));
  }

  // 1. Стилі інтерфейсу
  const style = document.createElement("style");
  style.textContent = `
    #btnKeepAwake { display: none !important; }

    /* Кнопка 📻 */
    #btnRadioTopCenter {
      position: absolute !important;
      top: 15px !important;
      left: calc(50% - 14px) !important;
      transform: translateX(-50%) !important;
      z-index: 850 !important;
      width: 38px;
      height: 38px;
      box-sizing: border-box;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(10px);
      border: 1.5px solid #38bdf8;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      user-select: none;
      transition: transform 0.2s ease;
    }
    #btnRadioTopCenter:active { transform: translateX(-50%) scale(0.92); }
    #btnRadioTopCenter.active {
      background: #0284c7 !important;
      border-color: #00f3ff !important;
      box-shadow: 0 0 18px rgba(0, 243, 255, 0.6) !important;
    }

    /* Контейнер радіо-ефіру */
    #radioFeedOverlay {
      position: absolute !important;
      top: 58px !important;
      left: 15px !important;
      right: 15px !important;
      z-index: 700 !important;
      display: none;
      flex-direction: column;
      gap: 3px;
      pointer-events: none;
      user-select: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      transition: opacity 0.15s ease;
    }

    /* Ненав'язливий напівпрозорий перемикач: Мій шлях | Все місто */
    .radio-mode-switcher {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      gap: 2px;
      background: rgba(15, 23, 42, 0.28);
      backdrop-filter: blur(4px);
      border: 1px solid rgba(56, 189, 248, 0.25);
      border-radius: 14px;
      padding: 1px 3px;
      margin-bottom: 2px;
      align-self: flex-start;
    }
    .radio-mode-tab {
      cursor: pointer;
      font-size: 10px;
      font-weight: 800;
      padding: 2px 7px;
      border-radius: 10px;
      color: rgba(15, 23, 42, 0.75);
      transition: all 0.15s ease;
    }
    .radio-mode-tab.active {
      background: rgba(2, 132, 199, 0.85);
      color: #ffffff;
    }

    /* Скрол-контейнер: 4 рядки по 24px */
    .radio-scroll-list {
      display: block !important;
      height: 96px !important;
      max-height: 96px !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      pointer-events: auto !important;
      touch-action: pan-y !important;
      -webkit-overflow-scrolling: touch !important;
      overscroll-behavior: contain !important;
      scrollbar-width: none;
    }
    .radio-scroll-list::-webkit-scrollbar {
      display: none;
    }

    .radio-msg-line {
      height: 24px !important;
      line-height: 24px !important;
      pointer-events: auto;
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 800;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: opacity 0.15s ease;
    }
    .radio-msg-line:active { opacity: 0.6; }

    .radio-msg-time {
      font-size: 11px;
      font-weight: 900;
      flex-shrink: 0;
    }
    .radio-msg-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .radio-msg-line.clean,
    .radio-msg-line.clean * {
      color: #000000 !important;
      text-shadow: none !important;
      -webkit-text-stroke: 0 !important;
      filter: none !important;
    }

    .radio-msg-line.danger,
    .radio-msg-line.danger * {
      color: #ff2233 !important;
      text-shadow: none !important;
      -webkit-text-stroke: 0 !important;
      filter: none !important;
    }
  `;
  document.head.appendChild(style);

  // 2. Створення елементів радіо
  const radioBtn = document.createElement("div");
  radioBtn.id = "btnRadioTopCenter";
  radioBtn.title = "Радіо ефір маршруту";
  radioBtn.innerText = "📻";
  document.body.appendChild(radioBtn);

  const feedBox = document.createElement("div");
  feedBox.id = "radioFeedOverlay";

  const switcher = document.createElement("div");
  switcher.className = "radio-mode-switcher";
  switcher.innerHTML = `
    <span class="radio-mode-tab ${radioMode === 'route' ? 'active' : ''}" data-mode="route">Мій шлях</span>
    <span class="radio-mode-tab ${radioMode === 'city' ? 'active' : ''}" data-mode="city">Все місто</span>
  `;

  const scrollList = document.createElement("div");
  scrollList.className = "radio-scroll-list";

  feedBox.appendChild(switcher);
  feedBox.appendChild(scrollList);
  document.body.appendChild(feedBox);

  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(radioBtn);
    L.DomEvent.disableClickPropagation(feedBox);
    L.DomEvent.disableScrollPropagation(feedBox);
    L.DomEvent.disableScrollPropagation(scrollList);
  }
  ["touchstart", "touchmove", "touchend", "wheel", "mousedown", "dblclick"].forEach(evt => {
    feedBox.addEventListener(evt, (e) => e.stopPropagation(), { passive: true });
  });

  // =========================================================================
  // 🧠 РОЗУМНИЙ ДИНАМІЧНИЙ ЛАСТИК (ПЕРЕВІРКА ПЕРЕРИСУВАННЯ ПОПАПОМ)
  // =========================================================================
  function updateSmartMask() {
    if (!isRadioActive || feedBox.style.display === "none") return;

    const popupWrapper = document.querySelector(".leaflet-popup");
    const rows = scrollList.querySelectorAll(".radio-msg-line");

    if (!popupWrapper) {
      // Якщо немає попапа — усі рядки видимі на 100%
      rows.forEach(r => r.style.opacity = "1");
      return;
    }

    const pRect = popupWrapper.getBoundingClientRect();

    // Порядково перевіряємо: чи накриває попап конкретний рядок радіо
    rows.forEach(row => {
      const rRect = row.getBoundingClientRect();
      // Перетин по вертикалі (з невеликим запасом)
      const isOverlapped = !(rRect.bottom < pRect.top + 5 || rRect.top > pRect.bottom - 5 || rRect.right < pRect.left || rRect.left > pRect.right);
      
      // Якщо рядок під попапом — робимо його повністю прозорим, інакше видимим
      row.style.opacity = isOverlapped ? "0" : "1";
    });
  }

  setInterval(updateSmartMask, 100);

  switcher.addEventListener("click", (e) => {
    const tab = e.target.closest(".radio-mode-tab");
    if (!tab) return;
    const newMode = tab.getAttribute("data-mode");
    if (newMode === radioMode) return;

    radioMode = newMode;
    localStorage.setItem("radar_radio_mode", radioMode);
    switcher.querySelectorAll(".radio-mode-tab").forEach(el => {
      el.classList.toggle("active", el.getAttribute("data-mode") === radioMode);
    });

    lastDataSignature = "";
    scrollList.scrollTop = 0;
    renderRadioFeed(true);
  });

  function getCleanTimestamp(p) {
    let t = p.time || p.timestamp || p.date || 0;
    if (typeof t === "string") t = Number(t) || Date.parse(t) || 0;
    if (t > 0 && t < 10000000000) t *= 1000;
    return t;
  }

  // 3. Відображення повідомлень
  function renderRadioFeed(forceRebuild = false) {
    if (!isRadioActive) {
      feedBox.style.display = "none";
      radioBtn.classList.remove("active");
      return;
    }

    feedBox.style.display = "flex";
    radioBtn.classList.add("active");

    const allPts = (window.allPoints && Array.isArray(window.allPoints)) ? window.allPoints.slice() : [];
    const filteredPts = (radioMode === "route") ? allPts.filter(isCheckpointMessage) : allPts;
    filteredPts.sort((a, b) => getCleanTimestamp(b) - getCleanTimestamp(a));

    const top100 = filteredPts.slice(0, 100);

    const newestTime = top100.length > 0 ? getCleanTimestamp(top100[0]) : 0;
    const signature = `${radioMode}_${top100.length}_${newestTime}`;
    if (!forceRebuild && signature === lastDataSignature) {
      return;
    }
    lastDataSignature = signature;

    const prevScroll = scrollList.scrollTop;
    scrollList.innerHTML = "";

    if (top100.length === 0) {
      scrollList.innerHTML = `<div class="radio-msg-line clean" style="opacity:0.65;">📻 Повідомлень немає</div>`;
      return;
    }

    top100.forEach(p => {
      const isClean = (typeof window.isCleanPoint === "function") ? window.isCleanPoint(p) : (p.color === "green");
      const dot = isClean ? "🟢" : "🔴";
      const statusClass = isClean ? "clean" : "danger";

      const tMs = getCleanTimestamp(p);
      let timeStr = "";
      if (tMs > 0) {
        const d = new Date(tMs);
        timeStr = String(d.getHours()).padStart(2, '0') + ":" + String(d.getMinutes()).padStart(2, '0');
      }

      const txt = p.text || p.raw_text || p.address || "Повідомлення";

      const row = document.createElement("div");
      row.className = `radio-msg-line ${statusClass}`;
      row.innerHTML = `
        <span>${dot}</span>
        <span class="radio-msg-time">${timeStr}</span>
        <span class="radio-msg-text">${txt}</span>
      `;

      row.addEventListener("click", () => {
        if (window.map && window.map.flyTo && p.lat && p.lng) {
          window.map.flyTo([p.lat, p.lng], 16, { animate: true, duration: 0.85 });
          if (typeof window.showToast === "function") window.showToast(`🎯 Фокус: ${txt.slice(0, 22)}...`);
        }
      });

      scrollList.appendChild(row);
    });

    if (!forceRebuild) {
      scrollList.scrollTop = prevScroll;
    }
  }

  radioBtn.addEventListener("click", () => {
    isRadioActive = !isRadioActive;
    localStorage.setItem("radar_radio_active", isRadioActive ? "true" : "false");
    lastDataSignature = "";
    renderRadioFeed(true);
    if (typeof window.showToast === "function") {
      window.showToast(isRadioActive ? "📻 Ефір увімкнено!" : "📻 Радіо ефір вимкнено");
    }
  });

  window.addEventListener('radar:pointsUpdated', () => {
    if (isRadioActive) renderRadioFeed(false);
  });

  setInterval(() => {
    if (isRadioActive) renderRadioFeed(false);
  }, 4000);

  setTimeout(() => renderRadioFeed(true), 600);

  // =========================================================================
  // 🔆 ФОНОВЕ УТРИМАННЯ ЕКРАНА ЗАВЖДИ УВІМКНЕНИМ ЗА ЗАМОВЧУВАННЯМ
  // =========================================================================
  let wakeLockObj = null;
  let videoEl = null;
  let audioCtx = null;

  function ensureAlwaysAwake() {
    if (!videoEl) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext("2d");
        let tick = 0;
        function drawLoop() {
          tick++;
          ctx.fillStyle = (tick % 2 === 0) ? "#010101" : "#020202";
          ctx.fillRect(0, 0, 16, 16);
          requestAnimationFrame(drawLoop);
        }
        drawLoop();

        videoEl = document.createElement("video");
        videoEl.setAttribute("playsinline", "");
        videoEl.setAttribute("webkit-playsinline", "");
        videoEl.setAttribute("loop", "");
        videoEl.muted = true;
        videoEl.volume = 0;
        videoEl.style.cssText = "position:fixed;bottom:0;right:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:1;";
        document.body.appendChild(videoEl);

        if (canvas.captureStream) {
          videoEl.srcObject = canvas.captureStream(10);
        }
      } catch (e) {}
    }

    if (videoEl && videoEl.paused) {
      videoEl.play().catch(() => {});
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx && AudioContextClass) {
        audioCtx = new AudioContextClass();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        gain.gain.value = 0.00001;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
      }
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
    } catch (e) {}

    if ("wakeLock" in navigator && !wakeLockObj) {
      navigator.wakeLock.request("screen").then(lock => {
        wakeLockObj = lock;
        wakeLockObj.addEventListener("release", () => { wakeLockObj = null; });
      }).catch(() => {});
    }
  }

  ensureAlwaysAwake();
  document.addEventListener("touchstart", ensureAlwaysAwake, { passive: true });
  document.addEventListener("click", ensureAlwaysAwake, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ensureAlwaysAwake();
  });
  setInterval(ensureAlwaysAwake, 8000);
})();
