/**
 * Radar Dnipro — Модуль "Радіо ефір" (ticker.js)
 * Кнопка [ 📻 ] вгорі по центру та 4 останніх повідомлення без фону прямо на карті
 */
(function() {
  let isRadioActive = localStorage.getItem("radar_radio_active") === "true";

  // Стилі
  const style = document.createElement("style");
  style.textContent = `
    /* Кнопка 📻 вгорі між двома блоками */
    #btnRadioTopCenter {
      position: absolute !important;
      top: 15px !important;
      left: 50% !important;
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

    /* Контейнер 4 повідомлень без фону */
    #radioFeedOverlay {
      position: absolute !important;
      top: 62px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      z-index: 2000 !important;
      width: calc(100vw - 30px);
      max-width: 460px;
      display: none;
      flex-direction: column;
      gap: 5px;
      pointer-events: none;
      user-select: none;
    }

    /* Рядок повідомлення без плашки */
    .radio-msg-line {
      pointer-events: auto;
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.3;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      text-shadow:
        0 1px 3px #000000,
        0 2px 6px #000000,
        0 0 12px rgba(0, 0, 0, 0.95);
      transition: transform 0.15s ease, opacity 0.2s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .radio-msg-line:active { transform: scale(0.98); }
    .radio-msg-time {
      color: #38bdf8;
      font-size: 11px;
      flex-shrink: 0;
      text-shadow: 0 1px 3px #000, 0 0 8px #000;
    }
    .radio-msg-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;
  document.head.appendChild(style);

  // Створення кнопки та оверлею
  const radioBtn = document.createElement("div");
  radioBtn.id = "btnRadioTopCenter";
  radioBtn.title = "Радіо ефір (останні 4 повідомлення)";
  radioBtn.innerText = "📻";
  document.body.appendChild(radioBtn);

  const feedBox = document.createElement("div");
  feedBox.id = "radioFeedOverlay";
  document.body.appendChild(feedBox);

  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(radioBtn);
    L.DomEvent.disableClickPropagation(feedBox);
  }

  function renderRadioFeed() {
    if (!isRadioActive) {
      feedBox.style.display = "none";
      radioBtn.classList.remove("active");
      return;
    }

    feedBox.style.display = "flex";
    radioBtn.classList.add("active");

    const points = Array.isArray(window.allPoints) ? window.allPoints.slice() : [];
    points.sort((a, b) => (b.time || b.timestamp || 0) - (a.time || a.timestamp || 0));
    const top4 = points.slice(0, 4);

    feedBox.innerHTML = "";

    if (top4.length === 0) {
      feedBox.innerHTML = `<div class="radio-msg-line" style="justify-content:center; color:#94a3b8;">📻 Ефір підключається...</div>`;
      return;
    }

    top4.forEach(p => {
      const isClean = (typeof window.isCleanPoint === "function") ? window.isCleanPoint(p) : (p.color === "green");
      const dot = isClean ? "🟢" : "🔴";

      const timeVal = p.time || p.timestamp || 0;
      let timeStr = "";
      if (timeVal) {
        const d = new Date(timeVal);
        timeStr = String(d.getHours()).padStart(2, '0') + ":" + String(d.getMinutes()).padStart(2, '0');
      }

      const text = p.text || p.raw_text || p.address || "Повідомлення";

      const row = document.createElement("div");
      row.className = "radio-msg-line";
      row.innerHTML = `
        <span>${dot}</span>
        <span class="radio-msg-time">${timeStr}</span>
        <span class="radio-msg-text">${text}</span>
      `;

      row.addEventListener("click", () => {
        if (window.map && window.map.flyTo && p.lat && p.lng) {
          window.map.flyTo([p.lat, p.lng], 16, { animate: true, duration: 0.85 });
          if (typeof window.showToast === "function") window.showToast(`🎯 Перехід: ${text.slice(0, 25)}...`);
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
      window.showToast(isRadioActive ? "📻 Радіо ефір увімкнено!" : "📻 Радіо ефір вимкнено");
    }
  });

  // Автоматичне оновлення рядків при кожному оновленні списку точок
  setInterval(() => {
    if (isRadioActive) renderRadioFeed();
  }, 4000);

  setTimeout(renderRadioFeed, 1200);
})();
