/**
 * Radar Dnipro — Модуль "Радіо ефір" (ticker.js)
 * Фільтр по контрольних точках: 
 * - Негативні (БП): червоні літери з чорною обводкою
 * - Звичайні (Чисто): чорні літери
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
    #btnRadioTopCenter {
      position: absolute !important;
      top: 15px !important;
      left: calc(50% - 33px) !important;
      transform: translateX(-50%) !important;
      z-index: 2100 !important;
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
      transition: all 0.2s ease;
    }
    #btnRadioTopCenter:active { transform: translateX(-50%) scale(0.92); }
    #btnRadioTopCenter.active {
      background: #0284c7 !important;
      border-color: #00f3ff !important;
      box-shadow: 0 0 18px rgba(0, 243, 255, 0.6) !important;
    }

    #radioFeedOverlay {
      position: absolute !important;
      top: 60px !important;
      left: 15px !important;
      right: 15px !important;
      z-index: 2000 !important;
      display: none;
      flex-direction: column;
      gap: 5px;
      pointer-events: none;
      user-select: none;
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

    /* 🟢 Звичайні повідомлення: чисто чорний колір */
    .radio-msg-line.clean .radio-msg-time,
    .radio-msg-line.clean .radio-msg-text {
      color: #000000 !important;
      text-shadow: none !important;
      -webkit-text-stroke: 0 !important;
    }

    /* 🔴 Негативні повідомлення: червоні літери з чорною обводкою */
    .radio-msg-line.danger .radio-msg-time,
    .radio-msg-line.danger .radio-msg-text {
      color: #ff2233 !important;
      -webkit-text-stroke: 0.6px #000000;
      text-shadow: 
        -1px -1px 0 #000000,
         1px -1px 0 #000000,
        -1px  1px 0 #000000,
         1px  1px 0 #000000,
         0 0 2px #000000 !important;
    }
  `;
  document.head.appendChild(style);

  // 2. Створення елементів розмітки
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
