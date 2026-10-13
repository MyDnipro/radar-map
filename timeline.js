/**
 * Radar Dnipro — Модуль "Хроніка" (timeline.js)
 * Довгий повзунок (56vh) над "Оновити" + компактне табло часу строго над шкалою
 */
(function() {
  const FB_ARCHIVE_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/stats_archive.json";
  const WINDOW_MS = 40 * 60 * 1000;

  let isActive = false;
  let selectedDay = "today";
  let fullArchiveList = [];
  let timelineLayer = null;

  // 1. Стилі
  const style = document.createElement("style");
  style.textContent = `
    #btnTimelineFloating {
      position: absolute !important;
      bottom: 70px !important;
      right: 15px !important;
      z-index: 2200 !important;
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

    /* Панель повзунка */
    #timelineSliderBox {
      position: absolute !important;
      bottom: 115px !important;
      right: 15px !important;
      width: 48px;
      height: 56vh !important;
      max-height: 520px;
      min-height: 320px;
      background: rgba(15, 23, 42, 0.96);
      backdrop-filter: blur(12px);
      border: 1.5px solid #0284c7;
      border-radius: 14px;
      z-index: 2200 !important;
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: space-between;
      padding: 6px 3px 6px;
      box-shadow: 0 8px 30px rgba(0, 0, 0, 0.75);
      user-select: none;
      box-sizing: border-box;
      touch-action: none !important;
    }

    /* Компактне табло часу: вбудовано в шапку колонки */
    #timelineHeaderBadge {
      width: 42px;
      background: #0b1120;
      border: 1px solid #00f3ff;
      border-radius: 6px;
      padding: 2px 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-shadow: 0 0 8px rgba(0, 243, 255, 0.35);
      margin-bottom: 4px;
      box-sizing: border-box;
    }
    .tl-badge-day {
      font-size: 7.5px;
      font-weight: 800;
      color: #38bdf8;
      line-height: 1;
      text-transform: uppercase;
    }
    .tl-badge-clock {
      font-size: 11px;
      font-weight: 900;
      color: #ffffff;
      font-family: monospace;
      line-height: 1.15;
    }

    .tl-day-btn {
      width: 40px;
      height: 20px;
      border-radius: 5px;
      background: #1e293b;
      border: 1px solid #475569;
      color: #94a3b8;
      font-size: 8.5px;
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
      position: relative;
      margin: 6px 0;
      touch-action: none !important;
    }

    .tl-vertical-range {
      -webkit-appearance: slider-vertical;
      writing-mode: bt-lr;
      width: 12px;
      height: 100%;
      background: #1e293b;
      border-radius: 6px;
      outline: none;
      cursor: pointer;
      accent-color: #00f3ff;
      touch-action: none !important;
    }
  `;
  document.head.appendChild(style);

  // 2. Розмітка
  const toggleBtn = document.createElement("div");
  toggleBtn.id = "btnTimelineFloating";
  toggleBtn.title = "Хроніка (машина часу)";
  toggleBtn.innerText = "⏱️";
  document.body.appendChild(toggleBtn);

  const sliderBox = document.createElement("div");
  sliderBox.id = "timelineSliderBox";
  sliderBox.innerHTML = `
    <!-- Компактний годинник прямо вгорі панелі -->
    <div id="timelineHeaderBadge">
      <span id="tlBadgeDay" class="tl-badge-day">СЬОГ</span>
      <span id="tlBadgeClock" class="tl-badge-clock">00:00</span>
    </div>

    <div style="display:flex; flex-direction:column; gap:3px;">
      <div id="btnTlDayToday" class="tl-day-btn active">СЬОГ</div>
      <div id="btnTlDayYest" class="tl-day-btn">ВЧО</div>
    </div>

    <div class="tl-range-container" id="tlTrackContainer">
      <input type="range" id="tlRangeSlider" class="tl-vertical-range" min="0" max="1440" value="1440" step="5">
    </div>

    <div style="font-size:8.5px; font-weight:800; color:#38bdf8;">00:00</div>
  `;
  document.body.appendChild(sliderBox);

  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(toggleBtn);
    L.DomEvent.disableClickPropagation(sliderBox);
    L.DomEvent.disableScrollPropagation(sliderBox);
  }

  const slider = document.getElementById("tlRangeSlider");
  const trackContainer = document.getElementById("tlTrackContainer");
  const btnToday = document.getElementById("btnTlDayToday");
  const btnYest = document.getElementById("btnTlDayYest");
  const badgeDay = document.getElementById("tlBadgeDay");
  const badgeClock = document.getElementById("tlBadgeClock");

  function parseTimeMs(p) {
    let t = p.time || p.timestamp || p.date || 0;
    if (typeof t === "string") t = Number(t) || Date.parse(t) || 0;
    if (t > 0 && t < 10000000000) t *= 1000;
    return t;
  }

  function extractAllPointsRecursive(obj) {
    let result = [];
    if (!obj || typeof obj !== 'object') return result;
    if (obj.lat !== undefined && obj.lng !== undefined) {
      result.push(obj);
      return result;
    }
    for (const k in obj) {
      if (obj[k] && typeof obj[k] === 'object') {
        result = result.concat(extractAllPointsRecursive(obj[k]));
      }
    }
    return result;
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

  async function loadArchive() {
    fullArchiveList = [];
    if (window.allPoints && Array.isArray(window.allPoints)) {
      window.allPoints.forEach(p => fullArchiveList.push(p));
    }

    try {
      const res = await fetch(`${FB_ARCHIVE_URL}?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        const extracted = extractAllPointsRecursive(data);
        extracted.forEach(p => {
          const ptTime = parseTimeMs(p);
          if (!fullArchiveList.some(x => parseTimeMs(x) === ptTime && Math.abs(x.lat - p.lat) < 0.0001)) {
            fullArchiveList.push(p);
          }
        });
      }
    } catch (e) {}
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
    const map = window.map;
    if (!map) return;

    if (!timelineLayer) {
      timelineLayer = L.layerGroup().addTo(map);
    }
    timelineLayer.clearLayers();

    const bounds = getDayBounds();
    const totalMinutes = selectedDay === "today"
      ? Math.max(5, Math.floor((bounds.end - bounds.start) / 60000))
      : 1440;
    const clamped = Math.max(0, Math.min(minute, totalMinutes));
    const targetTime = bounds.start + clamped * 60000;

    const d = new Date(targetTime);
    const timeStr = String(d.getHours()).padStart(2, '0') + ":" + String(d.getMinutes()).padStart(2, '0');

    badgeDay.innerText = selectedDay === "today" ? "СЬОГ" : "ВЧО";
    badgeClock.innerText = timeStr;

    const sliceStart = targetTime - WINDOW_MS;
    const pointsInWindow = fullArchiveList.filter(p => {
      const t = parseTimeMs(p);
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

      const ptDate = new Date(parseTimeMs(pt));
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

  function handleTouchPosition(clientY) {
    const rect = trackContainer.getBoundingClientRect();
    const totalHeight = rect.height;
    if (totalHeight <= 0) return;

    let ratio = (rect.bottom - clientY) / totalHeight;
    ratio = Math.max(0, Math.min(1, ratio));

    const maxVal = parseInt(slider.max, 10) || 1440;
    const calculatedVal = Math.round((ratio * maxVal) / 5) * 5;

    slider.value = calculatedVal;
    renderSliceAtMinute(calculatedVal);
  }

  trackContainer.addEventListener("touchstart", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.touches && e.touches[0]) handleTouchPosition(e.touches[0].clientY);
  }, { passive: false });

  trackContainer.addEventListener("touchmove", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.touches && e.touches[0]) handleTouchPosition(e.touches[0].clientY);
  }, { passive: false });

  async function openTimeline() {
    isActive = true;
    toggleBtn.classList.add("active");
    sliderBox.style.display = "flex";

    if (window.map) {
      if (window.markersLayer && window.map.hasLayer(window.markersLayer)) {
        window.map.removeLayer(window.markersLayer);
      }
      if (window.trafficLightLayer && window.map.hasLayer(window.trafficLightLayer)) {
        window.map.removeLayer(window.trafficLightLayer);
      }
    }

    await loadArchive();
    updateSliderBounds();
    renderSliceAtMinute(parseInt(slider.value, 10));
  }

  function closeTimeline() {
    isActive = false;
    toggleBtn.classList.remove("active");
    sliderBox.style.display = "none";

    if (timelineLayer && window.map) {
      window.map.removeLayer(timelineLayer);
      timelineLayer = null;
    }
    if (window.map) {
      if (window.markersLayer && !window.map.hasLayer(window.markersLayer)) {
        window.map.addLayer(window.markersLayer);
      }
      if (window.trafficLightLayer && !window.map.hasLayer(window.trafficLightLayer)) {
        window.map.addLayer(window.trafficLightLayer);
      }
    }
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
