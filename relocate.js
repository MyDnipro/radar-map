/**
 * relocate.js — Модуль перенесення міток та надійного калібрування вулиць v9.1
 * - Повний захист простого режиму (жодних меню, перетягувань та попапів дій)
 * - Єдине сучасне вікно дій для режиму розробника
 * - Надійна робота з усією стопкою (динамічний підрахунок, виділення всіх рядків, груповий зсув)
 * - 4-рівневий адресний пошук (📍 🧠 🌐 🗺️) з нормалізацією літер та закінчень
 * - Безвідмовне закриття вікон (✕, Esc, клік поза вікном)
 */

(function () {
  const FIREBASE_POINTS_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/points.json";
  const FIREBASE_CUSTOM_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/custom_streets.json";
  const FIREBASE_OVERRIDES_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/street_overrides.json";

  // =========================================================================
  // 1. БЕЗПЕКА ТА РЕЖИМИ РОБОТИ
  // =========================================================================
  function isSimpleMode() {
    return document.documentElement.classList.contains("mode-simple") ||
           localStorage.getItem("radar_ui_mode") === "simple";
  }

  // Примусово видаляємо застарілі примітивні діалоги з index.html
  function purgeLegacyModals() {
    const oldSheet = document.getElementById("markerActionSheet");
    if (oldSheet) oldSheet.remove();
    const oldTrain = document.getElementById("trainModal");
    if (oldTrain) oldTrain.remove();
  }
  setTimeout(purgeLegacyModals, 150);

  // =========================================================================
  // 2. БЕЗПЕЧНІ КЛЮЧІ ТА НОРМАЛІЗАЦІЯ ДЛЯ ПОШУКУ
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

  function cleanStem(word) {
    if (!word) return "";
    let w = word.toLowerCase()
      .replace(/[іїыи]/g, "и")
      .replace(/[еєэ]/g, "е")
      .replace(/['`’"]/g, "")
      .trim();
    if (w.length >= 4) {
      w = w.replace(/(?:ська|ская|ське|ское|ський|ский|ова|ева|єва|ина|іна|ного|ного|ого|ому|ій|ой|ей|ям|ам|ах|ях|ів|ев|ий|ій|а|я|е|є|о|у|ю|і|и)$/gi, "");
    }
    return w;
  }

  function normalizeQueryText(s) {
    if (!s) return "";
    return s.toLowerCase()
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, " ")
      .replace(/(?:вулиця|проспект|просп|провулок|вул|шосе|тупик|узвіз)\.?/gi, " ")
      .replace(/[^a-zа-яіїєґ0-9]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  // =========================================================================
  // 3. ДОВІДНИК ПЕРЕЙМЕНУВАНЬ ДЛЯ ПОПАПІВ КАРТИ
  // =========================================================================
  window.getStreetRenameNote = function (rawText) {
    if (!rawText || typeof DNIPRO_STREETS_MAP === "undefined") return "";
    const t = rawText.toLowerCase().replace(/[\r\n,.-]+/g, " ");

    let matchedItem = null;
    let matchedOld = false;
    let maxMatchLen = 0;

    for (const [key, item] of Object.entries(DNIPRO_STREETS_MAP)) {
      if (!item || !item.name) continue;
      const cleanName = item.name.toLowerCase().replace(/(?:вулиця|проспект|просп|провулок|вул|шосе|тупик|узвіз)\.?/gi, "").trim();
      const cleanOld = (item.old || "").toLowerCase().replace(/(?:вулиця|проспект|просп|провулок|вул|шосе|тупик|узвіз)\.?/gi, "").trim();

      const oldVariants = (item.old || "")
        .toLowerCase()
        .split(/[,;/]+/)
        .map(s => s.replace(/(?:вулиця|проспект|просп|провулок|вул|шосе|тупик|узвіз)\.?/gi, "").trim())
        .filter(s => s.length >= 3);

      const matchOld = (cleanOld.length >= 3 && t.includes(cleanOld)) || oldVariants.some(v => t.includes(v));
      const matchNew = cleanName.length >= 3 && t.includes(cleanName);
      const matchKey = key.length >= 3 && t.includes(key);

      if (matchOld || matchNew || matchKey) {
        const curLen = Math.max(
          matchOld ? (cleanOld.length || 5) : 0,
          matchNew ? cleanName.length : 0,
          matchKey ? key.length : 0
        );
        if (curLen > maxMatchLen) {
          maxMatchLen = curLen;
          matchedItem = item;
          matchedOld = matchOld || (matchKey && !item.name.toLowerCase().includes(key));
        }
      }
    }

    if (!matchedItem) return "";

    const isLandmark = matchedItem.type === "landmark" ||
      matchedItem.landmark ||
      matchedItem.is_landmark ||
      /міст|мост|завод|вокзал|тц|трц|ринок|парк|озерк|кар'єр|станція/i.test(matchedItem.name);

    if (isLandmark) return `📍 Місцевий орієнтир`;

    if (matchedItem.old) {
      return matchedOld ? `📍 Нова назва: ${matchedItem.name}` : `📍 Раніше: ${matchedItem.old}`;
    }
    return `📍 Не перейменовувалась`;
  };

  // =========================================================================
  // 4. СИНХРОНІЗАЦІЯ ТА ЗБЕРЕЖЕННЯ ЗСУВІВ (STREET OVERRIDES)
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

  function detectOfficialStreetForPoint(point) {
    if (!point) return null;

    const raw = (point.text || point.raw_text || "").toLowerCase().replace(/[\r\n,.-]+/g, " ");
    if (raw && typeof DNIPRO_STREETS_MAP !== "undefined") {
      let bestItem = null;
      let maxLen = 0;

      for (const [key, item] of Object.entries(DNIPRO_STREETS_MAP)) {
        if (!item || !item.name) continue;
        const cleanName = item.name.toLowerCase().replace(/(?:вулиця|проспект|просп|провулок|вул|шосе|тупик|узвіз)\.?/gi, "").trim();
        const cleanOld = (item.old || "").toLowerCase().replace(/(?:вулиця|проспект|просп|провулок|вул|шосе|тупик|узвіз)\.?/gi, "").trim();

        const matchOld = cleanOld.length >= 3 && raw.includes(cleanOld);
        const matchNew = cleanName.length >= 3 && raw.includes(cleanName);
        const matchKey = key.length >= 3 && raw.includes(key);

        if (matchOld || matchNew || matchKey) {
          const l = Math.max(matchOld ? cleanOld.length : 0, matchNew ? cleanName.length : 0, matchKey ? key.length : 0);
          if (l > maxLen) {
            maxLen = l;
            bestItem = item;
          }
        }
      }
      if (bestItem && bestItem.name) return bestItem.name;
    }

    if (point.address &&
        point.address !== "Встановлено користувачем" &&
        point.address !== "Мітка на карті" &&
        !point.address.includes("Потребує навчання")) {
      if (typeof DNIPRO_STREETS_MAP !== "undefined") {
        const addrLower = point.address.toLowerCase();
        for (const item of Object.values(DNIPRO_STREETS_MAP)) {
          if (item && item.name && (item.name.toLowerCase() === addrLower || (item.old && item.old.toLowerCase().includes(addrLower)))) {
            return item.name;
          }
        }
      }
      return point.address;
    }
    return null;
  }

  // =========================================================================
  // 5. МУЛЬТИ-ПОШУК З 4 ДЖЕРЕЛ (📍 🧠 🌐 🗺️)
  // =========================================================================
  function searchLocalStreets(query) {
    const results = [];
    if (!query || typeof DNIPRO_STREETS_MAP === "undefined") return results;

    const normQ = normalizeQueryText(query);
    const searchStems = normQ.split(" ").map(cleanStem).filter(w => w.length >= 2);
    if (searchStems.length === 0) return results;

    for (const [key, item] of Object.entries(DNIPRO_STREETS_MAP)) {
      if (!item || !item.name || !item.lat || !item.lng) continue;

      const normName = normalizeQueryText(item.name);
      const normOld = normalizeQueryText(item.old || "");
      const normKey = normalizeQueryText(key);

      const targetStems = [
        ...normName.split(" ").map(cleanStem),
        ...normOld.split(" ").map(cleanStem),
        ...normKey.split(" ").map(cleanStem)
      ];

      const matched = searchStems.every(sq => targetStems.some(ts => ts.includes(sq) || sq.includes(ts)));

      if (matched) {
        if (!results.some(r => r.name.toLowerCase() === item.name.toLowerCase())) {
          const isCustomMemory = item.is_custom || item.from_kb || key.length > 20;
          const emoji = isCustomMemory ? "🧠" : "📍";
          const subText = item.old ? `<span style="font-size:10px; color:#94a3b8;"> (раніше: ${item.old})</span>` : "";
          results.push({
            name: item.name,
            lat: Number(item.lat),
            lng: Number(item.lng),
            source: emoji,
            label: `${emoji} <b>${item.name}</b>${subText}`
          });
        }
      }
      if (results.length >= 8) break;
    }
    return results;
  }

  async function searchPhotonKomoot(query) {
    const results = [];
    if (!query || query.length < 3) return results;
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query + " Дніпро")}&lat=48.4647&lon=35.0462&limit=6`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return results;
      const data = await res.json();
      if (!data || !Array.isArray(data.features)) return results;

      data.features.forEach(f => {
        const p = f.properties || {};
        const coords = f.geometry && f.geometry.coordinates;
        if (!coords || coords.length < 2) return;

        const street = p.street || p.name || "";
        if (!street) return;

        const num = p.housenumber ? `, ${p.housenumber}` : "";
        const fullName = `${street}${num}`;
        const lng = Number(coords[0]);
        const lat = Number(coords[1]);

        if (lat >= 48.20 && lat <= 48.70 && lng >= 34.60 && lng <= 35.45) {
          results.push({
            name: fullName,
            lat: lat,
            lng: lng,
            source: "🌐",
            label: `🌐 <b>${fullName}</b> <span style="font-size:10px; color:#38bdf8;">(Photon онлайн)</span>`
          });
        }
      });
    } catch (e) {}
    return results;
  }

  async function searchNominatimOSM(query) {
    const results = [];
    if (!query || query.length < 3) return results;
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ", Дніпро")}&limit=4&countrycodes=ua&accept-language=uk,ru`;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2800);

      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return results;
      const data = await res.json();
      if (!Array.isArray(data)) return results;

      data.forEach(item => {
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        const shortName = (item.display_name || "").split(",").slice(0, 2).join(",").trim();

        if (lat >= 48.20 && lat <= 48.70 && lng >= 34.60 && lng <= 35.45) {
          results.push({
            name: shortName,
            lat: lat,
            lng: lng,
            source: "🗺️",
            label: `🗺️ <b>${shortName}</b> <span style="font-size:10px; color:#a855f7;">(OpenStreetMap)</span>`
          });
        }
      });
    } catch (e) {}
    return results;
  }

  // =========================================================================
  // 6. НАДІЙНЕ ЗАКРИТТЯ ВІКОН (✕ ТА ESC)
  // =========================================================================
  window.closeAllRelocateModals = function () {
    const ids = ["universalActionSheetModal", "relocateAddressModalCard", "confirmMoveModal"];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
    const floating = document.getElementById("manualDragFloatingBar");
    if (floating && !window.isManualDragActive) floating.style.display = "none";
  };

  window.closeTrainModal = window.closeAllRelocateModals;
  window.closeMarkerActionSheet = window.closeAllRelocateModals;

  document.addEventListener("click", function (e) {
    const target = e.target;
    if (!target) return;

    if (target.id === "modalCardCloseBtn" || target.innerText === "✕" || target.classList.contains("close")) {
      const m = target.closest("#universalActionSheetModal, #relocateAddressModalCard, #confirmMoveModal, .action-sheet-backdrop");
      if (m) {
        e.preventDefault();
        e.stopPropagation();
        m.style.display = "none";
        return;
      }
    }

    if (target.classList.contains("action-sheet-backdrop")) {
      target.style.display = "none";
    }
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      window.closeAllRelocateModals();
      if (window.isManualDragActive) cancelManualDragMode();
    }
  });

  // =========================================================================
  // 7. МОДАЛЬНЕ ВІКНО «ПЕРЕНЕСТИ ЗА АДРЕСОЮ»
  // =========================================================================
  let searchDebounceTimer = null;

  function ensureRelocateAddressModal() {
    let modal = document.getElementById("relocateAddressModalCard");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "relocateAddressModalCard";
      modal.className = "action-sheet-backdrop";
      modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:9999999; display:none; align-items:center; justify-content:center; backdrop-filter:blur(3px);";

      modal.innerHTML = `
        <div style="background:#0f172a; border:2px solid #0284c7; border-radius:18px; width:92%; max-width:420px; padding:16px; display:flex; flex-direction:column; gap:10px; box-shadow:0 0 25px rgba(2,132,199,0.4);" onclick="event.stopPropagation()">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding-bottom:8px;">
            <div style="font-size:13.5px; font-weight:900; color:#38bdf8; display:flex; align-items:center; gap:6px;">
              <span>📍 Переміщення за адресою</span>
            </div>
            <span id="modalCardCloseBtn" style="cursor:pointer; font-size:20px; color:#94a3b8; font-weight:800; padding:0 6px;">✕</span>
          </div>

          <div id="relocateModalQuote" style="font-size:11px; color:#cbd5e1; background:#1e293b; padding:8px 10px; border-radius:8px; border-left:3px solid #f59e0b; line-height:1.4;">
            —
          </div>

          <div style="position:relative; display:flex; gap:6px;">
            <input type="text" id="relocateModalInput" placeholder="Почніть вводити назву вулиці..." style="flex:1; background:#0b1120; border:1px solid #0284c7; color:#fff; padding:10px; border-radius:8px; font-size:12px; outline:none; box-sizing:border-box;">
            <button id="relocateModalFindBtn" style="background:#0284c7; border:none; color:#fff; font-size:11.5px; font-weight:800; padding:0 14px; border-radius:8px; cursor:pointer;">
              Знайти
            </button>
            <div id="relocateModalResultsBox" style="position:absolute; top:100%; left:0; width:100%; background:#0f172a; border:1px solid #334155; border-radius:8px; max-height:220px; overflow-y:auto; z-index:10005; display:none; margin-top:5px; box-shadow:0 10px 30px rgba(0,0,0,0.9);"></div>
          </div>

          <button id="relocateModalCancelBtn" style="background:transparent; border:1px solid #334155; color:#94a3b8; padding:8px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer; margin-top:2px;">
            Скасувати
          </button>
        </div>
      `;
      document.body.appendChild(modal);

      const closeX = document.getElementById("modalCardCloseBtn");
      if (closeX) closeX.onclick = () => { modal.style.display = "none"; };

      const btnCancel = document.getElementById("relocateModalCancelBtn");
      if (btnCancel) btnCancel.onclick = () => { modal.style.display = "none"; };

      const input = document.getElementById("relocateModalInput");
      const btnFind = document.getElementById("relocateModalFindBtn");

      if (input) {
        input.addEventListener("input", () => {
          clearTimeout(searchDebounceTimer);
          const val = input.value.trim();
          if (val.length >= 2) {
            searchDebounceTimer = setTimeout(() => executeSearchFlow(val), 300);
          } else {
            const rb = document.getElementById("relocateModalResultsBox");
            if (rb) rb.style.display = "none";
          }
        });

        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            clearTimeout(searchDebounceTimer);
            executeSearchFlow(input.value.trim());
          }
        });
      }

      if (btnFind) {
        btnFind.onclick = () => {
          clearTimeout(searchDebounceTimer);
          executeSearchFlow(input ? input.value.trim() : "");
        };
      }
    }
    return modal;
  }

  async function executeSearchFlow(rawQ) {
    const box = document.getElementById("relocateModalResultsBox");
    if (!box) return;

    if (!rawQ || rawQ.length < 2) {
      box.style.display = "none";
      return;
    }

    box.innerHTML = `<div style="padding:10px; font-size:11px; color:#38bdf8;">⏳ Пошук у базах (📍 🧠 🌐 🗺️)...</div>`;
    box.style.display = "block";

    const localMatches = searchLocalStreets(rawQ);

    const [photonMatches, osmMatches] = await Promise.all([
      searchPhotonKomoot(rawQ),
      searchNominatimOSM(rawQ)
    ]);

    const merged = [...localMatches];
    [...photonMatches, ...osmMatches].forEach(ext => {
      if (!merged.some(m => m.name.toLowerCase() === ext.name.toLowerCase())) {
        merged.push(ext);
      }
    });

    if (merged.length === 0) {
      box.innerHTML = `<div style="padding:10px; font-size:11px; color:#f87171;">Вулицю не знайдено. Введіть іншу назву.</div>`;
      return;
    }

    box.innerHTML = "";
    merged.slice(0, 10).forEach(item => {
      const row = document.createElement("div");
      row.style.cssText = "padding:9px 12px; font-size:11.5px; color:#cbd5e1; cursor:pointer; border-bottom:1px solid #1e293b; display:flex; align-items:center; gap:6px;";
      row.innerHTML = item.label;
      row.onmouseover = () => row.style.background = "#1e293b";
      row.onmouseout = () => row.style.background = "transparent";
      row.onclick = () => selectStreetForRelocation(item);
      box.appendChild(row);
    });
  }

  window.openTrainingModal = function (point, marker) {
    if (isSimpleMode()) return;
    try {
      const modal = ensureRelocateAddressModal();
      window.activeActionPoint = point;
      window.activeActionMarker = marker;

      const quoteEl = document.getElementById("relocateModalQuote");
      const inputEl = document.getElementById("relocateModalInput");
      const resultsEl = document.getElementById("relocateModalResultsBox");

      const isStack = window.isMovingEntireStack && window.activeStackedPoints && window.activeStackedPoints.length > 1;
      if (quoteEl) {
        if (isStack) {
          quoteEl.innerHTML = `📦 <b>Перенесення всієї стопки</b> (${window.activeStackedPoints.length} повідомлень разом)`;
        } else {
          const txt = point ? (point.text || point.raw_text || point.address || "Повідомлення") : "Повідомлення";
          quoteEl.innerText = `«${txt}»`;
        }
      }

      if (inputEl) {
        inputEl.value = "";
        setTimeout(() => inputEl.focus(), 120);
      }
      if (resultsEl) resultsEl.style.display = "none";

      modal.style.display = "flex";
    } catch (err) {
      console.error("Помилка відкриття форми перенесення:", err);
    }
  };

  function selectStreetForRelocation(streetObj) {
    const p = window.activeActionPoint;
    if (!p) return;

    window.closeAllRelocateModals();

    let targetName = streetObj.name;
    if (typeof DNIPRO_STREETS_MAP !== "undefined") {
      for (const item of Object.values(DNIPRO_STREETS_MAP)) {
        if (item && item.old && (item.old.toLowerCase().includes(targetName.toLowerCase()) || targetName.toLowerCase().includes(item.old.toLowerCase()))) {
          targetName = item.name;
          break;
        }
      }
    }

    window.pendingRelocation = {
      point: p,
      street: streetObj,
      targetLat: streetObj.lat,
      targetLng: streetObj.lng,
      streetName: targetName
    };

    let confirmModal = document.getElementById("confirmMoveModal");
    if (!confirmModal) {
      confirmModal = document.createElement("div");
      confirmModal.id = "confirmMoveModal";
      confirmModal.className = "action-sheet-backdrop";
      confirmModal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:9999999; display:none; align-items:center; justify-content:center; backdrop-filter:blur(3px);";
      confirmModal.innerHTML = `
        <div style="background:#0f172a; border:2px solid #0284c7; border-radius:16px; width:90%; max-width:340px; padding:16px; display:flex; flex-direction:column; gap:12px; box-shadow:0 10px 35px rgba(0,0,0,0.9);" onclick="event.stopPropagation()">
          <div style="font-size:13.5px; font-weight:900; color:#38bdf8;">Підтвердження перенесення</div>
          <div id="confirmPromptDesc" style="font-size:11.5px; color:#cbd5e1; line-height:1.4;">
            Перенести мітку на офіційну вулицю:<br>
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

    const isStack = window.isMovingEntireStack && window.activeStackedPoints && window.activeStackedPoints.length > 1;
    const promptEl = document.getElementById("confirmPromptDesc");
    if (promptEl) {
      promptEl.innerHTML = isStack
        ? `Перенести <b>ВСЮ СТОПКУ (${window.activeStackedPoints.length} мітки)</b> на:<br><b id="confirmStreetName" style="color:#38bdf8; font-size:13px;">${targetName}</b>?`
        : `Перенести мітку на офіційну вулицю:<br><b id="confirmStreetName" style="color:#38bdf8; font-size:13px;">${targetName}</b>?`;
    }

    confirmModal.style.display = "flex";

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

    const isStack = window.isMovingEntireStack && window.activeStackedPoints && window.activeStackedPoints.length > 1;
    const targets = isStack ? window.activeStackedPoints : [pr.point];

    targets.forEach(p => {
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

      const rawText = p.text || p.raw_text || "";
      let cleanAlias = rawText.toLowerCase().replace(/[\r\n,.-]+/g, " ").trim();
      if (cleanAlias.length > 25) cleanAlias = cleanAlias.slice(0, 25);

      if (cleanAlias && cleanAlias.length >= 3) {
        const safeK = toSafeFirebaseKey(cleanAlias);
        const rule = {
          alias: cleanAlias,
          name: pr.streetName,
          lat: p.lat,
          lng: p.lng,
          time: Date.now()
        };
        if (window.DNIPRO_STREETS_MAP) window.DNIPRO_STREETS_MAP[cleanAlias] = rule;
        fetch(FIREBASE_CUSTOM_URL.replace(".json", `/${safeK}.json`), {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rule)
        }).catch(() => {});
      }
    });

    window.pendingRelocation = null;
    window.isMovingEntireStack = false;

    const msg = isStack ? `✅ Перенесено всю стопку (${targets.length}) на: ${pr.streetName}` : `✅ Перенесено на: ${pr.streetName}`;
    if (typeof showToast === "function") showToast(msg, 3500);

    if (typeof renderMarkers === "function") renderMarkers();
    if (typeof renderTrafficLights === "function") renderTrafficLights();
  };

  // =========================================================================
  // 8. ЄДИНЕ ВІКНО ДІЙ ДЛЯ РОЗРОБНИКА З ПІДТРИМКОЮ СТОПКИ
  // =========================================================================
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

  window.isMovingEntireStack = false;

  window.openRelocateActionSheet = function (point, marker) {
    if (isSimpleMode()) return;

    purgeLegacyModals();

    const basePoint = point || resolveMarkerPoint(marker);
    const stackedPoints = getLivePointsFromAllPoints(marker, basePoint);

    window.activeActionMarker = marker;
    window.activeActionPoint = stackedPoints[0] || basePoint;
    window.activeStackedPoints = stackedPoints;
    window.isMovingEntireStack = false;

    let menu = document.getElementById("universalActionSheetModal");
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "universalActionSheetModal";
      menu.className = "action-sheet-backdrop";
      menu.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.75); z-index:9999999; display:flex; align-items:flex-end; justify-content:center; backdrop-filter:blur(3px);";
      menu.onclick = (e) => {
        if (e.target.id === "universalActionSheetModal") menu.style.display = "none";
      };

      menu.innerHTML = `
        <div class="action-sheet-card" style="background:#0f172a; border:1px solid #334155; border-radius:20px 20px 0 0; width:100%; max-width:440px; padding:18px; display:flex; flex-direction:column; gap:12px; box-shadow:0 -10px 30px rgba(0,0,0,0.85);" onclick="event.stopPropagation()">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding-bottom:8px;">
            <div style="font-size:13.5px; font-weight:900; color:#38bdf8; display:flex; align-items:center; gap:6px;">
              <span>🛠️ Дії з міткою</span>
              <span id="uActionStackBadge" style="display:none; background:#f59e0b; color:#000; font-size:10px; font-weight:900; padding:1px 6px; border-radius:10px;">Стопка</span>
              <button id="btnActionToggleAllStack" style="display:none; background:#1e293b; border:1px solid #f59e0b; color:#f59e0b; font-size:10px; font-weight:800; padding:2px 8px; border-radius:6px; cursor:pointer;" title="Перенести всі повідомлення з цієї стопки">
                📦 Всю стопку
              </button>
            </div>
            <span style="cursor:pointer; font-size:18px; color:#94a3b8; font-weight:800; padding:0 6px;" onclick="window.closeAllRelocateModals()">✕</span>
          </div>

          <div id="uActionStackSelectBox" style="display:none; flex-direction:column; gap:4px;">
            <div id="uActionStackTitle" style="font-size:10px; font-weight:800; color:#94a3b8;">ОБЕРІТЬ ПОВІДОМЛЕННЯ:</div>
            <div id="uActionStackList" style="max-height:120px; overflow-y:auto; display:flex; flex-direction:column; gap:4px;"></div>
          </div>

          <div id="uActionQuoteText" style="font-size:11px; color:#cbd5e1; background:#1e293b; padding:8px 10px; border-radius:8px; line-height:1.4; border-left:3px solid #38bdf8;">
            —
          </div>

          <div style="display:flex; flex-direction:column; gap:8px;">
            <button id="btnActionGoAddress" style="background:linear-gradient(135deg, #0284c7, #0369a1); border:none; color:#fff; padding:12px; border-radius:10px; font-size:12px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer;">
              <span id="btnActionGoAddressLabel">🔍 Перенести за адресою (навчити «мозок»)</span>
            </button>

            <button id="btnActionGoManual" style="background:#1e293b; border:1px solid #0284c7; color:#38bdf8; padding:12px; border-radius:10px; font-size:12px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer;">
              <span id="btnActionGoManualLabel">🎯 Перетягнути пальцем / мишкою</span>
            </button>

            <button onclick="window.closeAllRelocateModals()" style="background:transparent; border:1px solid #334155; color:#94a3b8; padding:10px; border-radius:10px; font-size:11.5px; font-weight:700; cursor:pointer; margin-top:4px;">
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
    const btnAllStack = document.getElementById("btnActionToggleAllStack");
    const stackBox = document.getElementById("uActionStackSelectBox");
    const stackList = document.getElementById("uActionStackList");
    const qEl = document.getElementById("uActionQuoteText");
    const lblAddr = document.getElementById("btnActionGoAddressLabel");
    const lblMan = document.getElementById("btnActionGoManualLabel");

    function renderUIState() {
      const currentStack = window.activeStackedPoints || [];
      const count = currentStack.length;

      if (window.isMovingEntireStack) {
        if (btnAllStack) {
          btnAllStack.style.background = "#f59e0b";
          btnAllStack.style.color = "#000";
          btnAllStack.innerText = `✅ Вся стопка (${count})`;
        }
        if (lblAddr) lblAddr.innerText = `🔍 Перенести ВСЮ стопку (${count}) за адресою`;
        if (lblMan) lblMan.innerText = `🎯 Перетягнути ВСЮ стопку (${count}) пальцем`;

        if (qEl) {
          qEl.style.borderLeftColor = "#f59e0b";
          qEl.innerHTML = `<b style="color:#f59e0b;">📦 Обрано ВСЮ стопку (${count} повідомлень):</b><br>Усі точки буде зміщено одночасно на нове місце!`;
        }

        if (stackList) {
          Array.from(stackList.children).forEach(c => {
            c.style.background = "rgba(245, 158, 11, 0.15)";
            c.style.borderColor = "#f59e0b";
          });
        }
      } else {
        if (btnAllStack) {
          btnAllStack.style.background = "#1e293b";
          btnAllStack.style.color = "#f59e0b";
          btnAllStack.innerText = `📦 Всю стопку`;
        }
        if (lblAddr) lblAddr.innerText = `🔍 Перенести за адресою (навчити «мозок»)`;
        if (lblMan) lblMan.innerText = `🎯 Перетягнути пальцем / мишкою`;

        const curP = window.activeActionPoint;
        const txt = curP ? (curP.text || curP.raw_text || curP.address || "Мітка") : "Мітка";
        if (qEl) {
          qEl.style.borderLeftColor = "#38bdf8";
          qEl.innerText = `«${txt}»`;
        }

        if (stackList) {
          Array.from(stackList.children).forEach((c, idx) => {
            const isCur = currentStack[idx] && curP && (currentStack[idx]._fbKey === curP._fbKey || currentStack[idx].text === curP.text);
            c.style.background = isCur ? "#1e293b" : "#0b1120";
            c.style.borderColor = isCur ? "#0284c7" : "#334155";
          });
        }
      }
    }

    if (btnAllStack) {
      btnAllStack.onclick = (e) => {
        e.stopPropagation();
        window.isMovingEntireStack = !window.isMovingEntireStack;
        renderUIState();
      };
    }

    if (stackedPoints.length > 1) {
      if (badge) {
        badge.innerText = `Стопка (${stackedPoints.length})`;
        badge.style.display = "inline-block";
      }
      if (btnAllStack) btnAllStack.style.display = "inline-block";
      if (stackBox) stackBox.style.display = "flex";

      if (stackList) {
        stackList.innerHTML = "";
        stackedPoints.forEach((pt, idx) => {
          const row = document.createElement("div");
          row.style.cssText = `background:#0b1120; border:1px solid #334155; padding:6px 8px; border-radius:6px; font-size:10.5px; color:#f1f5f9; cursor:pointer; transition:all 0.15s;`;
          row.innerText = `${idx + 1}. ${pt.text || pt.raw_text || "Повідомлення"}`;
          row.onclick = (e) => {
            e.stopPropagation();
            window.isMovingEntireStack = false;
            window.activeActionPoint = pt;
            renderUIState();
          };
          stackList.appendChild(row);
        });
      }
    } else {
      if (badge) badge.style.display = "none";
      if (btnAllStack) btnAllStack.style.display = "none";
      if (stackBox) stackBox.style.display = "none";
    }

    renderUIState();
    menu.style.display = "flex";
  };

  window.openMarkerActionSheet = function (point, marker) {
    if (isSimpleMode()) return;
    window.openRelocateActionSheet(point, marker);
  };
  window.openActionSheet = window.openRelocateActionSheet;

  // =========================================================================
  // 9. ДЕСКТОП-КЛІКИ (ТІЛЬКИ В РЕЖИМІ РОЗРОБНИКА)
  // =========================================================================
  function setupDesktopInteractions() {
    if (!window.map) return setTimeout(setupDesktopInteractions, 300);
    const mapContainer = window.map.getContainer();
    if (!mapContainer || mapContainer._desktopMouseHandled) return;
    mapContainer._desktopMouseHandled = true;

    function handleDesktopClickOnTarget(target) {
      if (isSimpleMode()) return;
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

    mapContainer.addEventListener("contextmenu", (e) => {
      if (isSimpleMode()) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.target.closest(".leaflet-marker-icon, .leaflet-interactive");
      if (target) handleDesktopClickOnTarget(target);
    }, true);

    mapContainer.addEventListener("mousedown", (e) => {
      if (isSimpleMode()) return;
      if (e.button === 1) {
        e.preventDefault();
        e.stopPropagation();
        const target = e.target.closest(".leaflet-marker-icon, .leaflet-interactive");
        if (target) handleDesktopClickOnTarget(target);
      }
    }, true);
  }
  setupDesktopInteractions();

  // =========================================================================
  // 10. РУЧНИЙ РЕЖИМ ПЕРЕТЯГУВАННЯ МІТКИ ТА СТОПКИ
  // =========================================================================
  let manualMovingMarker = null;
  let manualOriginalLatLng = null;
  let manualPointObj = null;

  window.startDirectManualDrag = function (pointOrFbKey, optionalMarker) {
    if (isSimpleMode()) return;

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

    const isStack = window.isMovingEntireStack && window.activeStackedPoints && window.activeStackedPoints.length > 1;
    const toastTxt = isStack
      ? `🎯 Перетягуйте мітку: змістяться всі ${window.activeStackedPoints.length} точок зі стопки!`
      : `🎯 Перетягуйте мітку вільно у потрібне місце дороги`;
    if (typeof showToast === "function") showToast(toastTxt, 3500);
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
        z-index: 9999999;
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
            <span id="manualDragHeaderTitle">🎯 Ручне перенесення</span>
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

    const titleEl = document.getElementById("manualDragHeaderTitle");
    if (titleEl) {
      titleEl.innerText = window.isMovingEntireStack ? `📦 Зсув всієї стопки` : `🎯 Ручне перенесення`;
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
    window.isMovingEntireStack = false;

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

    closeManualFloatingBar();

    if (manualMovingMarker.dragging) manualMovingMarker.dragging.disable();
    const el = manualMovingMarker.getElement ? manualMovingMarker.getElement() : (manualMovingMarker._icon || manualMovingMarker._path);
    if (el) el.classList.remove("marker-blinking-active");

    manualMovingMarker.off("drag");
    manualMovingMarker.off("dragend");

    const isStack = window.isMovingEntireStack && window.activeStackedPoints && window.activeStackedPoints.length > 1;
    const targets = isStack ? window.activeStackedPoints : (p ? [p] : []);

    let detectedStreet = detectOfficialStreetForPoint(p);

    targets.forEach(itemPt => {
      let targetFbKey = itemPt._fbKey;

      if (Array.isArray(window.allPoints)) {
        window.allPoints.forEach(item => {
          if (!item) return;
          if ((targetFbKey && item._fbKey === targetFbKey) || (itemPt.text && item.text === itemPt.text)) {
            item.lat = lat;
            item.lng = lng;
            item.geo_refined = true;
            item.needs_training = false;
            if (detectedStreet) item.address = detectedStreet;
          }
        });
      }

      itemPt.lat = lat;
      itemPt.lng = lng;
      itemPt.geo_refined = true;
      itemPt.needs_training = false;
      if (detectedStreet) itemPt.address = detectedStreet;

      if (targetFbKey) {
        fetch(FIREBASE_POINTS_URL.replace(".json", `/${targetFbKey}.json`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: lat,
            lng: lng,
            geo_refined: true,
            needs_training: false,
            ...(detectedStreet ? { address: detectedStreet } : {})
          })
        }).catch(() => {});
      }
    });

    if (detectedStreet) {
      await saveStreetCoordinateOverride(detectedStreet, lat, lng);
    }

    manualMovingMarker.setLatLng([lat, lng]);
    window.isManualDragActive = false;
    window.isMovingEntireStack = false;

    manualMovingMarker = null;
    manualPointObj = null;

    const toastMsg = isStack
      ? `✅ Зсунуто всю стопку (${targets.length} мітки): (${lat.toFixed(4)}, ${lng.toFixed(4)})`
      : `✅ Зсув збережено: (${lat.toFixed(4)}, ${lng.toFixed(4)})`;
    if (typeof showToast === "function") showToast(toastMsg, 4000);

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
