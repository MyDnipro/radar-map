/**
 * relocate.js — Модуль перенесення міток, 3-рівневого пошуку, живого калібрування та ПК-мишки (v5.0)
 */

(function () {
  const FIREBASE_POINTS_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/points.json";
  const FIREBASE_KB_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/knowledge_base.json";

  // Підключення CSS-анімації пульсації/миготіння мітки
  if (!document.getElementById("manual-drag-pulse-style")) {
    const style = document.createElement("style");
    style.id = "manual-drag-pulse-style";
    style.innerHTML = `
      @keyframes markerBlinkGlow {
        0% { filter: drop-shadow(0 0 3px #38bdf8) brightness(1); transform: scale(1); }
        50% { filter: drop-shadow(0 0 16px #38bdf8) drop-shadow(0 0 25px #0284c7) brightness(1.7); transform: scale(1.22); }
        100% { filter: drop-shadow(0 0 3px #38bdf8) brightness(1); transform: scale(1); }
      }
      .marker-blinking-active {
        animation: markerBlinkGlow 0.75s infinite ease-in-out !important;
        z-index: 99999 !important;
        cursor: grab !important;
      }
      .marker-blinking-active:active {
        cursor: grabbing !important;
      }
    `;
    document.head.appendChild(style);
  }

  // Кеш точок Firebase
  let cachedRadarPoints = {};
  fetch(FIREBASE_POINTS_URL)
    .then(r => r.json())
    .then(data => { if (data && typeof data === "object") cachedRadarPoints = data; })
    .catch(() => {});

  // =========================================================================
  // 1. ЧИСТЕ ВИТЯГУВАННЯ НАЗВИ ВУЛИЦІ (ЗАХИСТ БАЗИ ЗНАНЬ ВІД СМІТТЯ)
  // =========================================================================
  function extractCleanLocationPhrase(rawText, targetStreetName) {
    if (!rawText) return "";

    let s = rawText
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, " ")
      .replace(/&#\d+;/g, " ")
      .replace(/[,.!?:;\"'«»()–—\/\\]/g, " ")
      .toLowerCase();

    const stopRegexes = [
      /\b(блок\s*пост|блокпост|бп|патруль|патрулі|патрули|патруля|полиция|поліція|менты|мент|менти|тцк|военкомат|воєнкомат)\b/gi,
      /\b(чисто\s*в\s*обе(?:\s*стороны)?|чисто\s*в\s*обе|чисто|вільно|свободно|спокойно|спокійно|зелено|норм|нормально|проезд|проїзд)\b/gi,
      /\b(без\s*ям|ямы|авария|дтп|пробка|тянучка|тягучка)\b/gi,
      /\b(поехали\s*на|поехали|поїхали\s*на|поїхали|уехали|поехали\s*в|стоят(?:\s*на)?|стоят|стоять|тормозят|зупиняють|шмонают|шмонали|работают|працюють)\b/gi,
      /\b(белый\s*бус|синий\s*кадик(?:\s*б\d+)?|синий\s*бус|бусик|бус|кадик|каддик|пирожок|кадиллак|фольксваген|рено|дастер|шкода|тойота|приус)\b/gi,
      /\b(куча\s+ментов|много\s+людей|пешие|пеший|пешком|раздают|выписывают|пишут)\b/gi
    ];

    stopRegexes.forEach(rg => { s = s.replace(rg, " "); });
    s = s.replace(/\s+/g, " ").trim();

    if (targetStreetName) {
      const cleanTarget = targetStreetName.toLowerCase()
        .replace(/(?:вулиця|проспект|просп|провулок|вул|шосе|тупик|узвіз)\.?/gi, "")
        .trim();

      const parts = cleanTarget.split(/\s+/).filter(w => w.length >= 4);

      for (const p of parts) {
        const root = p.slice(0, -2);
        const words = s.split(" ");
        const matchedWord = words.find(w => w.includes(root));

        if (matchedWord) {
          const mIdx = words.indexOf(matchedWord);
          if (mIdx > 0 && ["игоря", "ігоря", "академика", "академіка", "олександра", "маршала", "генерала"].includes(words[mIdx - 1])) {
            return `${words[mIdx - 1]} ${matchedWord}`;
          }
          if (words.length <= 4 && words.length > 1) {
            return s.replace(/^\s*(?:на|по|в|до|от)\s+/i, "").trim();
          }
          return matchedWord;
        }
      }
    }

    s = s.replace(/^\s*(?:на|по|в|до|от|біля|возле|коло)\s+/i, "");
    s = s.replace(/\s+(?:на|по|в|до|от)\$/i, "");
    s = s.replace(/\s+/g, " ").trim();

    return s.length >= 3 ? s : rawText.trim();
  }

  // =========================================================================
  // 2. ДОСТУП ДО ПАМ'ЯТІ ТОПОНІМІВ "А = Б"
  // =========================================================================
  function getMemoryToponymsMap() {
    const memoryKeys = ["radar_toponyms", "toponyms_memory", "radar_memory_toponyms", "radar_ab_rules", "radar_learned_rules"];
    const map = {};

    for (const mk of memoryKeys) {
      try {
        const raw = localStorage.getItem(mk);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach(item => {
            if (item.from && item.to) map[item.from.toLowerCase().trim()] = item.to.trim();
            else if (item.a && item.b) map[item.a.toLowerCase().trim()] = item.b.trim();
            else if (item.key && item.value) map[item.key.toLowerCase().trim()] = item.value.trim();
            else if (item.phrase && item.street) map[item.phrase.toLowerCase().trim()] = item.street.trim();
          });
        } else if (typeof parsed === "object" && parsed !== null) {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string") map[k.toLowerCase().trim()] = v.trim();
            else if (v && typeof v === "object" && (v.to || v.street)) {
              map[k.toLowerCase().trim()] = (v.to || v.street).trim();
            }
          }
        }
      } catch (e) {}
    }
    return map;
  }

  // =========================================================================
  // 3. ТРЬОХРІВНЕВИЙ РОЗУМНИЙ ПОШУК (ПАМ'ЯТЬ + STREETS.JS + ОНЛАЙН)
  // =========================================================================
  let searchDebounceTimer = null;

  window.executeCustomTrain = async function () {
    const inputEl = document.getElementById("trainCustomInput");
    const resultsEl = document.getElementById("trainSearchResults");
    if (!inputEl || !resultsEl) return;

    const q = inputEl.value.trim().toLowerCase();
    if (q.length < 2) {
      resultsEl.style.display = "none";
      return;
    }

    resultsEl.innerHTML = `<div style="padding:8px 10px; font-size:11px; color:#38bdf8;">🔍 Пошук по всіх базах...</div>`;
    resultsEl.style.display = "block";

    const collectedMatches = [];

    // РІВЕНЬ 1: Пам'ять топонімів ("А = Б")
    const memMap = getMemoryToponymsMap();
    let resolvedMemoryTarget = null;

    for (const [fromKey, toVal] of Object.entries(memMap)) {
      if (fromKey === q || q.startsWith(fromKey) || fromKey.startsWith(q)) {
        resolvedMemoryTarget = toVal;
        break;
      }
    }

    if (resolvedMemoryTarget) {
      let matchedCoord = null;
      if (typeof DNIPRO_STREETS_MAP !== "undefined") {
        for (const item of Object.values(DNIPRO_STREETS_MAP)) {
          if (item.name.toLowerCase().includes(resolvedMemoryTarget.toLowerCase())) {
            matchedCoord = item;
            break;
          }
        }
      }
      if (matchedCoord) {
        collectedMatches.push({
          source: "memory",
          name: matchedCoord.name,
          lat: matchedCoord.lat,
          lng: matchedCoord.lng,
          label: `🧠 <b>${matchedCoord.name}</b> <span style="font-size:10px; color:#c084fc;">(з Пам'яті топонімів)</span>`
        });
      }
    }

    // РІВЕНЬ 2: Локальний довідник streets.js
    if (typeof DNIPRO_STREETS_MAP !== "undefined") {
      for (const [key, item] of Object.entries(DNIPRO_STREETS_MAP)) {
        const matchesQuery = key.includes(q) || (item.old && item.old.toLowerCase().includes(q)) || item.name.toLowerCase().includes(q);
        const matchesMemory = resolvedMemoryTarget && item.name.toLowerCase().includes(resolvedMemoryTarget.toLowerCase());

        if (matchesQuery || matchesMemory) {
          if (!collectedMatches.some(m => m.name === item.name)) {
            collectedMatches.push({
              source: "local",
              name: item.name,
              lat: item.lat,
              lng: item.lng,
              old: item.old,
              label: `📍 <b>${item.name}</b> ${item.old ? `<span style="font-size:10px; color:#94a3b8;">(\${item.old})</span>` : ""}`
            });
          }
        }
      }
    }

    // РІВЕНЬ 3: Онлайн геокодер (Photon / OSM)
    if (collectedMatches.length < 3 && q.length >= 3) {
      try {
        const onlineQuery = `${q} Дніпро`;
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 2000);
        const geoRes = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(onlineQuery)}&lat=48.46&lon=35.04&limit=4`, { signal: ctrl.signal });
        clearTimeout(timeout);

        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData && geoData.features) {
            geoData.features.forEach(f => {
              const p = f.properties || {};
              const coords = f.geometry?.coordinates;
              if (coords && coords.length >= 2) {
                const lng = coords[0], lat = coords[1];
                if (lat >= 48.30 && lat <= 48.60 && lng >= 34.80 && lng <= 35.30) {
                  const placeName = [p.name, p.street].filter(Boolean).join(", ") || p.city || q;
                  if (!collectedMatches.some(m => m.name.toLowerCase() === placeName.toLowerCase())) {
                    collectedMatches.push({
                      source: "online",
                      name: placeName,
                      lat: lat,
                      lng: lng,
                      label: `🌐 <b>${placeName}</b> <span style="font-size:10px; color:#38bdf8;">(Онлайн-карта)</span>`
                    });
                  }
                }
              }
            });
          }
        }
      } catch (e) {}
    }

    resultsEl.innerHTML = "";
    if (collectedMatches.length === 0) {
      resultsEl.innerHTML = `<div style="padding:8px 10px; font-size:11px; color:#94a3b8;">Вулицю не знайдено. Спробуйте іншу назву.</div>`;
      resultsEl.style.display = "block";
      return;
    }

    collectedMatches.slice(0, 8).forEach(item => {
      const row = document.createElement("div");
      row.className = "search-item";
      row.innerHTML = item.label;
      row.onclick = () => selectStreetForRelocation(item);
      resultsEl.appendChild(row);
    });

    resultsEl.style.display = "block";
  };

  const trainInput = document.getElementById("trainCustomInput");
  if (trainInput) {
    trainInput.addEventListener("input", () => {
      clearTimeout(searchDebounceTimer);
      if (trainInput.value.trim().length >= 2) {
        searchDebounceTimer = setTimeout(window.executeCustomTrain, 220);
      } else {
        const res = document.getElementById("trainSearchResults");
        if (res) res.style.display = "none";
      }
    });
  }

  // =========================================================================
  // 4. ПК-КЕРУВАННЯ МИШКОЮ (ПРАВИЙ КЛІК ТА УТРИМАННЯ ЛКМ ДЛЯ МЕНЮ)
  // =========================================================================
  function resolvePointForMarker(marker) {
    if (!marker) return null;
    if (marker.pointData && typeof marker.pointData === "object") return marker.pointData;
    if (marker._point && typeof marker._point === "object") return marker._point;
    if (marker.options && marker.options.pointData) return marker.options.pointData;

    let fbKey = null;
    if (window.markersMap) {
      for (const [k, m] of Object.entries(window.markersMap)) {
        if (m === marker) { fbKey = k; break; }
      }
    }

    if (fbKey && cachedRadarPoints[fbKey]) {
      const pt = { ...cachedRadarPoints[fbKey], _fbKey: fbKey };
      marker.pointData = pt;
      return pt;
    }

    if (marker.getLatLng) {
      const ll = marker.getLatLng();
      const synthetic = {
        lat: Number(ll.lat.toFixed(5)),
        lng: Number(ll.lng.toFixed(5)),
        text: "Повідомлення на карті",
        raw_text: "Повідомлення на карті",
        _fbKey: fbKey || ""
      };
      marker.pointData = synthetic;
      return synthetic;
    }
    return null;
  }

  window.triggerMarkerContextMenu = function (point, marker) {
    const finalPoint = point || resolvePointForMarker(marker);
    if (!finalPoint) return;

    window.activeActionPoint = finalPoint;
    window.activeActionMarker = marker;

    if (typeof window.openActionSheet === "function") {
      window.openActionSheet(finalPoint, marker);
    } else if (typeof window.openTrainingModal === "function") {
      window.openTrainingModal(finalPoint, marker);
    }
  };

  // Глобальний захват миші на ПК для виклику контекстного меню
  document.addEventListener("contextmenu", function (e) {
    const markerTarget = e.target.closest(".leaflet-marker-icon, .leaflet-interactive");
    if (markerTarget && window.map) {
      e.preventDefault();
      e.stopPropagation();

      let matchedMarker = null;
      window.map.eachLayer(l => {
        if (matchedMarker) return;
        const el = l.getElement ? l.getElement() : (l._icon || l._path);
        if (el && (el === markerTarget || el.contains(markerTarget) || markerTarget.contains(el))) {
          matchedMarker = l;
        }
      });

      if (matchedMarker) {
        const pt = resolvePointForMarker(matchedMarker);
        window.triggerMarkerContextMenu(pt, matchedMarker);
      }
    }
  }, true);

  // Довге затискання лівої кнопки мишки на ПК (0.4с)
  let desktopMousedownTimer = null;
  let mouseStartX = 0, mouseStartY = 0;

  document.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    const markerTarget = e.target.closest(".leaflet-marker-icon, .leaflet-interactive");
    if (markerTarget && window.map) {
      mouseStartX = e.clientX;
      mouseStartY = e.clientY;

      desktopMousedownTimer = setTimeout(() => {
        let matchedMarker = null;
        window.map.eachLayer(l => {
          if (matchedMarker) return;
          const el = l.getElement ? l.getElement() : (l._icon || l._path);
          if (el && (el === markerTarget || el.contains(markerTarget) || markerTarget.contains(el))) {
            matchedMarker = l;
          }
        });

        if (matchedMarker) {
          if (matchedMarker.closePopup) matchedMarker.closePopup();
          const pt = resolvePointForMarker(matchedMarker);
          window.triggerMarkerContextMenu(pt, matchedMarker);
        }
      }, 400);
    }
  }, true);

  document.addEventListener("mousemove", function (e) {
    if (desktopMousedownTimer && (Math.abs(e.clientX - mouseStartX) > 6 || Math.abs(e.clientY - mouseStartY) > 6)) {
      clearTimeout(desktopMousedownTimer);
      desktopMousedownTimer = null;
    }
  }, true);

  document.addEventListener("mouseup", function () {
    if (desktopMousedownTimer) {
      clearTimeout(desktopMousedownTimer);
      desktopMousedownTimer = null;
    }
  }, true);

  // =========================================================================
  // 5. СПРАВЖНІЙ РУЧНИЙ РЕЖИМ (МИГОТІННЯ + БАГАТОРАЗОВИЙ РУХ + ПЛАВАЮЧА ПАНЕЛЬ)
  // =========================================================================
  let manualMovingMarker = null;
  let manualOriginalLatLng = null;
  let manualPointObj = null;

  window.startDirectManualDrag = function (pointOrFbKey, optionalMarker) {
    let p = null;
    let m = optionalMarker;

    if (typeof pointOrFbKey === "object" && pointOrFbKey !== null) {
      p = pointOrFbKey;
    } else if (typeof window.activeActionPoint === "object") {
      p = window.activeActionPoint;
      m = window.activeActionMarker;
    }

    if (!m && p && window.markersMap && p._fbKey) {
      m = window.markersMap[p._fbKey];
    }

    if (!m && window.map) {
      window.map.eachLayer(l => {
        if (l instanceof L.Marker && l.getLatLng && p) {
          const ll = l.getLatLng();
          if (Math.abs(ll.lat - p.lat) < 0.0001 && Math.abs(ll.lng - p.lng) < 0.0001) {
            m = l;
          }
        }
      });
    }

    if (!m) {
      if (typeof showToast === "function") showToast("⚠️ Маркер не знайдено для перенесення");
      return;
    }

    manualMovingMarker = m;
    manualPointObj = p;
    manualOriginalLatLng = m.getLatLng();

    m.closePopup();

    // 1. Вмикаємо перетягування
    if (m.dragging) m.dragging.enable();

    // 2. Вмикаємо активне миготіння
    const el = m.getElement ? m.getElement() : m._icon;
    if (el) el.classList.add("marker-blinking-active");

    // 3. Відображаємо плаваючу панель підтвердження
    showManualDragFloatingBar(m.getLatLng().lat, m.getLatLng().lng);

    // 4. Оновлення координат при кожному русі (без закриття чи блокувань!)
    m.on("drag", function () {
      const cur = m.getLatLng();
      updateManualFloatingCoords(cur.lat, cur.lng);
    });

    m.on("dragend", function () {
      const cur = m.getLatLng();
      updateManualFloatingCoords(cur.lat, cur.lng);
    });

    if (typeof showToast === "function") {
      showToast("🎯 Перетягуйте мітку куди завгодно, потім натисніть Підтвердити", 3500);
    }
  };

  // Плаваюча панель внизу екрана
  function showManualDragFloatingBar(lat, lng) {
    let bar = document.getElementById("manualDragFloatingBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "manualDragFloatingBar";
      bar.style.cssText = `
        position: fixed;
        bottom: 25px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 99999;
        background: #0b1120;
        border: 2px solid #38bdf8;
        border-radius: 14px;
        padding: 10px 14px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.85);
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 310px;
        max-width: 92vw;
      `;

      bar.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="font-size:12px; font-weight:900; color:#38bdf8; display:flex; align-items:center; gap:6px;">
            <span>🎯 Ручне перенесення</span>
            <span style="font-size:10px; color:#94a3b8; font-weight:normal;">(рухайте вільно)</span>
          </div>
          <div id="manualDragLiveCoords" style="font-family:monospace; font-size:11px; color:#38bdf8; background:#1e293b; padding:2px 6px; border-radius:5px;">
            ${lat.toFixed(5)}, ${lng.toFixed(5)}
          </div>
        </div>
        <div style="display:flex; gap:6px;">
          <button id="btnCopyLiveCoords" style="flex:1; background:#1e293b; border:1px solid #0284c7; color:#38bdf8; font-size:11px; font-weight:800; padding:7px 4px; border-radius:7px; cursor:pointer;">
            📋 Скопіювати
          </button>
          <button id="btnConfirmManualDrag" style="flex:1.2; background:#0284c7; border:none; color:#fff; font-size:12px; font-weight:900; padding:7px 4px; border-radius:7px; cursor:pointer;">
            💾 Підтвердити
          </button>
          <button id="btnCancelManualDrag" style="flex:1; background:#334155; border:none; color:#94a3b8; font-size:11px; font-weight:700; padding:7px 4px; border-radius:7px; cursor:pointer;">
            ↩️ Скасувати
          </button>
        </div>
      `;
      document.body.appendChild(bar);

      document.getElementById("btnCopyLiveCoords").onclick = () => {
        if (!manualMovingMarker) return;
        const cur = manualMovingMarker.getLatLng();
        const code = `lat: ${Number(cur.lat.toFixed(5))}, lng: ${Number(cur.lng.toFixed(5))}`;
        copyToClipboard(code);
        if (typeof showToast === "function") showToast(`📋 Скопійовано: ${code}`);
      };

      document.getElementById("btnConfirmManualDrag").onclick = finishManualDragSuccess;
      document.getElementById("btnCancelManualDrag").onclick = cancelManualDragMode;
    } else {
      updateManualFloatingCoords(lat, lng);
      bar.style.display = "flex";
    }
  }

  function updateManualFloatingCoords(lat, lng) {
    const el = document.getElementById("manualDragLiveCoords");
    if (el) el.innerText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }

  function closeManualFloatingBar() {
    const bar = document.getElementById("manualDragFloatingBar");
    if (bar) bar.style.display = "none";
  }

  function cancelManualDragMode() {
    closeManualFloatingBar();

    if (manualMovingMarker) {
      if (manualOriginalLatLng) manualMovingMarker.setLatLng(manualOriginalLatLng);
      if (manualMovingMarker.dragging) manualMovingMarker.dragging.disable();

      const el = manualMovingMarker.getElement ? manualMovingMarker.getElement() : manualMovingMarker._icon;
      if (el) el.classList.remove("marker-blinking-active");

      manualMovingMarker.off("drag");
      manualMovingMarker.off("dragend");
    }

    manualMovingMarker = null;
    manualPointObj = null;
    if (typeof showToast === "function") showToast("↩️ Перенесення скасовано");
  }

  async function finishManualDragSuccess() {
    if (!manualMovingMarker) return;

    const finalPos = manualMovingMarker.getLatLng();
    const lat = Number(finalPos.lat.toFixed(5));
    const lng = Number(finalPos.lng.toFixed(5));
    const p = manualPointObj;

    closeManualFloatingBar();

    // Вимикаємо перетягування та миготіння
    if (manualMovingMarker.dragging) manualMovingMarker.dragging.disable();
    const el = manualMovingMarker.getElement ? manualMovingMarker.getElement() : manualMovingMarker._icon;
    if (el) el.classList.remove("marker-blinking-active");

    manualMovingMarker.off("drag");
    manualMovingMarker.off("dragend");

    if (p) {
      p.lat = lat;
      p.lng = lng;
      p.geo_refined = true;
      p.needs_training = false;

      if (p._fbKey) {
        fetch(FIREBASE_POINTS_URL.replace(".json", `/${p._fbKey}.json`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat: lat, lng: lng, geo_refined: true, needs_training: false })
        }).catch(() => {});
      }
    }

    manualMovingMarker = null;
    manualPointObj = null;

    if (typeof showToast === "function") showToast(`✅ Точку зафіксовано на (${lat.toFixed(4)}, ${lng.toFixed(4)})`);
    if (typeof renderMarkers === "function") renderMarkers();
    if (typeof renderTrafficLights === "function") renderTrafficLights();

    // Відкриваємо модалку калібрування з готовими кнопками копіювання для streets.js
    showCoordinatesCopyModal(lat, lng);
  }

  // Вікно калібрування координат для streets.js
  function showCoordinatesCopyModal(lat, lng) {
    let modal = document.getElementById("coordsCalibrationModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "coordsCalibrationModal";
      modal.className = "action-sheet-backdrop";
      modal.style.zIndex = "5000";
      modal.onclick = (e) => {
        if (e.target.id === "coordsCalibrationModal") modal.style.display = "none";
      };

      modal.innerHTML = `
        <div class="action-sheet-card" style="padding:16px; display:flex; flex-direction:column; gap:10px; max-width:340px; margin:auto;" onclick="event.stopPropagation()">
          <div style="font-size:14px; font-weight:900; color:#38bdf8; display:flex; justify-content:space-between; align-items:center;">
            <span>📍 Точні координати мітки</span>
            <span style="cursor:pointer; font-size:16px; color:#94a3b8;" onclick="document.getElementById('coordsCalibrationModal').style.display='none'">✕</span>
          </div>

          <div style="font-size:11px; color:#94a3b8; line-height:1.4;">
            Мітку встановлено! Скопіюйте точні координати для оновлення <b>streets.js</b>:
          </div>

          <div id="calibCoordsDisplay" style="background:#0b1120; border:1px solid #1e293b; padding:10px; border-radius:8px; font-family:monospace; font-size:12px; color:#38bdf8; text-align:center; user-select:all;">
            lat: ${lat.toFixed(5)}, lng: ${lng.toFixed(5)}
          </div>

          <div style="display:flex; flex-direction:column; gap:6px;">
            <button id="btnCopyStreetsFormat" style="background:#1e293b; border:1px solid #0284c7; color:#38bdf8; padding:8px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer;">
              📋 Скопіювати для streets.js
            </button>
            <button id="btnCopyRawDigits" style="background:#1e293b; border:1px solid #334155; color:#f1f5f9; padding:7px; border-radius:6px; font-size:10.5px; font-weight:700; cursor:pointer;">
              📋 Скопіювати тільки цифри (${lat.toFixed(4)}, ${lng.toFixed(4)})
            </button>
          </div>

          <button onclick="document.getElementById('coordsCalibrationModal').style.display='none'" style="background:#0284c7; color:#fff; border:none; padding:9px; border-radius:6px; font-size:12px; font-weight:800; cursor:pointer; margin-top:4px;">
            Добре, закрити
          </button>
        </div>
      `;
      document.body.appendChild(modal);
    } else {
      const disp = document.getElementById("calibCoordsDisplay");
      if (disp) disp.innerText = `lat: ${lat.toFixed(5)}, lng: ${lng.toFixed(5)}`;
    }

    const streetsCode = `lat: ${Number(lat.toFixed(5))}, lng: ${Number(lng.toFixed(5))}`;
    const rawCode = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

    document.getElementById("btnCopyStreetsFormat").onclick = () => {
      copyToClipboard(streetsCode);
      if (typeof showToast === "function") showToast(`📋 Скопійовано: ${streetsCode}`);
    };

    document.getElementById("btnCopyRawDigits").onclick = () => {
      copyToClipboard(rawCode);
      if (typeof showToast === "function") showToast(`📋 Скопійовано: ${rawCode}`);
    };

    modal.style.display = "flex";
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
  }

  // =========================================================================
  // 6. МОДАЛКА ПЕРЕНЕСЕННЯ ЗА АДРЕСОЮ
  // =========================================================================
  window.openTrainingModal = function (point, marker) {
    window.activeActionPoint = point;
    window.activeActionMarker = marker;

    const modal = document.getElementById("trainModal");
    const quoteEl = document.getElementById("trainTextQuote");
    const inputEl = document.getElementById("trainCustomInput");
    const resultsEl = document.getElementById("trainSearchResults");

    if (!modal) return;

    const rawText = point.text || point.raw_text || "";
    if (quoteEl) quoteEl.innerHTML = `«${rawText}»`;
    if (inputEl) {
      inputEl.value = "";
      setTimeout(() => inputEl.focus(), 150);
    }
    if (resultsEl) {
      resultsEl.innerHTML = "";
      resultsEl.style.display = "none";
    }

    modal.style.display = "flex";
  };

  window.closeTrainModal = function (e) {
    if (e && e.target && e.target.id !== "trainModal" && !e.target.closest(".train-modal-card")) return;
    const modal = document.getElementById("trainModal");
    if (modal) modal.style.display = "none";
  };

  function selectStreetForRelocation(streetObj) {
    const p = window.activeActionPoint;
    if (!p) return;

    window.closeTrainModal();

    window.pendingRelocation = {
      point: p,
      street: streetObj,
      targetLat: streetObj.lat,
      targetLng: streetObj.lng,
      streetName: streetObj.name
    };

    const confirmModal = document.getElementById("confirmMoveModal");
    const nameEl = document.getElementById("confirmStreetName");
    if (nameEl) nameEl.innerText = `${streetObj.name}`;
    if (confirmModal) confirmModal.style.display = "flex";

    if (window.map) {
      window.map.flyTo([streetObj.lat, streetObj.lng], 15.5, { animate: true, duration: 0.8 });
    }
  }

  window.finalizeMoveConfirm = async function (isApproved) {
    const modal = document.getElementById("confirmMoveModal");
    if (modal) modal.style.display = "none";

    const pr = window.pendingRelocation;
    if (!pr) return;

    if (!isApproved) {
      window.pendingRelocation = null;
      if (typeof showToast === "function") showToast("↩️ Перенесення скасовано");
      return;
    }

    const p = pr.point;
    const rawText = p.text || p.raw_text || "";
    const cleanRulePhrase = extractCleanLocationPhrase(rawText, pr.streetName);

    p.lat = Number(pr.targetLat.toFixed(5));
    p.lng = Number(pr.targetLng.toFixed(5));
    p.address = pr.streetName;
    p.needs_training = false;
    p.geo_refined = true;

    if (p._fbKey) {
      fetch(FIREBASE_POINTS_URL.replace(".json", `/${p._fbKey}.json`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: p.lat,
          lng: p.lng,
          address: p.address,
          needs_training: false,
          geo_refined: true
        })
      }).catch(() => {});
    }

    if (cleanRulePhrase && cleanRulePhrase.length >= 3) {
      saveRuleToKnowledgeBase(cleanRulePhrase, pr.streetName, p.lat, p.lng);
    }

    window.pendingRelocation = null;
    if (typeof showToast === "function") showToast(`✅ Закріплено: «${cleanRulePhrase}» ➔ ${pr.streetName}`);
    if (typeof renderMarkers === "function") renderMarkers();
    if (typeof renderTrafficLights === "function") renderTrafficLights();
    if (typeof updateRouteStatus === "function") updateRouteStatus();
  };

  window.finalizeMoveManual = function () {
    const modal = document.getElementById("confirmMoveModal");
    if (modal) modal.style.display = "none";

    const pr = window.pendingRelocation;
    if (!pr || !pr.point) return;

    window.startDirectManualDrag(pr.point, window.activeActionMarker);
    window.pendingRelocation = null;
  };

  async function saveRuleToKnowledgeBase(phrase, streetName, lat, lng) {
    const ruleObj = {
      phrase: phrase,
      street: streetName,
      lat: lat,
      lng: lng,
      created_at: Date.now()
    };

    try {
      let rules = JSON.parse(localStorage.getItem("radar_learned_rules") || "[]");
      rules = rules.filter(r => r.phrase !== phrase);
      rules.push(ruleObj);
      localStorage.setItem("radar_learned_rules", JSON.stringify(rules));
    } catch (e) {}

    try {
      await fetch(FIREBASE_KB_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruleObj)
      });
    } catch (e) {}
  }

  // =========================================================================
  // 7. ЖУРНАЛ ПРИВ'ЯЗОК ІІ ТА РУЧНЕ ОЧИЩЕННЯ
  // =========================================================================
  window.cleanAllExistingRules = async function () {
    if (!confirm("Очистити всі наявні правила в базі від сміття (смайлів, описів авто та слів 'блокпост/чисто')?")) {
      return;
    }

    if (typeof showToast === "function") showToast("⏳ Очищення бази знань...");

    try {
      const res = await fetch(`${FIREBASE_KB_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error("Помилка підключення");
      const data = await res.json();
      if (!data) return;

      let cleanedCount = 0;
      const updatedLocalRules = [];

      for (const [key, item] of Object.entries(data)) {
        if (!item) continue;
        const oldPhrase = item.phrase || item.text || item.raw_text || "";
        const targetStreet = item.street || item.name || item.address || "";
        const cleanP = extractCleanLocationPhrase(oldPhrase, targetStreet);

        if (cleanP && cleanP !== oldPhrase) {
          item.phrase = cleanP;
          cleanedCount++;
          fetch(`https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/knowledge_base/${key}.json`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phrase: cleanP })
          }).catch(() => {});
        }
        updatedLocalRules.push(item);
      }

      localStorage.setItem("radar_learned_rules", JSON.stringify(updatedLocalRules));

      if (typeof showToast === "function") {
        showToast(`🧹 Очищено правил: ${cleanedCount}!`);
      }
      renderBindingJournal();
    } catch (e) {
      alert("Помилка очищення: " + e.message);
    }
  };

  window.openBindingJournal = async function () {
    let journalModal = document.getElementById("bindingJournalModal");
    if (!journalModal) {
      journalModal = document.createElement("div");
      journalModal.id = "bindingJournalModal";
      journalModal.className = "action-sheet-backdrop";
      journalModal.style.zIndex = "4000";
      journalModal.onclick = (e) => {
        if (e.target.id === "bindingJournalModal") journalModal.style.display = "none";
      };

      journalModal.innerHTML = `
        <div class="action-sheet-card" style="max-height:85vh; display:flex; flex-direction:column; padding:16px;" onclick="event.stopPropagation()">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #334155; padding-bottom:8px;">
            <div style="font-size:14px; font-weight:900; color:#38bdf8;">📚 Журнал прив'язок ІІ</div>
            <div style="display:flex; gap:8px; align-items:center;">
              <button onclick="window.cleanAllExistingRules()" style="background:#1e293b; border:1px solid #0284c7; color:#38bdf8; font-size:10px; font-weight:800; padding:5px 8px; border-radius:6px; cursor:pointer;" title="Очистити всі записи від сміття">🧹 Очистити від сміття</button>
              <span style="cursor:pointer; font-size:16px; color:#94a3b8; font-weight:800; padding:0 4px;" onclick="document.getElementById('bindingJournalModal').style.display='none'">✕</span>
            </div>
          </div>
          <div id="journalItemsList" style="overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:8px;">
            <div style="text-align:center; padding:20px; color:#94a3b8; font-size:11px;">Завантаження бази знань...</div>
          </div>
        </div>
      `;
      document.body.appendChild(journalModal);
    }

    journalModal.style.display = "flex";
    renderBindingJournal();
  };

  async function renderBindingJournal() {
    const listEl = document.getElementById("journalItemsList");
    if (!listEl) return;

    try {
      const res = await fetch(`${FIREBASE_KB_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error();
      const data = await res.json();

      if (!data || Object.keys(data).length === 0) {
        listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8; font-size:11px;">База знань порожня.</div>`;
        return;
      }

      const entries = Object.entries(data).reverse();
      let html = "";

      entries.forEach(([key, item]) => {
        if (!item) return;
        const phrase = item.phrase || item.text || item.raw_text || "—";
        const street = item.street || item.name || item.address || "Невідомо";
        const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' }) : "18.10.2026";
        const timeStr = item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "12:00";
        const coordsStr = item.lat && item.lng ? `(${Number(item.lat).toFixed(4)}, ${Number(item.lng).toFixed(4)})` : "";

        html += `
          <div style="background:#0b1120; border:1px solid #1e293b; border-radius:10px; padding:10px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <div style="flex:1; min-width:0;">
              <div style="font-size:11.5px; font-weight:800; color:#f1f5f9; line-height:1.4;">
                «<span style="color:#f87171;">${phrase}</span>» ➔ <span style="color:#38bdf8;">${street}</span>
              </div>
              <div style="font-size:9.5px; color:#64748b; margin-top:4px;">
                📅 ${dateStr} 🕒 ${timeStr} ${coordsStr}
              </div>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              <button onclick="editJournalRule('${key}', '${encodeURIComponent(phrase)}')" style="background:#0284c7; border:none; color:#fff; width:28px; height:28px; border-radius:6px; cursor:pointer; font-size:12px; display:flex; align-items:center; justify-content:center;" title="Редагувати фразу">✏️</button>
              <button onclick="deleteJournalRule('${key}')" style="background:#7f1d1d; border:none; color:#fca5a5; width:28px; height:28px; border-radius:6px; cursor:pointer; font-size:12px; display:flex; align-items:center; justify-content:center;" title="Видалити правило">🗑️</button>
            </div>
          </div>
        `;
      });

      listEl.innerHTML = html;
    } catch (e) {
      listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#ef4444; font-size:11px;">Помилка зв'язку з базою знань.</div>`;
    }
  }

  window.deleteJournalRule = async function (key) {
    if (!confirm("Видалити це правило прив'язки назавжди?")) return;
    try {
      await fetch(`https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/knowledge_base/${key}.json`, { method: "DELETE" });
      if (typeof showToast === "function") showToast("🗑️ Правило видалено");
      renderBindingJournal();
    } catch (e) {
      alert("Помилка видалення: " + e.message);
    }
  };

  window.editJournalRule = async function (key, encodedOldPhrase) {
    const oldPhrase = decodeURIComponent(encodedOldPhrase);
    const newPhrase = prompt("Введіть точну ключову фразу для правила:", oldPhrase);
    if (!newPhrase || newPhrase.trim() === oldPhrase) return;

    try {
      await fetch(`https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/knowledge_base/${key}.json`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase: newPhrase.trim().toLowerCase() })
      });
      if (typeof showToast === "function") showToast("✏️ Правило оновлено");
      renderBindingJournal();
    } catch (e) {
      alert("Помилка збереження: " + e.message);
    }
  };

})();
