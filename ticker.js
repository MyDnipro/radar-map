/**
 * Radar Dnipro — Модуль "Радіо ефір" (ticker.js)
 * Фільтр по 8 контрольних точках маршруту
 * - Негативні (БП): чисто червоні літери
 * - Звичайні (Чисто): чорні літери
 * - Відкритий ШІ, Дашборд або відкрита картка точки (popup) повністю ховають повідомлення
 */
(function() {
  let isRadioActive = localStorage.getItem("radar_radio_active") === "true";

  // Словник фільтрації за 8 контрольними точками
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
    /* Кнопка 📻: шар нижчий за спливаючі картки та вікна ШІ (950) */
    #btnRadioTopCenter {
      position: absolute !important;
      top: 15px !important;
      left: calc(50% - 14px) !important;
      transform: translateX(-50%) !important;
      z-index: 950 !important;
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
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    #btnRadioTopCenter:active { transform: translateX(-50%) scale(0.92); }
    #btnRadioTopCenter.active {
      background: #0284c7 !important;
      border-color: #00f3ff !important;
      box-shadow: 0 0 18px rgba(0, 243, 255, 0.6) !important;
    }

    /* Шар повідомлень: опущений до 800, щоб спливаючі вікна точок були вище */
    #radioFeedOverlay {
      position: absolute !important;
      top: 60px !important;
      left: 15px !important;
      right: 15px !important;
      z-index: 800 !important;
      display: none;
      flex-direction: column;
      gap: 5px;
      pointer-events: none;
      user-select: none;
      transition: opacity 0.2s ease;
    }

    /* Спливаючі картки точок на карті завжди вище повідомлень */
    .leaflet-popup, .leaflet-popup-pane {
      z-index: 1500 !important;
    }

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

    /* Приховування при відкритті будь-якої панелі */
    body.panel-overlap-active #btnRadioTopCenter,
    body.panel-overlap-active #radioFeedOverlay {
      display: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }

    /* Якщо на карті відкрито popup мітки — автоматично ховаємо повідомлення радіо */
    body.has-popup-open #radioFeedOverlay {
      display: none !important;
      opacity: 0 !important;
    }
  `;
  document.head.appendChild(style);

  // 2. Створення елементів
  const radioBtn = document.createElement("div");
  radioBtn.id = "btnRadioTopCenter";
  radioBtn.title = "Радіо ефір маршруту";
  radioBtn.innerText = "📻";
  document.body.appendChild(radioBtn);

  const feedBox = document.createElement("div");
  feedBox.id = "radioFeedOverlay";
  document.body.appendChild(feedBox);

  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(radioBtn);
    L.DomEvent.disableClickPropagation(feedBox);
  }

  function getCleanTimestamp(p) {
    let t = p.time || p.timestamp || p.date || 0;
    if (typeof t === "string") t = Number(t) || Date.parse(t) || 0;
    if (t > 0 && t < 10000000000) t *= 1000;
    return t;
  }

  // 3. Відображення повідомлень
  function renderRadioFeed() {
    if (!isRadioActive) {
      feedBox.style.display = "none";
      radioBtn.classList.remove("active");
      return;
    }

    // Якщо відкрита картка точки, не показуємо блок
    if (document.body.classList.contains('has-popup-open')) {
      feedBox.style.display = "none";
      return;
    }

    feedBox.style.display = "flex";
    radioBtn.classList.add("active");

    const allPts = (window.allPoints && Array.isArray(window.allPoints)) ? window.allPoints.slice() : [];
    const filteredPts = allPts.filter(isCheckpointMessage);
    filteredPts.sort((a, b) => getCleanTimestamp(b) - getCleanTimestamp(a));

    const top4 = filteredPts.slice(0, 4);
    feedBox.innerHTML = "";

    if (top4.length === 0) {
      feedBox.innerHTML = `<div class="radio-msg-line clean" style="opacity:0.65;">📻 По контрольних точках повідомлень немає</div>`;
      return;
    }

    top4.forEach(p => {
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

      feedBox.appendChild(row);
    });
  }

  // 4. Слідкування за станом вікна ШІ, Дашборду та відкритими картками на карті
  function checkPanelsState() {
    // 1. Перевірка відкритих карток точок (Leaflet popup)
    const activePopup = document.querySelector('.leaflet-popup');
    if (activePopup) {
      document.body.classList.add('has-popup-open');
    } else {
      document.body.classList.remove('has-popup-open');
    }

    // 2. Перевірка вікна ШІ
    const aiInput = document.querySelector('input[placeholder*="Команда" i], textarea[placeholder*="Команда" i]');
    const aiPanel = aiInput 
      ? (aiInput.closest('[id*="ai" i], [class*="ai" i], div[style*="position"], div') || aiInput.parentElement.parentElement)
      : document.querySelector('#aiPanel, #aiCard, #aiModal, #aiWindow, #aiChat, .ai-panel, .ai-card, #chatContainer, [id*="ai" i]');

    let isAiExpanded = false;
    if (aiPanel) {
      aiPanel.style.zIndex = "2500";
      const isHidden = aiPanel.style.display === "none" || 
                       aiPanel.classList.contains("collapsed") ||
                       aiPanel.classList.contains("hidden") ||
                       document.documentElement.classList.contains("ai-collapsed") ||
                       aiPanel.offsetHeight < 80;
      isAiExpanded = !isHidden && aiPanel.offsetHeight > 100;
    }

    // 3. Перевірка дашборду точок
    const isDashExpanded = document.documentElement.classList.contains('dash-expanded') || 
                           (!document.documentElement.classList.contains('dash-collapsed') && (document.querySelector('#dashPanel, .dash-panel')?.offsetHeight || 0) > 150);

    if (isAiExpanded || isDashExpanded) {
      document.body.classList.add('panel-overlap-active');
    } else {
      document.body.classList.remove('panel-overlap-active');
    }
  }

  setInterval(checkPanelsState, 200);
  window.addEventListener('click', () => setTimeout(checkPanelsState, 50));

  radioBtn.addEventListener("click", () => {
    isRadioActive = !isRadioActive;
    localStorage.setItem("radar_radio_active", isRadioActive ? "true" : "false");
    renderRadioFeed();
    if (typeof window.showToast === "function") {
      window.showToast(isRadioActive ? "📻 Ефір маршруту увімкнено!" : "📻 Радіо ефір вимкнено");
    }
  });

  window.addEventListener('radar:pointsUpdated', () => {
    if (isRadioActive) renderRadioFeed();
  });

  setInterval(() => {
    if (isRadioActive) renderRadioFeed();
  }, 4000);

  setTimeout(renderRadioFeed, 800);
})();
