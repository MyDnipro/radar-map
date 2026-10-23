/**
 * Radar Dnipro — Модуль "Радіо ефір" (ticker.js) v5.6
 * Виправлено:
 * - Повністю усунено мерехтіння кнопки рації та рядків повідомлень
 * - Оптимізовано Smart Mask (без безперервного завантаження CPU/GPU кожні 100 мс)
 * - Апаратна ізоляція шарів через 3D-композитинг (translate3d, backface-visibility)
 * - Захист від подвійного кліка (Ghost clicks) та залипання тапа на смартфонах
 * - Стабільна фіксація висоти без стрибків у простому та повному режимах
 */
(function() {
  let isRadioActive = localStorage.getItem("radar_radio_active") === "true";
  let radioMode = localStorage.getItem("radar_radio_mode") || "route";
  let isExpanded = false;
  let lastDataSignature = "";
  let lastRadioTapTime = 0;
  let lastExpandTapTime = 0;

  const STATS_ARCHIVE_URL = (window.FIREBASE_POINTS_URL 
    ? window.FIREBASE_POINTS_URL.replace("points.json", "stats_archive.json") 
    : "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/stats_archive.json");

  // Контрольні точки маршруту водія
  const CHECKPOINT_REGEXES = [
    /кайдак/i, /ровд/i, /райотдел/i,
    /водолечеб/i, /водолікарн/i, /пр[\s.]*свободи/i,
    /комбайн/i, /ударник/i,
    /краснозавод/i, /белелюб/i, /білелюб/i, /дтрз/i,
    /павлов/i,
    /речпорт/i, /річпорт/i, /ричпор/i, /десантник/i,
    /водокачк/i,
    /(?:стан\s*550|стан550|\b550\b)/i,
    /(?:набережн.*завод|наб.*завод)/i,
    /канатн/i, /інфекці/i, /инфекци/i, /21\s*лікарн/i, /21\s*больниц/i,
    /щепкін/i, /щепкин/i
  ];

  function isCheckpointMessage(point) {
    if (!point) return false;
    const fullText = ((point.text || "") + " " + (point.raw_text || "") + " " + (point.address || "")).toLowerCase();
    return CHECKPOINT_REGEXES.some(rgx => rgx.test(fullText));
  }

  // 1. СТИЛІ РАДІО-ЕФІРУ З АПАРАТНОЮ СТАБІЛІЗАЦІЄЮ
  const style = document.createElement("style");
  style.textContent = `
    #btnKeepAwake { display: none !important; }

    /* Кнопка 📻 строго по центру екрана зі стабільним 3D-шаром */
    #btnRadioTopCenter {
      position: absolute !important;
      top: 15px !important;
      left: 50% !important;
      transform: translate3d(-50%, 0, 0) !important;
      -webkit-transform: translate3d(-50%, 0, 0) !important;
      z-index: 850 !important;
      width: 38px;
      height: 38px;
      box-sizing: border-box;
      background: rgba(15, 23, 42, 0.94);
      border: 1.5px solid #38bdf8;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      user-select: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
      outline: none;
      -webkit-backface-visibility: hidden;
      backface-visibility: hidden;
      will-change: transform;
      transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
    }
    #btnRadioTopCenter:active {
      transform: translate3d(-50%, 0, 0) scale(0.92) !important;
      -webkit-transform: translate3d(-50%, 0, 0) scale(0.92) !important;
    }
    #btnRadioTopCenter.active {
      background: #0284c7 !important;
      border-color: #00f3ff !important;
      box-shadow: 0 0 18px rgba(0, 243, 255, 0.6) !important;
    }

    /* Контейнер радіо-стрічки з ізольованим шаром відеопам'яті */
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
      -webkit-user-select: none;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      -webkit-backface-visibility: hidden;
      backface-visibility: hidden;
      transform: translate3d(0, 0, 0);
      -webkit-transform: translate3d(0, 0, 0);
      will-change: opacity, height;
      transition: background 0.22s ease, border-color 0.22s ease, box-shadow 0.22s ease;
    }

    /* Верхня панель */
    .radio-header-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      pointer-events: auto !important;
      margin-bottom: 3px;
      gap: 6px;
      height: 24px;
      box-sizing: border-box;
    }

    /* Перемикач над текстом */
    .radio-mode-switcher {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 14px;
      padding: 1px 3px;
      -webkit-tap-highlight-color: transparent;
    }
    .radio-mode-tab {
      cursor: pointer;
      font-size: 10px;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 10px;
      color: #94a3b8;
      transition: background 0.15s ease, color 0.15s ease;
      user-select: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
    }
    .radio-mode-tab.active {
      background: #0284c7;
      color: #ffffff;
      box-shadow: 0 0 8px rgba(2, 132, 199, 0.6);
    }

    /* Кнопка розгортання */
    .radio-expand-btn {
      cursor: pointer;
      font-size: 13px;
      font-weight: 900;
      padding: 2px 8px;
      border-radius: 10px;
      color: #38bdf8;
      background: rgba(15, 23, 42, 0.75);
      border: 1px solid rgba(56, 189, 248, 0.35);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      -webkit-user-select: none;
      -webkit-tap-highlight-color: transparent;
      outline: none;
      transition: background 0.15s ease, color 0.15s ease, transform 0.15s ease;
    }
    .radio-expand-btn:active {
      transform: scale(0.92);
    }

    /* Скрол-список (4 рядки по 24px = 96px) */
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
      -webkit-backface-visibility: hidden;
      backface-visibility: hidden;
      transform: translate3d(0, 0, 0);
    }
    .radio-scroll-list::-webkit-scrollbar {
      display: none;
    }

    .radio-msg-line {
      height: 24px !important;
      line-height: 24px !important;
      pointer-events: none;
      font-size: 12.5px;
      font-weight: 800;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 6px;
      box-sizing: border-box;
      -webkit-backface-visibility: hidden;
      backface-visibility: hidden;
      transform: translate3d(0, 0, 0);
      transition: opacity 0.15s linear;
    }

    /* Точковий клікабельний кружок фокусу */
    .radio-msg-dot {
      pointer-events: auto !important;
      cursor: pointer;
      font-size: 13px;
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      -webkit-tap-highlight-color: transparent;
      transition: transform 0.15s ease;
    }
    .radio-msg-dot:active {
      transform: scale(1.35);
    }

    .radio-msg-time {
      font-size: 11px;
      font-weight: 900;
      flex-shrink: 0;
      pointer-events: none;
    }
    .radio-msg-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      pointer-events: none;
    }

    /* Кольори за замовчуванням */
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

    /* =========================================================================
       РОЗГОРНУТИЙ СТАН НА ВЕСЬ ЕКРАН (ТЕМНА ПІДКЛАДКА + ЧІТКИЙ ТЕКСТ)
       ========================================================================= */
    #radioFeedOverlay.expanded {
      background: rgba(15, 23, 42, 0.94) !important;
      border: 1.5px solid #0284c7 !important;
      border-radius: 16px !important;
      padding: 10px 12px !important;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.9) !important;
      pointer-events: auto !important;
      z-index: 2500 !important;
    }

    #radioFeedOverlay.expanded .radio-scroll-list {
      height: calc(100vh - 170px) !important;
      max-height: calc(100vh - 170px) !important;
      padding-right: 2px;
    }

    #radioFeedOverlay.expanded .radio-msg-line {
      height: 28px !important;
      line-height: 28px !important;
      border-bottom: 1px solid rgba(51, 65, 85, 0.45);
    }

    #radioFeedOverlay.expanded .radio-msg-line.clean,
    #radioFeedOverlay.expanded .radio-msg-line.clean * {
      color: #f8fafc !important;
    }
    #radioFeedOverlay.expanded .radio-msg-line.clean .radio-msg-time {
      color: #38bdf8 !important;
    }

    #radioFeedOverlay.expanded .radio-msg-line.danger,
    #radioFeedOverlay.expanded .radio-msg-line.danger * {
      color: #fca5a5 !important;
    }
    #radioFeedOverlay.expanded .radio-msg-line.danger .radio-msg-time {
      color: #ef4444 !important;
    }
  `;
  document.head.appendChild(style);

  // 2. СТВОРЕННЯ ВУЗЛІВ DOM
  const radioBtn = document.createElement("div");
  radioBtn.id = "btnRadioTopCenter";
  radioBtn.title = "Радіо ефір";
  radioBtn.innerText = "📻";
  document.body.appendChild(radioBtn);

  const feedBox = document.createElement("div");
  feedBox.id = "radioFeedOverlay";

  const headerBar = document.createElement("div");
  headerBar.className = "radio-header-bar";

  const switcher = document.createElement("div");
  switcher.className = "radio-mode-switcher";
  switcher.innerHTML = `
    <span class="radio-mode-tab ${radioMode === 'route' ? 'active' : ''}" data-mode="route">Мій шлях</span>
    <span class="radio-mode-tab ${radioMode === 'city' ? 'active' : ''}" data-mode="city">Все місто</span>
  `;

  const expandBtn = document.createElement("div");
  expandBtn.id = "btnRadioExpand";
  expandBtn.className = "radio-expand-btn";
  expandBtn.title = "Розгорнути на весь екран";
  expandBtn.innerText = "⤢";

  headerBar.appendChild(switcher);
  headerBar.appendChild(expandBtn);

  const scrollList = document.createElement("div");
  scrollList.className = "radio-scroll-list";

  feedBox.appendChild(headerBar);
  feedBox.appendChild(scrollList);
  document.body.appendChild(feedBox);

  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(radioBtn);
    L.DomEvent.disableClickPropagation(feedBox);
    L.DomEvent.disableScrollPropagation(scrollList);
  }
  ["touchstart", "touchmove", "touchend", "wheel", "mousedown", "dblclick"].forEach(evt => {
    feedBox.addEventListener(evt, (e) => e.stopPropagation(), { passive: true });
  });

  // Обробник розгортання з анти-дребезгом
  function toggleExpandFeed(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const now = Date.now();
    if (now - lastExpandTapTime < 300) return;
    lastExpandTapTime = now;

    isExpanded = !isExpanded;
    feedBox.classList.toggle("expanded", isExpanded);
    expandBtn.innerText = isExpanded ? "⤡" : "⤢";
    expandBtn.title = isExpanded ? "Згорнути до 4 рядків" : "Розгорнути на весь екран";

    if (isExpanded) {
      scrollList.querySelectorAll(".radio-msg-line").forEach(r => r.style.opacity = "1");
    }
  }

  expandBtn.addEventListener("pointerdown", toggleExpandFeed);

  // ОПТИМІЗОВАНИЙ SMART MASK (без нескінченного перерахунку DOM)
  let hadPopupLastCheck = false;
  function updateSmartMask() {
    if (!isRadioActive || feedBox.style.display === "none" || isExpanded) return;

    const popupWrapper = document.querySelector(".leaflet-popup");
    const rows = scrollList.querySelectorAll(".radio-msg-line");
    if (rows.length === 0) return;

    if (!popupWrapper) {
      if (hadPopupLastCheck) {
        rows.forEach(r => r.style.opacity = "1");
        hadPopupLastCheck = false;
      }
      return;
    }

    hadPopupLastCheck = true;
    const pRect = popupWrapper.getBoundingClientRect();

    rows.forEach(row => {
      const rRect = row.getBoundingClientRect();
      const isOverlapped = !(rRect.bottom < pRect.top + 4 || rRect.top > pRect.bottom - 4 || rRect.right < pRect.left || rRect.left > pRect.right);
      const targetOpacity = isOverlapped ? "0" : "1";
      if (row.style.opacity !== targetOpacity) {
        row.style.opacity = targetOpacity;
      }
    });
  }

  setInterval(updateSmartMask, 200);

  // Перемикання вкладок
  switcher.addEventListener("click", (e) => {
    e.stopPropagation();
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

  function getStartOfDayMs() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  const todayMessagesMap = new Map();

  function getMsgDedupKey(p) {
    if (p._fbKey) return String(p._fbKey);
    const t = getCleanTimestamp(p);
    const txt = (p.text || p.raw_text || p.address || "").trim().toLowerCase();
    return `${t}_${txt}`;
  }

  // Завантаження локального кешу
  try {
    const cached = JSON.parse(localStorage.getItem("radar_today_radio_feed") || "[]");
    const sod = getStartOfDayMs();
    if (Array.isArray(cached)) {
      cached.forEach(p => {
        if (p && getCleanTimestamp(p) >= sod) {
          todayMessagesMap.set(getMsgDedupKey(p), p);
        }
      });
    }
  } catch(e) {}

  function saveTodayCache() {
    try {
      const arr = Array.from(todayMessagesMap.values());
      localStorage.setItem("radar_today_radio_feed", JSON.stringify(arr));
    } catch(e) {}
  }

  function mergePointsIntoTodayFeed(pts) {
    if (!Array.isArray(pts) || pts.length === 0) return false;
    const sod = getStartOfDayMs();
    let hasNew = false;

    for (const [k, v] of todayMessagesMap.entries()) {
      if (getCleanTimestamp(v) < sod) {
        todayMessagesMap.delete(k);
        hasNew = true;
      }
    }

    pts.forEach(p => {
      if (!p) return;
      const t = getCleanTimestamp(p);
      if (t >= sod) {
        const k = getMsgDedupKey(p);
        if (!todayMessagesMap.has(k)) {
          todayMessagesMap.set(k, p);
          hasNew = true;
        }
      }
    });

    if (hasNew) saveTodayCache();
    return hasNew;
  }

  async function loadTodayArchive() {
    try {
      const res = await fetch(`${STATS_ARCHIVE_URL}?t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data) return;

      const list = Object.entries(data).map(([key, val]) => {
        if (!val || typeof val !== 'object') return null;
        return { ...val, _fbKey: key };
      }).filter(Boolean);

      if (mergePointsIntoTodayFeed(list)) {
        renderRadioFeed(false);
      }
    } catch(e) {}
  }

  // 3. ВІДОБРАЖЕННЯ ПОВІДОМЛЕНЬ
  function renderRadioFeed(forceRebuild = false) {
    if (!isRadioActive) {
      feedBox.style.display = "none";
      radioBtn.classList.remove("active");
      if (isExpanded) {
        isExpanded = false;
        feedBox.classList.remove("expanded");
        expandBtn.innerText = "⤢";
      }
      return;
    }

    feedBox.style.display = "flex";
    radioBtn.classList.add("active");

    const isSimple = document.documentElement.classList.contains("mode-simple");
    const activeMode = isSimple ? "city" : radioMode;

    switcher.style.display = isSimple ? "none" : "inline-flex";
    headerBar.style.justifyContent = isSimple ? "flex-end" : "space-between";

    switcher.querySelectorAll(".radio-mode-tab").forEach(el => {
      el.classList.toggle("active", el.getAttribute("data-mode") === activeMode);
    });

    if (window.allPoints && Array.isArray(window.allPoints)) {
      mergePointsIntoTodayFeed(window.allPoints);
    }

    const sod = getStartOfDayMs();
    let allToday = Array.from(todayMessagesMap.values()).filter(p => getCleanTimestamp(p) >= sod);

    const filteredPts = (activeMode === "route") ? allToday.filter(isCheckpointMessage) : allToday;
    filteredPts.sort((a, b) => getCleanTimestamp(b) - getCleanTimestamp(a));

    const newestTime = filteredPts.length > 0 ? getCleanTimestamp(filteredPts[0]) : 0;
    const signature = `${isSimple ? 's' : 'f'}_${activeMode}_${filteredPts.length}_${newestTime}_${isExpanded ? 'exp' : 'col'}`;

    if (!forceRebuild && signature === lastDataSignature) {
      return;
    }
    lastDataSignature = signature;

    const prevScroll = scrollList.scrollTop;
    scrollList.innerHTML = "";

    if (filteredPts.length === 0) {
      scrollList.innerHTML = `<div class="radio-msg-line clean" style="opacity:0.65;">📻 Повідомлень за сьогодні немає</div>`;
      return;
    }

    filteredPts.forEach(p => {
      const isClean = (typeof window.isCleanPoint === "function") 
        ? window.isCleanPoint(p) 
        : (p.color === "green" || p.is_clean === true);
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
      
      const dotSpan = document.createElement("span");
      dotSpan.className = "radio-msg-dot";
      dotSpan.innerText = dot;
      dotSpan.title = "Натисніть для переходу до точки на карті";

      dotSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        if (window.map && window.map.flyTo && p.lat && p.lng) {
          window.map.flyTo([p.lat, p.lng], 16, { animate: true, duration: 0.85 });
          if (typeof window.showToast === "function") window.showToast(`🎯 Фокус: ${txt.slice(0, 22)}...`);
        }
      });

      const timeSpan = document.createElement("span");
      timeSpan.className = "radio-msg-time";
      timeSpan.innerText = timeStr;

      const textSpan = document.createElement("span");
      textSpan.className = "radio-msg-text";
      textSpan.innerText = txt;

      row.appendChild(dotSpan);
      row.appendChild(timeSpan);
      row.appendChild(textSpan);

      scrollList.appendChild(row);
    });

    if (!forceRebuild) {
      scrollList.scrollTop = prevScroll;
    }
  }

  // Обробник натискання рації без двоїння на смартфонах
  function handleRadioToggle(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const now = Date.now();
    if (now - lastRadioTapTime < 300) return;
    lastRadioTapTime = now;

    isRadioActive = !isRadioActive;
    localStorage.setItem("radar_radio_active", isRadioActive ? "true" : "false");
    lastDataSignature = "";
    renderRadioFeed(true);
    if (typeof window.showToast === "function") {
      window.showToast(isRadioActive ? "📻 Ефір увімкнено!" : "📻 Радіо ефір вимкнено");
    }
  }

  radioBtn.addEventListener("pointerdown", handleRadioToggle);

  window.addEventListener('radar:pointsUpdated', (e) => {
    if (e.detail && Array.isArray(e.detail)) {
      mergePointsIntoTodayFeed(e.detail);
    }
    if (isRadioActive) renderRadioFeed(false);
  });

  window.addEventListener('radar:uiModeChanged', () => {
    lastDataSignature = "";
    if (isRadioActive) renderRadioFeed(true);
  });

  setInterval(() => {
    if (isRadioActive) renderRadioFeed(false);
  }, 4000);

  setTimeout(() => {
    renderRadioFeed(true);
    loadTodayArchive();
  }, 600);
})();
