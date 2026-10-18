/**
 * relocate.js — Модуль перенесення міток (за адресою та вручну) та калібрування вулиць v7.0
 * Повне відновлення: Пошук за адресою + Ручне перетягування + Безпечні ключі Firebase
 */

(function () {
  const FIREBASE_POINTS_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/points.json";
  const FIREBASE_CUSTOM_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/custom_streets.json";
  const FIREBASE_OVERRIDES_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/street_overrides.json";

  // =========================================================================
  // 1. БЕЗПЕЧНІ КЛЮЧІ ДЛЯ FIREBASE (ФІЛЬТРУЄМО СЛЕШІ, КРАПКИ, ДУЖКИ)
  // =========================================================================
  function toSafeFirebaseKey(str) {
    if (!str) return "key_" + Date.now();
    return encodeURIComponent(
      str.trim()
        .toLowerCase()
        .replace(/[\.\/#\$\[\]]/g, "_")
        .replace(/\s+/g, "_")
    ).replace(/%/g, "_").slice(0, 80);
  }

  // =========================================================================
  // 2. ДОВІДНИК ПЕРЕЙМЕНУВАНЬ ДЛЯ ПОПАПІВ
  // =========================================================================
  window.getStreetRenameNote = function (rawText) {
    if (!rawText || typeof DNIPRO_STREETS_MAP === "undefined") return "";
    const t = rawText.toLowerCase().replace(/[\r\n,.-]+/g, " ");

    let matchedItem = null;
    let maxMatchLen = 0;

    for (const [key, item] of Object.entries(DNIPRO_STREETS_MAP)) {
      if (!item || !item.name) continue;
      const cleanName = item.name.toLowerCase().replace(/(?:вулиця|проспект|просп|провулок|вул|шосе|тупик|узвіз)\.?/gi, "").trim();
      const cleanOld = (item.old || "").toLowerCase().replace(/(?:вулиця|проспект|просп|провулок|вул|шосе|тупик|узвіз)\.?/gi, "").trim();

      const matchNew = cleanName.length >= 3 && t.includes(cleanName);
      const matchOld = cleanOld.length >= 3 && t.includes(cleanOld);
      const matchKey = key.length >= 3 && t.includes(key);

      if (matchNew || matchOld || matchKey) {
        const matchLen = Math.max(
          matchNew ? cleanName.length : 0,
          matchOld ? cleanOld.length : 0,
          matchKey ? key.length : 0
        );
        if (matchLen > maxMatchLen) {
          maxMatchLen = matchLen;
          matchedItem = item;
        }
      }
    }

    if (!matchedItem) return "";

    if (matchedItem.old) {
      return `📍 Раніше: ${matchedItem.old}`;
    } else if (
      matchedItem.type === "landmark" ||
      matchedItem.landmark ||
      matchedItem.is_landmark ||
      /міст|мост|завод|вокзал|тц|трц|ринок|парк|озерк|кар'єр|станція/i.test(matchedItem.name)
    ) {
      return `📍 Місцевий орієнтир`;
    } else {
      return `📍 Не перейменовувалась`;
    }
  };

  // =========================================================================
  // 3. СИНХРОНІЗАЦІЯ ЗСУНУТИХ ВУЛИЦЬ (STREET OVERRIDES)
  // =========================================================================
  function backupOriginalStreets() {
    if (typeof DNIPRO_STREETS_MAP === "undefined") return;
    for (const item of Object.values(DNIPRO_STREETS_MAP)) {
      if (item && item.lat && item.lng && item._origLat === undefined) {
        item._origLat = item.lat;
        item._origLng = item.lng;
      }
    }
  }

  window.syncStreetOverrides = async function () {
    backupOriginalStreets();
    try {
      const res = await fetch(`${FIREBASE_OVERRIDES_URL}?t=${Date.now()}`);
      if (!res.ok) return;
      const data = await res.json();
      if (!data || typeof data !== "object") return;

      localStorage.setItem("radar_street_overrides", JSON.stringify(data));

      if (typeof DNIPRO_STREETS_MAP !== "undefined") {
        for (const record of Object.values(data)) {
          if (!record || !record.street || !record.lat || !record.lng) continue;
          const targetName = record.street.toLowerCase().trim();

          for (const item of Object.values(DNIPRO_STREETS_MAP)) {
            if (item && item.name && item.name.toLowerCase().trim() === targetName) {
              item.lat = Number(record.lat);
              item.lng = Number(record.lng);
              item._isOverridden = true;
            }
          }
        }
      }
    } catch (e) {}
  };

  setTimeout(window.syncStreetOverrides, 300);
  setInterval(window.syncStreetOverrides, 30000);

  async function saveStreetCoordinateOverride(streetName, lat, lng) {
    if (!streetName || !lat || !lng) return;
    backupOriginalStreets();

    const cleanName = streetName.replace(/[\r\n]+/g, " ").trim();
    const safeKey = toSafeFirebaseKey(cleanName);
    const payload = {
      street: cleanName,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      updated_at: Date.now()
    };

    if (typeof DNIPRO_STREETS_MAP !== "undefined") {
      for (const item of Object.values(DNIPRO_STREETS_MAP)) {
        if (item && item.name && item.name.toLowerCase().trim() === cleanName.toLowerCase().trim()) {
          item.lat = payload.lat;
          item.lng = payload.lng;
          item._isOverridden = true;
        }
      }
    }

    try {
      let localOverrides = JSON.parse(localStorage.getItem("radar_street_overrides") || "{}");
      localOverrides[safeKey] = payload;
      localStorage.setItem("radar_street_overrides", JSON.stringify(localOverrides));
    } catch (e) {}

    try {
      await fetch(FIREBASE_OVERRIDES_URL.replace(".json", `/${safeKey}.json`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (e) {}
  }

  function findNearestStreet(lat, lng, maxDistMeters) {
    if (typeof DNIPRO_STREETS_MAP === "undefined" || !window.L) return null;
    const pos = L.latLng(lat, lng);
    let best = null;
    let minDist = Infinity;

    for (const item of Object.values(DNIPRO_STREETS_MAP)) {
      if (!item || !item.name || !item.lat || !item.lng) continue;
      const d = pos.distanceTo([item.lat, item.lng]);
      if (d < minDist) {
        minDist = d;
        best = item.name;
      }
    }
    if (minDist <= (maxDistMeters || 120)) return best;
    return null;
  }

  function detectStreetForPoint(point) {
    if (!point) return null;
    if (point.address &&
        point.address !== "Встановлено користувачем" &&
        point.address !== "Мітка на карті" &&
        !point.address.includes("Потребує навчання")) {
      return point.address;
    }

    const raw = (point.text || point.raw_text || "").toLowerCase();
    if (!raw || typeof DNIPRO_STREETS_MAP === "undefined") return null;

    let bestMatch = null;
    let maxLen = 0;

    for (const item of Object.values(DNIPRO_STREETS_MAP)) {
      if (!item || !item.name) continue;
      const clean = item.name.toLowerCase().replace(/(?:вулиця|проспект|просп|провулок|вул|шосе|тупик|узвіз)\.?/gi, "").trim();
      if (clean.length >= 4 && raw.includes(clean)) {
        if (clean.length > maxLen) {
          maxLen = clean.length;
          bestMatch = item.name;
        }
      }
    }
    return bestMatch;
  }

  // =========================================================================
  // 4. СТИЛІ СТРОБ-МЕРЕХТІННЯ ПРИ ПЕРЕТЯГУВАННІ
  // =========================================================================
  if (!document.getElementById("manual-drag-pulse-style")) {
    const style = document.createElement("style");
    style.id = "manual-drag-pulse-style";
    style.innerHTML = `
      @keyframes markerTightYellowBlueStrobe {
        0% {
          filter: drop-shadow(0 0 3px #0284c7) drop-shadow(0 0 6px #38bdf8);
          opacity: 1;
        }
        50% {
          filter: drop-shadow(0 0 3px #ca8a04) drop-shadow(0 0 7px #facc15) brightness(1.4);
          opacity: 0.55;
        }
        100% {
          filter: drop-shadow(0 0 3px #0284c7) drop-shadow(0 0 6px #38bdf8);
          opacity: 1;
        }
      }
      .marker-blinking-active {
        animation: markerTightYellowBlueStrobe 0.65s infinite ease-in-out !important;
        z-index: 999999 !important;
        cursor: grab !important;
      }
      .marker-blinking-active:active {
        cursor: grabbing !important;
      }
    `;
    document.head.appendChild(style);
  }

  window.isManualDragActive = false;
  if (typeof window.renderMarkers === "function") {
    const origRenderMarkers = window.renderMarkers;
    window.renderMarkers = function (...args) {
      if (window.isManualDragActive) return;
      return origRenderMarkers.apply(this, args);
    };
  }

  // =========================================================================
  // 5. ОЧИЩЕННЯ ТА НАВЧАННЯ СИНОНІМІВ ("А = Б")
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

  async function saveRuleToKnowledgeBase(phrase, streetName, lat, lng) {
    const cleanKey = toSafeFirebaseKey(phrase);
    const ruleObj = {
      alias: phrase.toLowerCase(),
      phrase: phrase.toLowerCase(),
      name: streetName,
      address: streetName,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      time: Date.now()
    };

    if (window.DNIPRO_STREETS_MAP) {
      window.DNIPRO_STREETS_MAP[phrase.toLowerCase()] = ruleObj;
    }

    try {
      await fetch(FIREBASE_CUSTOM_URL.replace(".json", `/${cleanKey}.json`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruleObj)
      });
    } catch (e) {}
  }

  // =========================================================================
  // 6. РОЗПІЗНАВАННЯ ТОЧОК НА КАРТІ
  // =========================================================================
  function getLivePointsFromAllPoints(marker, primaryPoint) {
    const list = [];
    const allPts = window.allPoints || [];

    if (primaryPoint && primaryPoint._fbKey) {
      const exact = allPts.find(x => x._fbKey === primaryPoint._fbKey);
      if (exact) list.push(exact);
    }

    const latLng = marker && marker.getLatLng ? marker.getLatLng() : (primaryPoint ? L.latLng(primaryPoint.lat, primaryPoint.lng) : null);
    if (!latLng) return list.length > 0 ? list : (primaryPoint ? [primaryPoint] : []);

    allPts.forEach(pt => {
      if (!pt || !pt.lat || !pt.lng) return;
      const d = latLng.distanceTo([pt.lat, pt.lng]);
      if (d <= 45) {
        if (!list.includes(pt)) list.push(pt);
      }
    });

    if (list.length === 0 && primaryPoint) list.push(primaryPoint);
    return list;
  }

  function resolveMarkerPoint(marker) {
    if (!marker) return null;
    if (marker.pointData && typeof marker.pointData === "object" && marker.pointData.lat) return marker.pointData;

    const allPts = window.allPoints || [];
    if (marker.getLatLng && allPts.length > 0) {
      const pos = marker.getLatLng();
      let best = null;
      let minD = Infinity;
      allPts.forEach(p => {
        if (!p || !p.lat || !p.lng) return;
        const d = pos.distanceTo([p.lat, p.lng]);
        if (d < minD) {
          minD = d;
          best = p;
        }
      });
      if (best && minD < 65) return best;
    }

    if (marker.getLatLng) {
      const ll = marker.getLatLng();
      return {
        lat: Number(ll.lat.toFixed(5)),
        lng: Number(ll.lng.toFixed(5)),
        text: "Мітка на карті",
        raw_text: "Мітка на карті"
      };
    }
    return null;
  }

  // =========================================================================
  // 7. МЕНЮ ДІЙ З МІТКОЮ (ПЕРЕНЕСТИ ЗА АДРЕСОЮ + РУЧНЕ ПЕРЕТЯГУВАННЯ)
  // =========================================================================
  window.openRelocateActionSheet = function (point, marker) {
    const basePoint = point || resolveMarkerPoint(marker);
    const stackedPoints = getLivePointsFromAllPoints(marker, basePoint);

    window.activeActionMarker = marker;
    window.activeActionPoint = stackedPoints[0] || basePoint;

    let menu = document.getElementById("universalActionSheetModal");
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "universalActionSheetModal";
      menu.className = "action-sheet-backdrop";
      menu.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:999999; display:flex; align-items:flex-end; justify-content:center; backdrop-filter:blur(3px);";
      menu.onclick = (e) => {
        if (e.target.id === "universalActionSheetModal") menu.style.display = "none";
      };

      menu.innerHTML = `
        <div class="action-sheet-card" style="background:#0f172a; border:1px solid #334155; border-radius:20px 20px 0 0; width:100%; max-width:440px; padding:18px; display:flex; flex-direction:column; gap:12px; box-shadow:0 -10px 30px rgba(0,0,0,0.85);" onclick="event.stopPropagation()">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding-bottom:8px;">
            <div style="font-size:13.5px; font-weight:900; color:#38bdf8; display:flex; align-items:center; gap:6px;">
              <span>🛠️ Дії з міткою</span>
              <span id="uActionStackBadge" style="display:none; background:#f59e0b; color:#000; font-size:10px; font-weight:900; padding:1px 6px; border-radius:10px;">Стопка</span>
            </div>
            <span style="cursor:pointer; font-size:18px; color:#94a3b8; font-weight:800; padding:0 6px;" onclick="document.getElementById('universalActionSheetModal').style.display='none'">✕</span>
          </div>

          <div id="uActionStackSelectBox" style="display:none; flex-direction:column; gap:4px;">
            <div style="font-size:10px; font-weight:800; color:#94a3b8;">ОБЕРІТЬ ПОВІДОМЛЕННЯ:</div>
            <div id="uActionStackList" style="max-height:120px; overflow-y:auto; display:flex; flex-direction:column; gap:4px;"></div>
          </div>

          <div id="uActionQuoteText" style="font-size:11px; color:#cbd5e1; background:#1e293b; padding:8px 10px; border-radius:8px; line-height:1.4; border-left:3px solid #38bdf8;">
            —
          </div>

          <!-- ОБИДВІ КНОПКИ ВІДНОВЛЕНО -->
          <div style="display:flex; flex-direction:column; gap:8px;">
            <button id="btnActionGoAddress" style="background:linear-gradient(135deg, #0284c7, #0369a1); border:none; color:#fff; padding:12px; border-radius:10px; font-size:12px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer;">
              <span>🔍 Перенести за адресою (навчити «мозок»)</span>
            </button>

            <button id="btnActionGoManual" style="background:#1e293b; border:1px solid #0284c7; color:#38bdf8; padding:12px; border-radius:10px; font-size:12px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer;">
              <span>🎯 Перетягнути пальцем / мишкою</span>
            </button>

            <button onclick="document.getElementById('universalActionSheetModal').style.display='none'" style="background:transparent; border:1px solid #334155; color:#94a3b8; padding:10px; border-radius:10px; font-size:11.5px; font-weight:700; cursor:pointer; margin-top:4px;">
              Скасувати
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(menu);

      document.getElementById("btnActionGoAddress").onclick = () => {
        menu.style.display = "none";
        window.openTrainingModal(window.activeActionPoint, window.activeActionMarker);
      };

      document.getElementById("btnActionGoManual").onclick = () => {
        menu.style.display = "none";
        window.startDirectManualDrag(window.activeActionPoint, window.activeActionMarker);
      };
    }

    const badge = document.getElementById("uActionStackBadge");
    const stackBox = document.getElementById("uActionStackSelectBox");
    const stackList = document.getElementById("uActionStackList");
    const qEl = document.getElementById("uActionQuoteText");

    function renderSelectedQuote(p) {
      window.activeActionPoint = p;
      const txt = p ? (p.text || p.raw_text || p.address || "Мітка") : "Мітка";
      if (qEl) qEl.innerText = `«${txt}»`;
    }

    if (stackedPoints.length > 1) {
      if (badge) badge.style.display = "inline-block";
      if (stackBox) stackBox.style.display = "flex";
      if (stackList) {
        stackList.innerHTML = "";
        stackedPoints.forEach((pt, idx) => {
          const row = document.createElement("div");
          row.style.cssText = `background:${idx === 0 ? "#1e293b" : "#0b1120"}; border:1px solid ${idx === 0 ? "#0284c7" : "#334155"}; padding:6px 8px; border-radius:6px; font-size:10.5px; color:#f1f5f9; cursor:pointer;`;
          row.innerText = `${idx + 1}. ${pt.text || pt.raw_text || "Повідомлення"}`;
          row.onclick = () => {
            Array.from(stackList.children).forEach(c => {
              c.style.background = "#0b1120";
              c.style.borderColor = "#334155";
            });
            row.style.background = "#1e293b";
            row.style.borderColor = "#0284c7";
            renderSelectedQuote(pt);
          };
          stackList.appendChild(row);
        });
      }
    } else {
      if (badge) badge.style.display = "none";
      if (stackBox) stackBox.style.display = "none";
    }

    renderSelectedQuote(stackedPoints[0] || basePoint);
    menu.style.display = "flex";
  };

  window.openActionSheet = window.openRelocateActionSheet;

  // ПК-кліки (СКМ і ПКМ)
  function setupDesktopInteractions() {
    if (!window.map) return setTimeout(setupDesktopInteractions, 300);
    const mapContainer = window.map.getContainer();
    if (!mapContainer || mapContainer._desktopMouseHandled) return;
    mapContainer._desktopMouseHandled = true;

    mapContainer.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    mapContainer.addEventListener("auxclick", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    function handleDesktopClickOnTarget(target) {
      if (!target || !window.map) return;
      let clickedMarker = null;

      window.map.eachLayer(l => {
        if (clickedMarker) return;
        const el = l.getElement ? l.getElement() : (l._icon || l._path);
        if (el && (el === target || el.contains(target) || target.contains(el))) {
          clickedMarker = l;
        }
      });

      if (clickedMarker) {
        const pt = resolveMarkerPoint(clickedMarker);
        window.openRelocateActionSheet(pt, clickedMarker);
      }
    }

    mapContainer.addEventListener("mousedown", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        const target = e.target.closest(".leaflet-marker-icon, .leaflet-interactive");
        if (target) handleDesktopClickOnTarget(target);
      }
    }, true);

    mapContainer.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target.closest(".leaflet-marker-icon, .leaflet-interactive");
      if (target) handleDesktopClickOnTarget(target);
    }, true);
  }
  setupDesktopInteractions();

  // =========================================================================
  // 8. ДИНАМІЧНІ МОДАЛКИ ДЛЯ ПЕРЕНЕСЕННЯ ЗА АДРЕСОЮ
  // =========================================================================
  function ensureTrainingModalsExist() {
    let trainModal = document.getElementById("trainModal");
    if (!trainModal) {
      trainModal = document.createElement("div");
      trainModal.id = "trainModal";
      trainModal.className = "action-sheet-backdrop";
      trainModal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:999999; display:none; align-items:center; justify-content:center; backdrop-filter:blur(3px);";
      trainModal.onclick = (e) => {
        if (e.target.id === "trainModal") trainModal.style.display = "none";
      };

      trainModal.innerHTML = `
        <div class="train-modal-card" style="background:#0f172a; border:1px solid #334155; border-radius:16px; width:92%; max-width:400px; padding:16px; display:flex; flex-direction:column; gap:10px; box-shadow:0 10px 35px rgba(0,0,0,0.9);" onclick="event.stopPropagation()">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding-bottom:8px;">
            <div style="font-size:13.5px; font-weight:900; color:#38bdf8;">🔍 Перенести за адресою</div>
            <span style="cursor:pointer; font-size:18px; color:#94a3b8; font-weight:800;" onclick="document.getElementById('trainModal').style.display='none'">✕</span>
          </div>

          <div id="trainTextQuote" style="font-size:11px; color:#cbd5e1; background:#1e293b; padding:8px 10px; border-radius:8px; border-left:3px solid #38bdf8; line-height:1.4;">
            —
          </div>

          <div style="position:relative;">
            <input type="text" id="trainCustomInput" placeholder="Введіть правильну назву вулиці..." style="width:100%; background:#0b1120; border:1px solid #0284c7; color:#fff; padding:10px; border-radius:8px; font-size:12px; outline:none; box-sizing:border-box;">
            <div id="trainSearchResults" style="position:absolute; top:100%; left:0; width:100%; background:#0f172a; border:1px solid #334155; border-radius:8px; max-height:180px; overflow-y:auto; z-index:10005; display:none; margin-top:4px; box-shadow:0 8px 25px rgba(0,0,0,0.85);"></div>
          </div>

          <button onclick="document.getElementById('trainModal').style.display='none'" style="background:transparent; border:1px solid #334155; color:#94a3b8; padding:8px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer;">
            Скасувати
          </button>
        </div>
      `;
      document.body.appendChild(trainModal);

      const trainInput = document.getElementById("trainCustomInput");
      trainInput.addEventListener("input", () => {
        clearTimeout(searchDebounceTimer);
        if (trainInput.value.trim().length >= 2) {
          searchDebounceTimer = setTimeout(window.executeCustomTrain, 200);
        } else {
          const res = document.getElementById("trainSearchResults");
          if (res) res.style.display = "none";
        }
      });
    }

    let confirmModal = document.getElementById("confirmMoveModal");
    if (!confirmModal) {
      confirmModal = document.createElement("div");
      confirmModal.id = "confirmMoveModal";
      confirmModal.className = "action-sheet-backdrop";
      confirmModal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:999999; display:none; align-items:center; justify-content:center; backdrop-filter:blur(3px);";

      confirmModal.innerHTML = `
        <div class="action-sheet-card" style="background:#0f172a; border:1px solid #334155; border-radius:16px; width:90%; max-width:340px; padding:16px; display:flex; flex-direction:column; gap:12px; box-shadow:0 10px 35px rgba(0,0,0,0.9);" onclick="event.stopPropagation()">
          <div style="font-size:13.5px; font-weight:900; color:#38bdf8;">Підтвердження прив'язки</div>
          <div style="font-size:11.5px; color:#cbd5e1; line-height:1.4;">
            Перенести мітку на вулицю:<br>
            <b id="confirmStreetName" style="color:#38bdf8; font-size:13px;">—</b>?
          </div>
          <div style="display:flex; gap:8px;">
            <button onclick="window.finalizeMoveConfirm(true)" style="flex:1; background:#0284c7; border:none; color:#fff; padding:10px; border-radius:8px; font-size:12px; font-weight:800; cursor:pointer;">
              Підтвердити
            </button>
            <button onclick="window.finalizeMoveConfirm(false)" style="flex:1; background:#334155; border:none; color:#94a3b8; padding:10px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer;">
              Скасувати
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(confirmModal);
    }
  }

  let searchDebounceTimer = null;

  window.openTrainingModal = function (point, marker) {
    ensureTrainingModalsExist();
    window.activeActionPoint = point;
    window.activeActionMarker = marker;

    const modal = document.getElementById("trainModal");
    const quoteEl = document.getElementById("trainTextQuote");
    const inputEl = document.getElementById("trainCustomInput");
    const resultsEl = document.getElementById("trainSearchResults");

    const rawText = point ? (point.text || point.raw_text || "") : "";
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

  window.executeCustomTrain = async function () {
    const inputEl = document.getElementById("trainCustomInput");
    const resultsEl = document.getElementById("trainSearchResults");
    if (!inputEl || !resultsEl) return;

    const q = inputEl.value.trim().toLowerCase();
    if (q.length < 2) {
      resultsEl.style.display = "none";
      return;
    }

    const collectedMatches = [];

    if (typeof DNIPRO_STREETS_MAP !== "undefined") {
      for (const [key, item] of Object.entries(DNIPRO_STREETS_MAP)) {
        if (!item || !item.name) continue;
        const matchesQuery = key.includes(q) || (item.old && item.old.toLowerCase().includes(q)) || item.name.toLowerCase().includes(q);
        if (matchesQuery) {
          if (!collectedMatches.some(m => m.name === item.name)) {
            collectedMatches.push({
              name: item.name,
              lat: item.lat,
              lng: item.lng,
              old: item.old,
              label: `📍 <b>${item.name}</b> ${item.old ? `<span style="font-size:10px; color:#94a3b8;">(раніше: \${item.old})</span>` : ""}`
            });
          }
        }
        if (collectedMatches.length >= 8) break;
      }
    }

    resultsEl.innerHTML = "";
    if (collectedMatches.length === 0) {
      resultsEl.innerHTML = `<div style="padding:8px 10px; font-size:11px; color:#94a3b8;">Вулицю не знайдено. Введіть іншу назву.</div>`;
      resultsEl.style.display = "block";
      return;
    }

    collectedMatches.forEach(item => {
      const row = document.createElement("div");
      row.style.cssText = "padding:8px 10px; font-size:11px; color:#cbd5e1; cursor:pointer; border-bottom:1px solid #1e293b;";
      row.innerHTML = item.label;
      row.onclick = () => selectStreetForRelocation(item);
      resultsEl.appendChild(row);
    });

    resultsEl.style.display = "block";
  };

  function selectStreetForRelocation(streetObj) {
    const p = window.activeActionPoint;
    if (!p) return;

    const modal = document.getElementById("trainModal");
    if (modal) modal.style.display = "none";

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
      window.map.flyTo([streetObj.lat, streetObj.lng], 16, { animate: true, duration: 0.8 });
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

    if (Array.isArray(window.allPoints)) {
      window.allPoints.forEach(item => {
        if (!item) return;
        if ((p._fbKey && item._fbKey === p._fbKey) || (p.text && item.text === p.text)) {
          item.lat = p.lat;
          item.lng = p.lng;
          item.address = p.address;
          item.needs_training = false;
          item.geo_refined = true;
        }
      });
    }

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
      await saveRuleToKnowledgeBase(cleanRulePhrase, pr.streetName, p.lat, p.lng);
    }

    window.pendingRelocation = null;
    if (typeof showToast === "function") showToast(`✅ Збережено: «${cleanRulePhrase}» ➔ ${pr.streetName}`, 3500);
    if (typeof renderMarkers === "function") renderMarkers();
    if (typeof renderTrafficLights === "function") renderTrafficLights();
  };

  // =========================================================================
  // 9. РУЧНИЙ РЕЖИМ ПЕРЕТЯГУВАННЯ МІТКИ
  // =========================================================================
  let manualMovingMarker = null;
  let manualOriginalLatLng = null;
  let manualPointObj = null;

  window.startDirectManualDrag = function (pointOrFbKey, optionalMarker) {
    let p = null;
    let m = optionalMarker;

    if (pointOrFbKey instanceof L.Layer || (pointOrFbKey && pointOrFbKey.getLatLng)) {
      m = pointOrFbKey;
    } else if (typeof pointOrFbKey === "object" && pointOrFbKey !== null) {
      p = pointOrFbKey;
    } else if (typeof pointOrFbKey === "string") {
      p = (window.allPoints || []).find(x => x._fbKey === pointOrFbKey);
    }

    if (!p && window.activeActionPoint) p = window.activeActionPoint;

    if (!m && window.map && p) {
      let minDist = Infinity;
      window.map.eachLayer(l => {
        if (l instanceof L.Marker || (typeof L.CircleMarker !== "undefined" && l instanceof L.CircleMarker)) {
          if (l.getLatLng) {
            const d = l.getLatLng().distanceTo([p.lat, p.lng]);
            if (d < minDist && d < 65) {
              minDist = d;
              m = l;
            }
          }
        }
      });
    }

    if (!m && window.activeActionMarker) m = window.activeActionMarker;
    if (!p && m) p = resolveMarkerPoint(m);

    if (!m) {
      if (typeof showToast === "function") showToast("⚠️ Маркер не знайдено для перенесення");
      return;
    }

    manualMovingMarker = m;
    manualPointObj = p;
    manualOriginalLatLng = L.latLng(m.getLatLng().lat, m.getLatLng().lng);

    if (m.closePopup) m.closePopup();

    if (m.dragging) {
      m.dragging.enable();
    } else if (L.Handler && L.Handler.MarkerDrag) {
      m.dragging = new L.Handler.MarkerDrag(m);
      m.dragging.enable();
    }

    const iconEl = m.getElement ? m.getElement() : (m._icon || m._path);
    if (iconEl) iconEl.classList.add("marker-blinking-active");

    window.isManualDragActive = true;
    showManualDragFloatingBar(m.getLatLng().lat, m.getLatLng().lng);

    m.off("drag");
    m.off("dragend");

    m.on("drag", () => {
      const cur = m.getLatLng();
      updateManualFloatingCoords(cur.lat, cur.lng);
      if (manualPointObj) {
        manualPointObj.lat = Number(cur.lat.toFixed(5));
        manualPointObj.lng = Number(cur.lng.toFixed(5));
      }
    });

    m.on("dragend", () => {
      const cur = m.getLatLng();
      updateManualFloatingCoords(cur.lat, cur.lng);
      if (manualPointObj) {
        manualPointObj.lat = Number(cur.lat.toFixed(5));
        manualPointObj.lng = Number(cur.lng.toFixed(5));
      }
    });

    if (typeof showToast === "function") {
      showToast("🎯 Перетягуйте мітку вільно у потрібне місце дороги", 3000);
    }
  };

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
        z-index: 999999;
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
            <span style="font-size:10px; color:#94a3b8; font-weight:normal;">(рухайте мітку)</span>
          </div>
          <div id="manualDragLiveCoords" style="font-family:monospace; font-size:11px; color:#38bdf8; background:#1e293b; padding:2px 6px; border-radius:5px;">
            ${lat.toFixed(5)}, ${lng.toFixed(5)}
          </div>
        </div>
        <div style="display:flex; gap:6px;">
          <button id="btnCopyLiveCoords" style="flex:1; background:#1e293b; border:1px solid #0284c7; color:#38bdf8; font-size:11px; font-weight:800; padding:7px 4px; border-radius:7px; cursor:pointer;">
            📋 Координати
          </button>
          <button id="btnConfirmManualDrag" style="flex:1.3; background:#0284c7; border:none; color:#fff; font-size:12px; font-weight:900; padding:7px 4px; border-radius:7px; cursor:pointer;">
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
    window.isManualDragActive = false;

    if (manualMovingMarker) {
      if (manualOriginalLatLng) manualMovingMarker.setLatLng(manualOriginalLatLng);
      if (manualMovingMarker.dragging) manualMovingMarker.dragging.disable();

      const el = manualMovingMarker.getElement ? manualMovingMarker.getElement() : (manualMovingMarker._icon || manualMovingMarker._path);
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
    const origLat = manualOriginalLatLng ? manualOriginalLatLng.lat : null;
    const origLng = manualOriginalLatLng ? manualOriginalLatLng.lng : null;

    closeManualFloatingBar();

    if (manualMovingMarker.dragging) manualMovingMarker.dragging.disable();
    const el = manualMovingMarker.getElement ? manualMovingMarker.getElement() : (manualMovingMarker._icon || manualMovingMarker._path);
    if (el) el.classList.remove("marker-blinking-active");

    manualMovingMarker.off("drag");
    manualMovingMarker.off("dragend");

    let targetFbKey = p ? p._fbKey : null;

    if (Array.isArray(window.allPoints)) {
      window.allPoints.forEach(item => {
        if (!item) return;
        const matchKey = targetFbKey && item._fbKey === targetFbKey;
        const matchCoord = origLat && Math.abs(item.lat - origLat) < 0.0004 && Math.abs(item.lng - origLng) < 0.0004;
        const matchText = p && p.text && item.text === p.text;

        if (matchKey || matchCoord || matchText) {
          item.lat = lat;
          item.lng = lng;
          item.geo_refined = true;
          item.needs_training = false;
          if (!targetFbKey && item._fbKey) targetFbKey = item._fbKey;
        }
      });
    }

    if (p) {
      p.lat = lat;
      p.lng = lng;
      p.geo_refined = true;
      p.needs_training = false;
    }

    if (targetFbKey) {
      fetch(FIREBASE_POINTS_URL.replace(".json", `/${targetFbKey}.json`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: lat, lng: lng, geo_refined: true, needs_training: false })
      }).catch(() => {});
    }

    // Розумне визначення назви вулиці: спочатку перевіряємо, де кинули мітку
    let detectedStreet = findNearestStreet(lat, lng, 120) || detectStreetForPoint(p);

    if (detectedStreet) {
      await saveStreetCoordinateOverride(detectedStreet, lat, lng);
    }

    manualMovingMarker.setLatLng([lat, lng]);
    window.isManualDragActive = false;

    manualMovingMarker = null;
    manualPointObj = null;

    const streetNote = detectedStreet ? ` для «${detectedStreet}»` : "";
    if (typeof showToast === "function") {
      showToast(`✅ Зсув збережено${streetNote}: (${lat.toFixed(4)}, ${lng.toFixed(4)})`, 4000);
    }

    if (typeof renderMarkers === "function") renderMarkers();
    if (typeof renderTrafficLights === "function") renderTrafficLights();
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

})();
