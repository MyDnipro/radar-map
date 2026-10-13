/**
 * Radar Dnipro — Модуль "Радіо ефір" (ticker.js)
 * Кнопка [ 📻 ] вгорі по центру та 4 останніх повідомлення без фону прямо на карті
 */
(function() {
  let isRadioActive = localStorage.getItem("radar_radio_active") === "true";

  // Стилі
  const style = document.createElement("style");
  style.textContent = `
    /* Кнопка 📻 вгорі між блоками */
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

    /* Прозорий шар 4 повідомлень без фону */
    #radioFeedOverlay {
      position: absolute !important;
      top: 60px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      z-index: 2000 !important;
      width: calc(100vw - 30px);
      max-width: 440px;
      display: none;
      flex-direction: column;
      gap: 6px;
      pointer-events: none;
      user-select: none;
    }

    /* Рядок тексту без плашки з глибокою тінню */
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
        0 1px 2px #000000,
        0 2px 5px #000000,
        0 0 10px rgba(0, 0, 0, 0.95);
      display: flex;
      align-items: center;
      gap: 6px;
      transition: transform 0.15s ease;
    }
    .radio-msg-line:active { transform: scale(0.97); }
    .radio-msg-time {
      color: #38bdf8;
      font-size: 11px;
      font-weight: 800;
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

  // Створення розмітки
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

  function getCleanTimestamp(p) {
    let t = p.time || p.timestamp || 0;
    if (typeof t === "string") t = Number(t) || Date.parse(t) || 0;
    if (t > 0 && t < 10000000000) t *= 1000; // конвертація секунд у мс
    return t;
  }

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
      feedBox.innerHTML = `<div class="radio-msg-line" style="justify-content:center; color:#94a3b8;">📻 Ефір шукає повідомлення...</div>`;
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

      row.addEventListener("click", () => {
        if (window.map && window.map.flyTo && p.lat && p.lng) {
          window.map.flyTo([p.lat, p.lng], 16, { animate: true, duration: 0.85 });
          if (typeof window.showToast === "function") window.showToast(`🎯 Фокус: ${txt.slice(0, 24)}...`);
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

  window.addEventListener('radar:pointsUpdated', () => {
    if (isRadioActive) renderRadioFeed();
  });

  setTimeout(renderRadioFeed, 1000);
})();
