/**
 * Radar Dnipro — Модуль "Хроніка / Машина часу" (timeline.js)
 * Вертикальний таймлапс подій за Сьогодні / Вчора
 */
(function() {
  const FB_ARCHIVE_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/stats_archive.json";
  const WINDOW_MS = 40 * 60 * 1000; // Вікно життя мітки: 40 хвилин

  let isTimelineActive = false;
  let selectedDay = "today"; // "today" або "yesterday"
  let archivePoints = [];
  let isPlaying = false;
  let playInterval = null;
  let timelineLayer = null;

  // 1. Ін'єкція стилів
  const style = document.createElement("style");
  style.textContent = `
    /* Кнопка вгорі по центру між панелями */
    #btnTimelineToggle {
      position: absolute !important;
      top: 15px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      z-index: 2100 !important;
      height: 38px;
      padding: 0 12px;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(10px);
      border: 1.5px solid #38bdf8;
      border-radius: 12px;
      color: #38bdf8;
      font-size: 11px;
      font-weight: 800;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(56, 189, 248, 0.35);
      user-select: none;
      white-space: nowrap;
      transition: all 0.2s ease;
    }
    #btnTimelineToggle.active {
      background: #0284c7 !important;
      color: #ffffff !important;
      border-color: #00f3ff !important;
      box-shadow: 0 0 20px rgba(0, 243, 255, 0.6) !important;
    }

    /* Права вертикальна панель керування часом */
    #timelineSidePanel {
      position: absolute !important;
      right: 12px !important;
      top: 65px !important;
      bottom: 80px !important;
      width: 44px;
      background: rgba(15, 23, 42, 0.95);
      backdrop-filter: blur(12px);
      border: 1.5px solid #0284c7;
      border-radius: 16px;
      z-index: 2200 !important;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      padding: 10px 4px;
      box-shadow: 0 6px 25px rgba(0, 0, 0, 0.65);
      user-select: none;
      box-sizing: border-box;
      animation: slideInRight 0.25s ease-out;
    }
    @keyframes slideInRight {
      from { transform: translateX(60px); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }

    .tl-day-toggle {
      width: 34px;
      height: 24px;
      border-radius: 6px;
      background: #1e293b;
      border: 1px solid #475569;
      color: #94a3b8;
      font-size: 9px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .tl-day-toggle.active {
      background: #0284c7;
      border-color: #38bdf8;
      color: #ffffff;
    }

    /* Вертикальний слайдер */
    .tl-slider-wrap {
      flex: 1;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      margin: 10px 0;
    }
    .tl-slider {
      -webkit-appearance: slider-vertical;
      writing-mode: bt-lr;
      width: 8px;
      height: 100%;
      background: #1e293b;
      border-radius: 4px;
      outline: none;
      cursor: pointer;
      accent-color: #00f3ff;
    }

    .tl-btn-play {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: #1e293b;
      border: 1.5px solid #38bdf8;
      color: #38bdf8;
      font-size: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .tl-btn-play:active { transform: scale(0.92); }

    /* Плаваючий бейдж точного часу ліворуч від повзунка */
    #tlTimeBadge {
      position: absolute !important;
      right: 64px !important;
      background: rgba(15, 23, 42, 0.98);
      border: 1.5px solid #00f3ff;
      color: #ffffff;
      padding: 6px 10px;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 800;
      box-shadow: 0 4px 18px rgba(0, 243, 255, 0.4);
      white-space: nowrap;
      pointer-events: none;
      display: none;
      z-index: 2300 !important;
    }
  `;
  document.head.appendChild(style);

  // 2. Створення HTML-розмітки
  const toggleBtn = document.createElement("div");
  toggleBtn.id = "btnTimelineToggle";
  toggleBtn.innerHTML = `<span>⏳</span><span>Хроніка</span>`;
  document.body.appendChild(toggleBtn);

  const sidePanel = document.createElement("div");
  sidePanel.id = "timelineSidePanel";
  sidePanel.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:4px; align-items:center;">
      <div id="btnDayToday" class="tl-day-toggle active" title="Сьогодні">СЬОГ</div>
      <div id="btnDayYesterday" class="tl-day-toggle" title="Вчора">ВЧО</div>
    </div>

    <div class="tl-slider-wrap">
      <input type="range" id="tlRangeSlider" class="tl-slider" min="0" max="1440" value="1440" step="5">
    </div>

    <div style="display:flex; flex-direction:column; gap:6px; align-items:center;">
      <button id="btnTlPlay" class="tl-btn-play" title="Старт / Пауза">▶</button>
      <div id="btnTlClose" style="cursor:pointer; color:#94a3b8; font-size:14px; padding:2px;" title="Вийти в Live">✕</div>
    </div>
  `;
  document.body.appendChild(sidePanel);

  const timeBadge = document.createElement("div");
  timeBadge.id = "tlTimeBadge";
  document.body.appendChild(timeBadge);

  // 3. Відключення пробивання кліків на карту Leaflet
  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(toggleBtn);
    L.DomEvent.disableClickPropagation(sidePanel);
    L.DomEvent.disableScrollPropagation(sidePanel);
  }

  const rangeSlider = document.getElementById("tlRangeSlider");
  const playBtn = document.getElementById("btnTlPlay");
  const closeBtn = document.getElementById("btnTlClose");
  const btnToday = document.getElementById("btnDayToday");
  const btnYesterday = document.getElementById("btnDayYesterday");

  // 4. Отримання часових діапазонів
  function getDayBounds() {
    const now = new Date();
    if (selectedDay === "today") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
      const end = now.getTime();
      return { start, end };
    } else {
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const start = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 0, 0, 0).getTime();
      const end = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59).getTime();
      return { start, end };
    }
  }

  // 5. Завантаження архівних точок з Firebase
  async function loadArchiveData() {
    if (typeof window.showToast === "function") window.showToast("⏳ Завантаження історії подій...");
    try {
      const res = await fetch(`${FB_ARCHIVE_URL}?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object") {
          archivePoints = Object.values(data).filter(p => p && p.lat && p.lng && (p.time || p.timestamp));
        }
      }
    } catch (e) {}
  }

  // 6. Фільтрація та рендер точок для поточного положення повзунка
  function renderTimelineAtMinute(selectedMinute) {
    if (!window.map) return;
    if (!timelineLayer) {
      timelineLayer = L.layerGroup().addTo(window.map);
    }
    timelineLayer.clearLayers();

    const bounds = getDayBounds();
    const totalMinutes = selectedDay === "today" 
      ? Math.floor((bounds.end - bounds.start) / 60000) 
      : 1440;

    const clampedMinute = Math.min(selectedMinute, totalMinutes);
    const targetTimestamp = bounds.start + clampedMinute * 60000;

    // Оновлюємо бейдж часу
    const targetDate = new Date(targetTimestamp);
    const timeStr = String(targetDate.getHours()).padStart(2, '0') + ":" + String(targetDate.getMinutes()).padStart(2, '0');
    timeBadge.innerHTML = `🕒 <b>${selectedDay === "today" ? "Сьогодні" : "Вчора"} ${timeStr}</b>`;
    timeBadge.style.display = "block";

    // Позиціонування бейджа біля бігунка
    const rect = rangeSlider.getBoundingClientRect();
    const progress = clampedMinute / totalMinutes; // 0 (низ) до 1 (верх)
    const badgeY = rect.bottom - (rect.height * progress) - 14;
    timeBadge.style.top = `${badgeY}px`;

    // Точки, що потрапляють у 40-хвилинне вікно [T - 40хв ... T]
    const windowStart = targetTimestamp - WINDOW_MS;
    const activeAtMoment = archivePoints.filter(p => {
      const t = p.time || p.timestamp || 0;
      return t >= windowStart && t <= targetTimestamp;
    });

    activeAtMoment.forEach(pt => {
      const isClean = (typeof window.isCleanPoint === "function") ? window.isCleanPoint(pt) : (pt.color === "green");
      const colorClass = isClean ? "color-green" : "color-red";
      
      const dotIcon = L.divIcon({
        className: 'custom-dot-marker',
        html: `<div class="radar-circle ${colorClass}"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });

      const ptTime = new Date(pt.time || pt.timestamp);
      const ptTimeStr = String(ptTime.getHours()).padStart(2, '0') + ":" + String(ptTime.getMinutes()).padStart(2, '0');

      const marker = L.marker([pt.lat, pt.lng], { icon: dotIcon });
      marker.bindPopup(`
        <div style="font-size:11px; color:#0f172a; padding:4px;">
          <b>${isClean ? "🟢 ЧИСТО" : "🔴 БЛОКПОСТ"}</b> (🕒 ${ptTimeStr})<br>
          «${pt.text || pt.raw_text || ""}»
        </div>
      `);
      timelineLayer.addLayer(marker);
    });

    const countText = document.getElementById("countText");
    if (countText) countText.innerHTML = `<span>⏳ Хроніка: ${activeAtMoment.length}</span>`;
  }

  // 7. Керування режимом Play / Pause
  function togglePlay() {
    isPlaying = !isPlaying;
    playBtn.innerText = isPlaying ? "⏸" : "▶";

    if (isPlaying) {
      playInterval = setInterval(() => {
        let val = parseInt(rangeSlider.value, 10);
        const max = parseInt(rangeSlider.max, 10);
        if (val >= max) val = 0;
        val += 5;
        rangeSlider.value = val;
        renderTimelineAtMinute(val);
      }, 350);
    } else {
      if (playInterval) clearInterval(playInterval);
    }
  }

  function stopPlay() {
    isPlaying = false;
    playBtn.innerText = "▶";
    if (playInterval) clearInterval(playInterval);
  }

  // 8. Вхід та вихід із режиму Хроніки
  async function activateTimeline() {
    isTimelineActive = true;
    toggleBtn.classList.add("active");
    sidePanel.style.display = "flex";

    // Тимчасово ховаємо основний живий шар точок
    if (window.markersLayer && window.map) window.map.removeLayer(window.markersLayer);

    await loadArchiveData();
    updateSliderBounds();
    renderTimelineAtMinute(parseInt(rangeSlider.value, 10));
  }

  function deactivateTimeline() {
    isTimelineActive = false;
    stopPlay();
    toggleBtn.classList.remove("active");
    sidePanel.style.display = "none";
    timeBadge.style.display = "none";

    // Прибираємо шар таймлапсу і повертаємо live-шар
    if (timelineLayer && window.map) {
      window.map.removeLayer(timelineLayer);
      timelineLayer = null;
    }
    if (window.markersLayer && window.map) window.map.addLayer(window.markersLayer);
    if (typeof window.loadPoints === "function") window.loadPoints();
  }

  function updateSliderBounds() {
    const bounds = getDayBounds();
    const totalMinutes = selectedDay === "today"
      ? Math.floor((bounds.end - bounds.start) / 60000)
      : 1440;

    rangeSlider.max = totalMinutes;
    rangeSlider.value = totalMinutes; // За замовчуванням ставимо вгору (на поточний час)
  }

  // Події
  toggleBtn.addEventListener("click", () => {
    if (isTimelineActive) deactivateTimeline();
    else activateTimeline();
  });

  closeBtn.addEventListener("click", deactivateTimeline);
  playBtn.addEventListener("click", togglePlay);

  rangeSlider.addEventListener("input", (e) => {
    stopPlay();
    renderTimelineAtMinute(parseInt(e.target.value, 10));
  });

  btnToday.addEventListener("click", () => {
    if (selectedDay === "today") return;
    selectedDay = "today";
    btnToday.classList.add("active");
    btnYesterday.classList.remove("active");
    stopPlay();
    updateSliderBounds();
    renderTimelineAtMinute(parseInt(rangeSlider.value, 10));
  });

  btnYesterday.addEventListener("click", () => {
    if (selectedDay === "yesterday") return;
    selectedDay = "yesterday";
    btnYesterday.classList.add("active");
    btnToday.classList.remove("active");
    stopPlay();
    updateSliderBounds();
    renderTimelineAtMinute(parseInt(rangeSlider.value, 10));
  });
})();
