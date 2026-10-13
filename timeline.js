/**
 * Radar Dnipro — Модуль "Хроніка" (timeline.js)
 * Вертикальний повзунок праворуч над "Оновити" + великий годинник по центру екрана
 */
(function() {
  const FB_ARCHIVE_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/stats_archive.json";
  const WINDOW_MS = 40 * 60 * 1000;

  let isActive = false;
  let selectedDay = "today"; // "today" | "yesterday"
  let cachedArchive = [];
  let timelineLayer = null;

  // Стилі
  const style = document.createElement("style");
  style.textContent = `
    /* Кнопка ⏱️ над кнопкою Оновити */
    #btnTimelineFloating {
      position: absolute !important;
      bottom: 70px !important;
      right: 15px !important;
      z-index: 1005 !important;
      width: 38px;
      height: 38px;
      box-sizing: border-box;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(10px);
      border: 1.5px solid #38bdf8;
      border-radius: 12px;
      color: #38bdf8;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
      user-select: none;
      transition: all 0.2s ease;
    }
    #btnTimelineFloating:active { transform: scale(0.92); }
    #btnTimelineFloating.active {
      background: #0284c7 !important;
      color: #fff !important;
      border-color: #00f3ff !important;
      box-shadow: 0 0 18px rgba(0, 243, 255, 0.6) !important;
    }

    /* Вертикальна панель із повзунком */
    #timelineSliderBox {
      position: absolute !important;
      bottom: 115px !important;
      right: 15px !important;
      width: 44px;
      height: 250px;
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(12px);
      border: 1.5px solid #0284c7;
      border-radius: 14px;
      z-index: 1005 !important;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      padding: 8px 4px;
      box-shadow: 0 8px 25px rgba(0, 0, 0, 0.7);
      user-select: none;
      box-sizing: border-box;
    }

    .tl-day-btn {
      width: 36px;
      height: 22px;
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
    .tl-day-btn.active {
      background: #0284c7;
      border-color: #38bdf8;
      color: #fff;
    }

    .tl-range-container {
      flex: 1;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px 0;
    }
    .tl-vertical-range {
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

    /* Велике неонове табло часу строго по центру екрана */
    #timelineCenterHud {
      position: absolute !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) !important;
      z-index: 4000 !important;
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(14px);
      border: 2px solid #00f3ff;
      border-radius: 16px;
      padding: 10px 22px;
      color: #ffffff;
      box-shadow: 0 8px 32px rgba(0, 243, 255, 0.45);
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 2px;
      pointer-events: none;
      user-select: none;
      animation: fadeInScale 0.15s ease-out;
    }
    @keyframes fadeInScale {
      from { transform: translate(-50%, -50%) scale(0.9); opacity: 0; }
      to { transform: translate(-50%, -50%) scale(1); opacity: 1; }
    }
    .tl-hud-day { font-size: 11px; font-weight: 800; color: #38bdf8; letter-spacing: 0.5px; text-transform: uppercase; }
    .tl-hud-clock { font-size: 26px; font-weight: 900; color: #ffffff; letter-spacing: 1px; font-family: monospace; }
  `;
  document.head.appendChild(style);

  // Створення елементів
  const toggleBtn = document.createElement("div");
  toggleBtn.id = "btnTimelineFloating";
  toggleBtn.title = "Хроніка (машина часу)";
  toggleBtn.innerText = "⏱️";
  document.body.appendChild(toggleBtn);

  const sliderBox = document.createElement("div");
  sliderBox.id = "timelineSliderBox";
  sliderBox.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:3px;">
      <div id="btnTlDayToday" class="tl-day-btn active">СЬОГ</div>
      <div id="btnTlDayYest" class="tl-day-btn">ВЧО</div>
    </div>
    <div class="tl-range-container">
      <input type="range" id="tlRangeSlider" class="tl-vertical-range" min="0" max="1440" value="1440" step="5">
    </div>
    <div style="font-size:9px; font-weight:800; color:#38bdf8;">00:00</div>
  `;
  document.body.appendChild(sliderBox);

  const centerHud = document.createElement("div");
  centerHud.id = "timelineCenterHud";
  centerHud.innerHTML = `
    <div id="tlHudDay" class="tl-hud-day">СЬОГОДНІ</div>
    <div id="tlHudClock" class="tl-hud-clock">00:00</div>
  `;
  document.body.appendChild(centerHud);

  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(toggleBtn);
    L.DomEvent.disableClickPropagation(sliderBox);
    L.DomEvent.disableScrollPropagation(sliderBox);
  }

  const slider = document.getElementById("tlRangeSlider");
  const btnToday = document.getElementById("btnTlDayToday");
  const btnYest = document.getElementById("btnTlDayYest");
  const hudDay = document.getElementById("tlHudDay");
  const hudClock = document.getElementById("tlHudClock");

  function getCleanTimestamp(p) {
    let t = p.time || p.timestamp || 0;
    if (typeof t === "string") t = Number(t) || Date.parse(t) || 0;
    if (t > 0 && t < 10000000000) t *= 1000;
    return t;
  }

  function getDayBounds() {
    const now = new Date();
    if (selectedDay === "today") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0).getTime();
      return { start, end: now.getTime() };
    } else {
      const y = new Date(now.getTime() - 86400000);
      const start = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 0, 0, 0).getTime();
      const end = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59).getTime();
      return { start, end };
    }
  }

  async function ensureArchiveLoaded() {
    if (cachedArchive.length === 0) {
      try {
        const res = await fetch(`${FB_ARCHIVE_URL}?t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data === "object") {
            cachedArchive = Object.values(data).filter(p => p && p.lat && p.lng);
          }
        }
      } catch (e) {}
    }

    // Підтягуємо точки з поточного списку
    const livePts = (window.allPoints && Array.isArray(window.allPoints)) ? window.allPoints : [];
    livePts.forEach(p => {
      const ptTime = getCleanTimestamp(p);
      if (!cachedArchive.some(x => Math.abs(x.lat - p.lat) < 0.0001 && Math.abs(x.lng - p.lng) < 0.0001 && getCleanTimestamp(x) === ptTime)) {
        cachedArchive.push(p);
      }
    });
  }

  function updateSliderBounds() {
    const bounds = getDayBounds();
    const totalMinutes = selectedDay === "today"
      ? Math.max(5, Math.floor((bounds.end - bounds.start) / 60000))
      : 1440;
    slider.max = totalMinutes;
    slider.value = totalMinutes;
  }

  function renderSliceAtMinute(minute) {
    if (!window.map) return;
    if (!timelineLayer) timelineLayer = L.layerGroup().addTo(window.map);
    timelineLayer.clearLayers();

    const bounds = getDayBounds();
    const totalMinutes = selectedDay === "today"
      ? Math.max(5, Math.floor((bounds.end - bounds.start) / 60000))
      : 1440;
    const clamped = Math.min(minute, totalMinutes);
    const targetTime = bounds.start + clamped * 60000;

    const d = new Date(targetTime);
    const timeStr = String(d.getHours()).padStart(2, '0') + ":" + String(d.getMinutes()).padStart(2, '0');

    hudDay.innerText = selectedDay === "today" ? "СЬОГОДНІ" : "ВЧОРА";
    hudClock.innerText = timeStr;
    centerHud.style.display = "flex";

    const sliceStart = targetTime - WINDOW_MS;
    const pointsInWindow = cachedArchive.filter(p => {
      const t = getCleanTimestamp(p);
      return t >= sliceStart && t <= targetTime;
    });

    pointsInWindow.forEach(pt => {
      const isClean = (typeof window.isCleanPoint === "function") ? window.isCleanPoint(pt) : (pt.color === "green");
      const colorClass = isClean ? "color-green" : "color-red";

      const dotIcon = L.divIcon({
        className: 'custom-dot-marker',
        html: `<div class="radar-circle ${colorClass}"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
      });

      const ptDate = new Date(getCleanTimestamp(pt));
      const ptTimeStr = String(ptDate.getHours()).padStart(2, '0') + ":" + String(ptDate.getMinutes()).padStart(2, '0');

      const marker = L.marker([pt.lat, pt.lng], { icon: dotIcon });
      marker.bindPopup(`
        <div style="font-size:11px; color:#0f172a; padding:3px;">
          <b>${isClean ? "🟢 ЧИСТО" : "🔴 БЛОКПОСТ"}</b> (🕒 ${ptTimeStr})<br>
          «${pt.text || pt.raw_text || ""}»
        </div>
      `);
      timelineLayer.addLayer(marker);
    });

    const countText = document.getElementById("countText");
    if (countText) countText.innerHTML = `<span>⏳ Точок: ${pointsInWindow.length}</span>`;
  }

  async function openTimeline() {
    isActive = true;
    toggleBtn.classList.add("active");
    sliderBox.style.display = "flex";

    if (window.markersLayer && window.map) window.map.removeLayer(window.markersLayer);
    await ensureArchiveLoaded();
    updateSliderBounds();
    renderSliceAtMinute(parseInt(slider.value, 10));
  }

  function closeTimeline() {
    isActive = false;
    toggleBtn.classList.remove("active");
    sliderBox.style.display = "none";
    centerHud.style.display = "none";

    if (timelineLayer && window.map) {
      window.map.removeLayer(timelineLayer);
      timelineLayer = null;
    }
    if (window.markersLayer && window.map) window.map.addLayer(window.markersLayer);
    if (typeof window.loadPoints === "function") window.loadPoints();
    if (typeof window.showToast === "function") window.showToast("🟢 Онлайн: актуальний час");
  }

  toggleBtn.addEventListener("click", () => {
    if (isActive) closeTimeline();
    else openTimeline();
  });

  slider.addEventListener("input", (e) => {
    renderSliceAtMinute(parseInt(e.target.value, 10));
  });

  btnToday.addEventListener("click", () => {
    if (selectedDay === "today") return;
    selectedDay = "today";
    btnToday.classList.add("active");
    btnYest.classList.remove("active");
    updateSliderBounds();
    renderSliceAtMinute(parseInt(slider.value, 10));
  });

  btnYest.addEventListener("click", () => {
    if (selectedDay === "yesterday") return;
    selectedDay = "yesterday";
    btnYest.classList.add("active");
    btnToday.classList.remove("active");
    updateSliderBounds();
    renderSliceAtMinute(parseInt(slider.value, 10));
  });
})();
