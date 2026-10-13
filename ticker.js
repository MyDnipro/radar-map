/**
 * Radar Dnipro — Модуль "Радіо ефір" (ticker.js)
 * Кнопка [ 📻 ] вгорі по центру та 4 останніх повідомлення чорним текстом без фону
 */
(function() {
  let isRadioActive = localStorage.getItem("radar_radio_active") === "true";

  // 1. Стилі інтерфейсу
  const style = document.createElement("style");
  style.textContent = `
    /* Кнопка 📻 строго посередині між двома верхніми блоками */
    #btnRadioTopCenter {
      position: absolute !important;
      top: 15px !important;
      left: calc(50% - 5px) !important;
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

    /* Шар для 4 повідомлень без підкладки */
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

    /* Рядок повідомлення: чисто чорний колір, без тіней */
    .radio-msg-line {
      pointer-events: auto;
      cursor: pointer;
      font-size: 12px;
      font-weight: 800;
      color: #000000 !important;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-shadow: none !important;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: transform 0.15s ease;
    }
    .radio-msg-line:active { transform: scale(0.98); }
    .radio-msg-time {
      color: #000000 !important;
      font-size: 11px;
      font-weight: 900;
      flex-shrink: 0;
      text-shadow: none !important;
    }
    .radio-msg-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #000000 !important;
      text-shadow: none !important;
    }
  `;
  document.head.appendChild(style);

  // 2. Створення кнопки та контейнера повідомлень
  const radioBtn = document.createElement("div");
  radioBtn.id = "btnRadioTopCenter";
  radioBtn.title = "Радіо ефір (останні 4 повідомлення)";
  radioBtn.innerText = "📻";
  document.body.appendChild(radioBtn);

  const feedBox = document.createElement("div");
  feedBox.id = "radioFeedOverlay";
  document.body.appendChild(feedBox);

  // Блокування передачі кліків на карту Leaflet
  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(radioBtn);
    L.DomEvent.disableClickPropagation(feedBox);
  }

  // Універсальний парсер часу (секунди або мілісекунди)
  function getCleanTimestamp(p) {
    let t = p.time || p.timestamp || p.date || 0;
    if (typeof t === "string") t = Number(t) || Date.parse(t) || 0;
    if (t > 0 && t < 10000000000) t *= 1000;
    return t;
  }

  // 3. Формування та показ 4 останніх повідомлень
  function renderRadioFeed() {
    if (!isRadioActive) {
      feedBox.style.display = "none";
      radioBtn.classList.remove("active");
      return;
    }

    feedBox.style.display = "flex";
    radioBtn.classList.add("active");

    const pts = (window.allPoints && Array.isArray(window.allPoints)) ? window.allPoints.slice() : [];
    pts.sort((a, b) => getCleanTimestamp(b) - getCleanTimestamp(a));
    const top4 = pts.slice(0, 4);

    feedBox.innerHTML = "";

    if (top4.length === 0) {
      feedBox.innerHTML = `<div class="radio-msg-line" style="justify-content:center; color:#475569;">📻 Ефір підключається...</div>`;
      return;
    }

    top4.forEach(p => {
      const isClean = (typeof window.isCleanPoint === "function") ? window.isCleanPoint(p) : (p.color === "green");
      const dot = isClean ? "🟢" : "🔴";

      const tMs = getCleanTimestamp(p);
      let timeStr = "";
      if (tMs > 0) {
        const d = new Date(tMs);
        timeStr = String(d.getHours()).padStart(2, '0') + ":" + String(d.getMinutes()).padStart(2, '0');
      }

      const txt = p.text || p.raw_text || p.address || "Повідомлення";

      const row = document.createElement("div");
      row.className = "radio-msg-line";
      row.innerHTML = `
        <span>${dot}</span>
        <span class="radio-msg-time">${timeStr}</span>
        <span class="radio-msg-text">${txt}</span>
      `;

      // При кліку по рядку — плавний політ до точки
      row.addEventListener("click", () => {
        if (window.map && window.map.flyTo && p.lat && p.lng) {
          window.map.flyTo([p.lat, p.lng], 16, { animate: true, duration: 0.85 });
          if (typeof window.showToast === "function") window.showToast(`🎯 Фокус: ${txt.slice(0, 22)}...`);
        }
      });

      feedBox.appendChild(row);
    });
  }

  // 4. Перемикання стану Радіо
  radioBtn.addEventListener("click", () => {
    isRadioActive = !isRadioActive;
    localStorage.setItem("radar_radio_active", isRadioActive ? "true" : "false");
    renderRadioFeed();
    if (typeof window.showToast === "function") {
      window.showToast(isRadioActive ? "📻 Радіо ефір увімкнено!" : "📻 Радіо ефір вимкнено");
    }
  });

  // Підписка на оновлення точок від карти
  window.addEventListener('radar:pointsUpdated', () => {
    if (isRadioActive) renderRadioFeed();
  });

  // Автоматичне фонове оновлення кожні 4 секунди
  setInterval(() => {
    if (isRadioActive) renderRadioFeed();
  }, 4000);

  setTimeout(renderRadioFeed, 800);
})();
