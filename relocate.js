/**
 * relocate.js — Модуль перенесення міток та калібрування вулиць v9.5
 * - Повний огляд карти без блюру при підтвердженні перенесення
 * - Точний пошук вулиць з DNIPRO_STREETS_MAP (як на головній карті)
 * - Виправлено відображення тексту цитати та назви вулиці
 * - Залізний ручний перенос із збереженням у Firebase та street_overrides
 */

(function () {
  const FIREBASE_POINTS_URL = window.FIREBASE_POINTS_URL || "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/points.json";
  const FIREBASE_OVERRIDES_URL = window.FIREBASE_OVERRIDES_URL || "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/street_overrides.json";

  function isSimpleMode() {
    return document.documentElement.classList.contains("mode-simple") ||
           localStorage.getItem("radar_ui_mode") === "simple";
  }

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
  // 1. ПОШУК ВУЛИЦЬ (ТОЧНО ЯК НА ГОЛОВНІЙ КАРТІ — ФОТО 3)
  // =========================================================================
  function searchLocalStreets(query) {
    const results = [];
    if (!query || typeof DNIPRO_STREETS_MAP === "undefined") return results;
    const q = query.toLowerCase().trim();

    for (const [key, item] of Object.entries(DNIPRO_STREETS_MAP)) {
      if (!item || !item.name || !item.lat || !item.lng) continue;
      const k = key.toLowerCase();
      const name = item.name.toLowerCase();
      const old = (item.old || "").toLowerCase();

      if (k.includes(q) || name.includes(q) || old.includes(q)) {
        if (!results.some(r => r.name.toLowerCase() === item.name.toLowerCase())) {
          const sub = item.old ? ` <span style="color:#94a3b8; font-size:10px;">(раніше: ${item.old})</span>` : "";
          results.push({
            name: item.name,
            lat: Number(item.lat),
            lng: Number(item.lng),
            label: `📍 <b>${item.name}</b>${sub}`
          });
        }
      }
      if (results.length >= 10) break;
    }
    return results;
  }

  // =========================================================================
  // 2. ЗБЕРЕЖЕННЯ В STREET_OVERRIDES
  // =========================================================================
  async function saveStreetCoordinateOverride(streetName, lat, lng) {
    if (!streetName || !lat || !lng) return;
    const cleanName = streetName.replace(/[\r\n]+/g, " ").trim();
    const safeKey = toSafeFirebaseKey(cleanName);
    const payload = {
      street: cleanName,
      name: cleanName,
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

    if (typeof window.loadCloudRules === "function") {
      window.loadCloudRules();
    }
  }

  function detectOfficialStreetForPoint(p) {
    if (!p) return null;
    const raw = (p.text || p.raw_text || p.address || "").replace(/[\r\n]+/g, " ").trim();
    if (!raw) return null;

    if (typeof DNIPRO_STREETS_MAP !== "undefined") {
      const lower = raw.toLowerCase();
      for (const [key, item] of Object.entries(DNIPRO_STREETS_MAP)) {
        if (!item || !item.name) continue;
        if (lower.includes(item.name.toLowerCase()) || lower.includes(key.toLowerCase()) || (item.old && lower.includes(item.old.toLowerCase()))) {
          return item.name;
        }
      }
    }
    const cleaned = raw.replace(/\b(чисто|норм|нормально|бп|блокпост|патруль|полиция|поліція|мусора|стоят|шмонают|зупиняють|\(чисто\))\b/gi, "").trim();
    return cleaned.length >= 3 ? cleaned : raw;
  }

  // =========================================================================
  // 3. ЗАКРИТТЯ ВІКОН
  // =========================================================================
  window.closeAllRelocateModals = function () {
    const ids = ["universalActionSheetModal", "relocateAddressModalCard", "confirmMoveBottomBar"];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
    const floating = document.getElementById("manualDragFloatingBar");
    if (floating && !window.isManualDragActive) floating.style.display = "none";
    if (window._tempPreviewMarker && window.map) {
      window.map.removeLayer(window._tempPreviewMarker);
      window._tempPreviewMarker = null;
    }
  };

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      window.closeAllRelocateModals();
      if (window.isManualDragActive) cancelManualDragMode();
    }
  });

  // =========================================================================
  // 4. МОДАЛЬНЕ ВІКНО «ПЕРЕНЕСТИ ЗА АДРЕСОЮ»
  // =========================================================================
  function ensureRelocateAddressModal() {
    let modal = document.getElementById("relocateAddressModalCard");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "relocateAddressModalCard";
      modal.className = "action-sheet-backdrop";
      modal.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:9999999; display:none; align-items:center; justify-content:center;";

      modal.innerHTML = `
        <div style="background:#0f172a; border:2px solid #0284c7; border-radius:18px; width:92%; max-width:420px; padding:16px; display:flex; flex-direction:column; gap:10px; box-shadow:0 0 25px rgba(2,132,199,0.4);" onclick="event.stopPropagation()">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding-bottom:8px;">
            <div style="font-size:13.5px; font-weight:900; color:#38bdf8; display:flex; align-items:center; gap:6px;">
              <span>📍 Переміщення за адресою</span>
            </div>
            <span id="modalCardCloseX" style="cursor:pointer; font-size:20px; color:#94a3b8; font-weight:800; padding:0 6px;">✕</span>
          </div>

          <div id="relocateModalQuote" style="font-size:11px; color:#cbd5e1; background:#1e293b; padding:8px 10px; border-radius:8px; border-left:3px solid #f59e0b; line-height:1.4;">
            —
          </div>

          <div style="position:relative; display:flex; gap:6px;">
            <input type="text" id="relocateModalInput" placeholder="Почніть вводити назву вулиці..." style="flex:1; background:#0b1120; border:1px solid #0284c7; color:#fff; padding:10px; border-radius:8px; font-size:12px; outline:none; box-sizing:border-box;">
            <button id="relocateModalFindBtn" style="background:#0284c7; border:none; color:#fff; font-size:11.5px; font-weight:800; padding:0 14px; border-radius:8px; cursor:pointer;">
              Знайти
            </button>
            <div id="relocateModalResultsBox" style="position:absolute; top:100%; left:0; width:100%; background:#0f172a; border:1.5px solid #0284c7; border-radius:8px; max-height:220px; overflow-y:auto; z-index:10005; display:none; margin-top:5px; box-shadow:0 10px 30px rgba(0,0,0,0.95);"></div>
          </div>

          <button id="relocateModalCancelBtn" style="background:transparent; border:1px solid #334155; color:#94a3b8; padding:8px; border-radius:8px; font-size:11px; font-weight:700; cursor:pointer; margin-top:2px;">
            Скасувати
          </button>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById("modalCardCloseX").onclick = () => { modal.style.display = "none"; };
      document.getElementById("relocateModalCancelBtn").onclick = () => { modal.style.display = "none"; };

      const input = document.getElementById("relocateModalInput");
      const btnFind = document.getElementById("relocateModalFindBtn");

      input.addEventListener("input", () => {
        executeSearchFlow(input.value.trim());
      });

      btnFind.onclick = () => {
        executeSearchFlow(input.value.trim());
      };
    }
    return modal;
  }

  function executeSearchFlow(query) {
    const box = document.getElementById("relocateModalResultsBox");
    if (!box) return;

    if (!query || query.length < 2) {
      box.style.display = "none";
      return;
    }

    const matches = searchLocalStreets(query);

    if (matches.length === 0) {
      box.innerHTML = `<div style="padding:10px; font-size:11.5px; color:#f87171;">Вулицю не знайдено. Введіть іншу назву.</div>`;
      box.style.display = "block";
      return;
    }

    box.innerHTML = "";
    matches.forEach(item => {
      const row = document.createElement("div");
      row.style.cssText = "padding:9px 12px; font-size:12px; color:#cbd5e1; cursor:pointer; border-bottom:1px solid #1e293b;";
      row.innerHTML = item.label;
      row.onmouseover = () => row.style.background = "#1e293b";
      row.onmouseout = () => row.style.background = "transparent";
      row.onclick = () => selectStreetForRelocation(item);
      box.appendChild(row);
    });
    box.style.display = "block";
  }

  window.openTrainingModal = function (point, marker) {
    if (isSimpleMode()) return;
    const modal = ensureRelocateAddressModal();
    window.activeActionPoint = point;
    window.activeActionMarker = marker;

    const quoteEl = document.getElementById("relocateModalQuote");
    const inputEl = document.getElementById("relocateModalInput");
    const resultsEl = document.getElementById("relocateModalResultsBox");

    // ПРАВИЛЬНЕ ВІДОБРАЖЕННЯ ЦИТАТИ (БЕЗ «\${txt}»)
    const rawText = point ? (point.text || point.raw_text || point.address || "Повідомлення") : "Повідомлення";
    if (quoteEl) {
      quoteEl.innerText = "«" + rawText + "»";
    }

    if (inputEl) {
      inputEl.value = "";
      setTimeout(() => inputEl.focus(), 120);
    }
    if (resultsEl) resultsEl.style.display = "none";

    modal.style.display = "flex";
  };

  // =========================================================================
  // 5. ПІДТВЕРДЖЕННЯ ПЕРЕНЕСЕННЯ: ПОВНИЙ ОГЛЯД КАРТИ БЕЗ БЛЮРУ (ФОТО 1 ВИПРАВЛЕНО)
  // =========================================================================
  function selectStreetForRelocation(streetObj) {
    const p = window.activeActionPoint;
    if (!p) return;

    // Закриваємо модалку пошуку, щоб повністю відкрити карту
    const searchModal = document.getElementById("relocateAddressModalCard");
    if (searchModal) searchModal.style.display = "none";

    const targetName = streetObj.name;

    window.pendingRelocation = {
      point: p,
      street: streetObj,
      targetLat: streetObj.lat,
      targetLng: streetObj.lng,
      streetName: targetName
    };

    // Ставимо тимчасовий маркер-маяк у місце перенесення
    if (window.map) {
      if (window._tempPreviewMarker) window.map.removeLayer(window._tempPreviewMarker);

      const beaconIcon = L.divIcon({
        className: 'preview-beacon-icon',
        html: `
          <div style="position:relative; width:28px; height:28px;">
            <div style="position:absolute; width:100%; height:100%; border-radius:50%; background:#00f3ff; opacity:0.8; animation:pulseGroupDanger 1.2s infinite;"></div>
            <div style="position:absolute; top:5px; left:5px; width:18px; height:18px; border-radius:50%; background:#0284c7; border:2.5px solid #fff; box-shadow:0 0 10px #00f3ff;"></div>
          </div>
        `,
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });

      window._tempPreviewMarker = L.marker([streetObj.lat, streetObj.lng], { icon: beaconIcon, zIndexOffset: 12000 }).addTo(window.map);
      // Камера летить на обране місце для вивчення дороги
      window.map.flyTo([streetObj.lat, streetObj.lng], 16.5, { animate: true, duration: 0.85 });
    }

    // КОМПАКТНА ПЛАШКА ВНИЗУ (ЖОДНОГО ЗАТЕМНЕННЯ ЧИ БЛЮРУ КАРТИ!)
    let bar = document.getElementById("confirmMoveBottomBar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "confirmMoveBottomBar";
      bar.style.cssText = `
        position: fixed;
        bottom: 25px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9999999;
        background: #0f172a;
        border: 2px solid #0284c7;
        border-radius: 14px;
        padding: 12px 14px;
        box-shadow: 0 10px 35px rgba(0,0,0,0.85);
        display: flex;
        flex-direction: column;
        gap: 8px;
        min-width: 310px;
        max-width: 92vw;
      `;
      document.body.appendChild(bar);
    }

    bar.innerHTML = `
      <div style="font-size:11.5px; color:#cbd5e1; line-height:1.4;">
        📍 Перенести мітку на офіційну вулицю:<br>
        <b style="color:#38bdf8; font-size:13px;">${targetName}</b>?
      </div>
      <div style="display:flex; gap:6px;">
        <button id="btnConfirmMoveAccept" style="flex:1.2; background:#0284c7; border:none; color:#fff; padding:9px; border-radius:8px; font-size:12px; font-weight:800; cursor:pointer;">
          ✅ Підтвердити
        </button>
        <button id="btnConfirmMoveCancel" style="flex:1; background:#334155; border:none; color:#94a3b8; padding:9px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer;">
          ↩️ Скасувати
        </button>
      </div>
    `;

    document.getElementById("btnConfirmMoveAccept").onclick = () => window.finalizeMoveConfirm(true);
    document.getElementById("btnConfirmMoveCancel").onclick = () => window.finalizeMoveConfirm(false);
    bar.style.display = "flex";
  }

  window.finalizeMoveConfirm = async function (isApproved) {
    const bar = document.getElementById("confirmMoveBottomBar");
    if (bar) bar.style.display = "none";

    if (window._tempPreviewMarker && window.map) {
      window.map.removeLayer(window._tempPreviewMarker);
      window._tempPreviewMarker = null;
    }

    const pr = window.pendingRelocation;
    if (!pr) return;

    if (!isApproved) {
      window.pendingRelocation = null;
      if (typeof showToast === "function") showToast("↩️ Перенесення скасовано");
      return;
    }

    const p = pr.point;
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

    // Завжди фіксуємо сдвиг у street_overrides
    await saveStreetCoordinateOverride(pr.streetName, p.lat, p.lng);

    window.pendingRelocation = null;
    if (typeof showToast === "function") showToast(`✅ Перенесено на: «${pr.streetName}»`, 3500);

    if (typeof renderMarkers === "function") renderMarkers();
    if (typeof renderTrafficLights === "function") renderTrafficLights();
  };

  // =========================================================================
  // 6. ЄДИНЕ МЕНЮ ДІЙ
  // =========================================================================
  function resolveMarkerPoint(marker) {
    if (!marker) return null;
    if (marker.pointData && marker.pointData.lat) return marker.pointData;

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
      if (best && minD < 100) return best;
    }
    return null;
  }

  window.openRelocateActionSheet = function (point, marker) {
    if (isSimpleMode()) return;
    window.closeAllRelocateModals();

    const basePoint = point || resolveMarkerPoint(marker);
    if (!basePoint) return;

    window.activeActionMarker = marker;
    window.activeActionPoint = basePoint;

    let menu = document.getElementById("universalActionSheetModal");
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "universalActionSheetModal";
      menu.className = "action-sheet-backdrop";
      menu.style.cssText = "position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:9999999; display:flex; align-items:flex-end; justify-content:center;";
      menu.onclick = (e) => {
        if (e.target.id === "universalActionSheetModal") menu.style.display = "none";
      };

      menu.innerHTML = `
        <div class="action-sheet-card" style="background:#0f172a; border:1px solid #334155; border-radius:20px 20px 0 0; width:100%; max-width:440px; padding:18px; display:flex; flex-direction:column; gap:12px; box-shadow:0 -10px 30px rgba(0,0,0,0.85);" onclick="event.stopPropagation()">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding-bottom:8px;">
            <div style="font-size:13.5px; font-weight:900; color:#38bdf8; display:flex; align-items:center; gap:6px;">
              <span>🛠️ Дії з міткою</span>
            </div>
            <span style="cursor:pointer; font-size:18px; color:#94a3b8; font-weight:800; padding:0 6px;" onclick="window.closeAllRelocateModals()">✕</span>
          </div>

          <div id="uActionQuoteText" style="font-size:11px; color:#cbd5e1; background:#1e293b; padding:8px 10px; border-radius:8px; line-height:1.4; border-left:3px solid #38bdf8;">
            —
          </div>

          <div style="display:flex; flex-direction:column; gap:8px;">
            <button id="btnActionGoAddress" style="background:linear-gradient(135deg, #0284c7, #0369a1); border:none; color:#fff; padding:12px; border-radius:10px; font-size:12px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer;">
              <span>🔍 Перенести за адресою</span>
            </button>

            <button id="btnActionGoManual" style="background:#1e293b; border:1px solid #0284c7; color:#38bdf8; padding:12px; border-radius:10px; font-size:12px; font-weight:800; display:flex; align-items:center; justify-content:center; gap:8px; cursor:pointer;">
              <span>🎯 Перетягнути пальцем / мишкою</span>
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

    const qEl = document.getElementById("uActionQuoteText");
    const txt = basePoint.text || basePoint.raw_text || basePoint.address || "Повідомлення";
    if (qEl) qEl.innerText = "«" + txt + "»";

    menu.style.display = "flex";
  };

  window.openMarkerActionSheet = window.openRelocateActionSheet;
  window.openActionSheet = window.openRelocateActionSheet;

  // =========================================================================
  // 7. РУЧНИЙ ПЕРЕНОС ПАЛЬЦЕМ (ФІКСАЦІЯ НАЗАВЖДИ БЕЗ ЗЛІТАНЬ)
  // =========================================================================
  let manualMovingMarker = null;
  let manualPointObj = null;

  window.startDirectManualDrag = function (pointOrFbKey, optionalMarker) {
    if (isSimpleMode()) return;

    let p = null;
    let m = optionalMarker;

    if (typeof pointOrFbKey === "string") {
      p = (window.allPoints || []).find(x => x._fbKey === pointOrFbKey);
    } else if (typeof pointOrFbKey === "object" && pointOrFbKey !== null) {
      p = pointOrFbKey;
    }

    if (!p && window.activeActionPoint) p = window.activeActionPoint;

    if (!m && window.map && p) {
      let minDist = Infinity;
      window.map.eachLayer(l => {
        if (l instanceof L.Marker && l.getLatLng) {
          const d = l.getLatLng().distanceTo([p.lat, p.lng]);
          if (d < minDist && d < 80) {
            minDist = d;
            m = l;
          }
        }
      });
    }

    if (!m) {
      if (typeof showToast === "function") showToast("⚠️ Маркер не знайдено на карті");
      return;
    }

    manualMovingMarker = m;
    manualPointObj = p;

    if (m.closePopup) m.closePopup();
    if (m.dragging) m.dragging.enable();

    window.isManualDragActive = true;
    showManualDragFloatingBar(m.getLatLng().lat, m.getLatLng().lng);

    m.off("drag");
    m.on("drag", () => {
      const cur = m.getLatLng();
      const el = document.getElementById("manualDragLiveCoords");
      if (el) el.innerText = `${cur.lat.toFixed(5)}, ${cur.lng.toFixed(5)}`;
    });

    if (typeof showToast === "function") showToast("🎯 Тягніть мітку пальцем у потрібне місце дороги", 3500);
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
          <div style="font-size:12px; font-weight:900; color:#38bdf8;">
            🎯 Ручне перенесення
          </div>
          <div id="manualDragLiveCoords" style="font-family:monospace; font-size:11px; color:#38bdf8; background:#1e293b; padding:2px 6px; border-radius:5px;">
            ${lat.toFixed(5)}, ${lng.toFixed(5)}
          </div>
        </div>
        <div style="display:flex; gap:6px;">
          <button id="btnConfirmManualDrag" style="flex:1.3; background:#0284c7; border:none; color:#fff; font-size:12px; font-weight:900; padding:8px 4px; border-radius:7px; cursor:pointer;">
            💾 Підтвердити
          </button>
          <button id="btnCancelManualDrag" style="flex:1; background:#334155; border:none; color:#94a3b8; font-size:11px; font-weight:700; padding:8px 4px; border-radius:7px; cursor:pointer;">
            ↩️ Скасувати
          </button>
        </div>
      `;
      document.body.appendChild(bar);

      document.getElementById("btnConfirmManualDrag").onclick = finishManualDragSuccess;
      document.getElementById("btnCancelManualDrag").onclick = cancelManualDragMode;
    } else {
      const el = document.getElementById("manualDragLiveCoords");
      if (el) el.innerText = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      bar.style.display = "flex";
    }
  }

  function cancelManualDragMode() {
    const bar = document.getElementById("manualDragFloatingBar");
    if (bar) bar.style.display = "none";
    window.isManualDragActive = false;
    if (manualMovingMarker && manualMovingMarker.dragging) {
      manualMovingMarker.dragging.disable();
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

    const bar = document.getElementById("manualDragFloatingBar");
    if (bar) bar.style.display = "none";
    if (manualMovingMarker.dragging) manualMovingMarker.dragging.disable();

    window.isManualDragActive = false;

    let streetName = detectOfficialStreetForPoint(p);

    if (p) {
      p.lat = lat;
      p.lng = lng;
      p.geo_refined = true;
      p.needs_training = false;
      if (streetName) p.address = streetName;

      if (Array.isArray(window.allPoints)) {
        window.allPoints.forEach(item => {
          if (!item) return;
          if ((p._fbKey && item._fbKey === p._fbKey) || (p.text && item.text === p.text)) {
            item.lat = lat;
            item.lng = lng;
            item.geo_refined = true;
            item.needs_training = false;
            if (streetName) item.address = streetName;
          }
        });
      }

      // Зберігаємо змінені координати конкретного повідомлення у Firebase
      if (p._fbKey) {
        fetch(FIREBASE_POINTS_URL.replace(".json", `/${p._fbKey}.json`), {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: lat,
            lng: lng,
            geo_refined: true,
            needs_training: false,
            ...(streetName ? { address: streetName } : {})
          })
        }).catch(() => {});
      }
    }

    // Завжди фіксуємо сдвиг вулиці у street_overrides.json для пам'яті
    if (streetName) {
      await saveStreetCoordinateOverride(streetName, lat, lng);
    }

    manualMovingMarker.setLatLng([lat, lng]);
    manualMovingMarker = null;
    manualPointObj = null;

    if (typeof showToast === "function") showToast(`✅ Зсув збережено: «${streetName || 'Вулиця'}»`, 3500);
    if (typeof renderMarkers === "function") renderMarkers();
    if (typeof renderTrafficLights === "function") renderTrafficLights();
  }

})();
