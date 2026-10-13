/**
 * Radar Dnipro — Модуль "Радіо ефір" (ticker.js)
 * - Скрол пальцем до 100 повідомлень (за останні 60 хв)
 * - Міні-перемикач режиму: "Мій шлях" (8 точок) / "Все місто"
 * - Клік по рядку центрує та наближає точку на карті
 * - Попапи та ШІ перекривають радіо зверху через z-index
 */
(function() {
  let isRadioActive = localStorage.getItem("radar_radio_active") === "true";
  let radioMode = localStorage.getItem("radar_radio_mode") || "route"; // "route" або "city"

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
      left: 14px !important;
      right: 14px !important;
      z-index: 800 !important;
      display: none;
      flex-direction: column;
      gap: 5px;
      pointer-events: none;
      user-select: none;
    }

    /* Компактний міні-перемикач режимів зверху */
    .radio-mode-switcher {
      pointer-events: auto;
      display: inline-flex;
      align-self: flex-start;
      gap: 4px;
      background: rgba(15, 23, 42, 0.78);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 20px;
      padding: 2px 4px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      margin-bottom: 2px;
    }
    .radio-mode-tab {
      cursor: pointer;
      font-size: 10.5px;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 12px;
      color: #94a3b8;
      transition: all 0.2s ease;
    }
    .radio-mode-tab.active {
      background: #0284c7;
      color: #ffffff;
      box-shadow: 0 1px 6px rgba(2, 132, 199, 0.5);
    }

    /* Скрол-контейнер повідомлень (до 4 рядків на екрані, решта гортається свайпом) */
    .radio-scroll-list {
      display: flex;
      flex-direction: column;
      gap: 5px;
      max-height: 125px; /* Висота приблизно 4 рядків */
      overflow-y: auto;
      overflow-x: hidden;
      pointer-events: auto;
      -webkit-overflow-scrolling: touch;
      scrollbar-width: none; /* Приховуємо скролбар у Firefox */
    }
    .radio-scroll-list::-webkit-scrollbar {
      display: none; /* Приховуємо скролбар у Chrome/Safari */
    }

    /* Рядок повідомлення */
    .radio-msg-line {
      pointer-events: auto;
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 800;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: transform 0.15s ease;
    }
    .radio-msg-line:active { transform: scale(0.98); }

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

    /* 🟢 Звичайні повідомлення: чорні літери */
    .radio-msg-line.clean,
    .radio-msg-line.clean * {
      color: #000000 !important;
      text-shadow: none !important;
      -webkit-text-stroke: 0 !important;
      filter: none !important;
    }

    /* 🔴 Негативні повідомлення: чисто червоні літери */
    .radio-msg-line.danger,
    .radio-msg-line.danger * {
      color: #ff2233 !important;
      text-shadow: none !important;
      -webkit-text-stroke: 0 !important;
      filter: none !important;
    }

    /* Попапи карток та вікно ШІ залишаються строго вище за повідомлення */
    .leaflet-popup, 
    .leaflet-popup-pane,
    .leaflet-pane.leaflet-popup-pane {
      z-index: 1500 !important;
    }
    #aiPanel, #aiCard, #aiModal, #aiWindow, #aiChat, .ai-panel, .ai-card, #chatContainer {
      z-index: 2500 !important;
    }
  `;
  document.head.appendChild(style);

  // 2. Створення елементів розмітки
  const radioBtn = document.createElement("div");
  radioBtn.id = "btnRadioTopCenter";
  radioBtn.title = "Радіо ефір";
  radioBtn.innerText = "📻";
  document.body.appendChild(radioBtn);

  const feedBox = document.createElement("div");
  feedBox.id = "radioFeedOverlay";

  // Створюємо перемикач [ Мій шлях | Все місто ]
  const switcher = document.createElement("div");
  switcher.className = "radio-mode-switcher";
  switcher.innerHTML = `
    <span class="radio-mode-tab ${radioMode === 'route' ? 'active' : ''}" data-mode="route">🛣️ Мій шлях</span>
    <span class="radio-mode-tab ${radioMode === 'city' ? 'active' : ''}" data-mode="city">🏙️ Все місто</span>
  `;

  // Створюємо скрол-контейнер для повідомлень
  const scrollList = document.createElement("div");
  scrollList.className = "radio-scroll-list";

  feedBox.appendChild(switcher);
  feedBox.appendChild(scrollList);
  document.body.appendChild(feedBox);

  // Захист від передачі кліків на карту під час скролу чи тапу
  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(radioBtn);
    L.DomEvent.disableClickPropagation(feedBox);
    L.DomEvent.disableScrollPropagation(scrollList);
  }

  // Обробка перемикача режимів
  switcher.addEventListener("click", (e) => {
    const target = e.target.closest(".radio-mode-tab");
    if (!target) return;
    const mode = target.getAttribute("data-mode");
    if (mode === radioMode) return;

    radioMode = mode;
    localStorage.setItem("radar_radio_mode", radioMode);

    switcher.querySelectorAll(".radio-mode-tab").forEach(tab => {
      tab.classList.toggle("active", tab.getAttribute("data-mode") === radioMode);
    });

    renderRadioFeed();
    if (typeof window.showToast === "function") {
      window.showToast(radioMode === "route" ? "📍 Режим: Мій шлях (8 точок)" : "🌍 Режим: Повідомлення по всьому місту");
    }
  });

  function getCleanTimestamp(p) {
    let t = p.time || p.timestamp || p.date || 0;
    if (typeof t === "string") t = Number(t) || Date.parse(t) || 0;
    if (t > 0 && t < 10000000000) t *= 1000;
    return t;
  }

  // 3. Відображення та генерація списку повідомлень
  function renderRadioFeed() {
    if (!isRadioActive) {
      feedBox.style.display = "none";
      radioBtn.classList.remove("active");
      return;
    }

    feedBox.style.display = "flex";
    radioBtn.classList.add("active");

    const allPts = (window.allPoints && Array.isArray(window.allPoints)) ? window.allPoints.slice() : [];
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000); // Глибина історії: 1 година

    // Фільтрація за часом та обраним режимом
    let filteredPts = allPts.filter(p => {
      const t = getCleanTimestamp(p);
      return t === 0 || t >= oneHourAgo;
    });

    if (radioMode === "route") {
      filteredPts = filteredPts.filter(isCheckpointMessage);
    }

    // Сортування: найсвіжіші вгорі
    filteredPts.sort((a, b) => getCleanTimestamp(b) - getCleanTimestamp(a));

    // Обмежуємо список до 100 записів для комфортного швидкого скролу
    const messages = filteredPts.slice(0, 100);
    scrollList.innerHTML = "";

    if (messages.length === 0) {
      scrollList.innerHTML = `<div class="radio-msg-line clean" style="opacity:0.65;">📻 Повідомлень немає</div>`;
      return;
    }

    messages.forEach(p => {
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

      // При кліку на повідомлення плавно летимо до точки на карті
      row.addEventListener("click", () => {
        if (window.map && window.map.flyTo && p.lat && p.lng) {
          window.map.flyTo([p.lat, p.lng], 16, { animate: true, duration: 0.85 });
          if (typeof window.showToast === "function") window.showToast(`🎯 Фокус: ${txt.slice(0, 22)}...`);
        }
      });

      scrollList.appendChild(row);
    });
  }

  // 4. Управління кнопкою радіо
  radioBtn.addEventListener("click", () => {
    isRadioActive = !isRadioActive;
    localStorage.setItem("radar_radio_active", isRadioActive ? "true" : "false");
    renderRadioFeed();
    if (typeof window.showToast === "function") {
      window.showToast(isRadioActive ? "📻 Ефір увімкнено!" : "📻 Ефір вимкнено");
    }
  });

  window.addEventListener('radar:pointsUpdated', () => {
    if (isRadioActive) renderRadioFeed();
  });

  setInterval(() => {
    if (isRadioActive) renderRadioFeed();
  }, 4000);

  setTimeout(renderRadioFeed, 600);
})();
