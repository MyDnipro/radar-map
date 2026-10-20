/**
 * memory.js — Модуль бази знань, синонімів та калібрування вулиць v10.6
 * Реалізує:
 * - Збереження синонімів (custom_streets.json)
 * - Синхронізацію зміщених координат (street_overrides.json)
 * - Автоматичне навчання при перенесенні міток
 * - Повний захист від XSS та авторизацію Firebase (auth=)
 */

(function () {
  const BASE_URL = (window.FIREBASE_POINTS_URL || "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/points.json")
    .replace("/points.json", "")
    .replace(".json", "");

  const FIREBASE_CUSTOM_STREETS_URL = `${BASE_URL}/custom_streets.json`;
  const FIREBASE_OVERRIDES_URL = `${BASE_URL}/street_overrides.json`;

  let customStreetsCache = {};
  let streetOverridesCache = {};
  let activeTab = "synonyms";

  function escapeHtml(str) {
    if (typeof window.escapeHtml === "function") return window.escapeHtml(str);
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function appendAuth(url) {
    if (typeof window.appendAuth === "function") return window.appendAuth(url);
    const authKey = localStorage.getItem("radar_fb_auth") || "";
    if (!authKey) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}auth=${encodeURIComponent(authKey)}`;
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

  // 1. АВТОМАТИЧНИЙ ЗАПИС СИНОНІМА ПРИ ПЕРЕНЕСЕННІ МІТКИ
  window.saveMemorySynonymFromRelocate = async function (rawMsg, officialStreetName, lat, lng) {
    if (!rawMsg || !officialStreetName || !lat || !lng) return;

    // Очищення тексту від службових слів для отримання чистого орієнтира
    let cleanPhrase = rawMsg
      .replace(/[\r\n]+/g, " ")
      .replace(/[,\.!\?\(\)\[\]«»"']/g, " ")
      .replace(/\b(чисто|чистенько|пусто|вільно|спокійно|спокойно|проїзд|проїхав|проехали|норм|нормально|бп|блокпост|патруль|полиция|поліція|мусора|стоят|шмонают|зупиняють|роздають|пишуть|хмари|дощ|гроза|сонце|сонечко|без\s*ям|без\s*бп|нет\s*бп)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    if (cleanPhrase.length < 3) cleanPhrase = rawMsg.trim();
    if (cleanPhrase.length < 3) return;

    const safeKey = toSafeFirebaseKey(cleanPhrase);
    const payload = {
      phrase: cleanPhrase,
      name: officialStreetName,
      lat: Number(Number(lat).toFixed(5)),
      lng: Number(Number(lng).toFixed(5)),
      updated_at: Date.now()
    };

    customStreetsCache[safeKey] = payload;
    try {
      localStorage.setItem("radar_custom_streets", JSON.stringify(customStreetsCache));
    } catch (e) {}

    try {
      const url = appendAuth(`${BASE_URL}/custom_streets/${safeKey}.json`);
      await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.warn("Помилка запису синоніма в Firebase:", e);
    }
  };

  // 2. УМНИЙ РЕЗОЛВЕР ЛОКАЦІЙ (Зчитує пам'ять -> зміщення -> карту міста)
  window.resolveLocationFromText = function (text) {
    if (!text || typeof text !== "string") return null;
    const lower = (" " + text.toLowerCase().replace(/[\r\n]+/g, " ").replace(/ё/g, "е") + " ");

    // А. Перевірка каліброваних зсувів координат
    for (const item of Object.values(streetOverridesCache)) {
      if (!item || !item.street || !item.lat || !item.lng) continue;
      const stName = item.street.toLowerCase().replace(/ё/g, "е");
      if (stName.length >= 3 && lower.includes(stName)) {
        return { name: item.street, lat: item.lat, lng: item.lng };
      }
    }

    // Б. Перевірка бази синонімів («Мозку»)
    for (const item of Object.values(customStreetsCache)) {
      if (!item || !item.phrase || !item.lat || !item.lng) continue;
      const phr = item.phrase.toLowerCase().replace(/ё/g, "е");
      if (phr.length >= 3 && lower.includes(phr)) {
        return { name: item.name || item.phrase, lat: item.lat, lng: item.lng };
      }
    }

    // В. Перевірка офіційної бази Дніпра (streets.js)
    if (typeof DNIPRO_STREETS_MAP !== "undefined") {
      for (const [key, item] of Object.entries(DNIPRO_STREETS_MAP)) {
        if (!item || !item.lat || !item.lng) continue;
        const k = key.toLowerCase();
        const n = (item.name || "").toLowerCase();
        const o = (item.old || "").toLowerCase();

        if (lower.includes(k) || (n && lower.includes(n)) || (o && lower.includes(o))) {
          return { name: item.name || key, lat: item.lat, lng: item.lng };
        }
      }
    }

    return null;
  };

  // 3. ЗАВАНТАЖЕННЯ ДАНИХ З ХМАРИ ТА КЕШУ
  window.loadCloudRules = async function () {
    try {
      const localCustom = localStorage.getItem("radar_custom_streets");
      if (localCustom) customStreetsCache = JSON.parse(localCustom);
      const localOverrides = localStorage.getItem("radar_street_overrides");
      if (localOverrides) streetOverridesCache = JSON.parse(localOverrides);
    } catch (e) {}

    try {
      const resStreets = await fetch(`${FIREBASE_CUSTOM_STREETS_URL}?t=${Date.now()}`);
      if (resStreets.ok) {
        const data = await resStreets.json();
        if (data && typeof data === "object") {
          customStreetsCache = data;
          localStorage.setItem("radar_custom_streets", JSON.stringify(data));
        }
      }

      const resOverrides = await fetch(`${FIREBASE_OVERRIDES_URL}?t=${Date.now()}`);
      if (resOverrides.ok) {
        const data = await resOverrides.json();
        if (data && typeof data === "object") {
          streetOverridesCache = data;
          localStorage.setItem("radar_street_overrides", JSON.stringify(data));
          
          if (typeof DNIPRO_STREETS_MAP !== "undefined") {
            Object.values(data).forEach(ov => {
              if (ov && ov.street && ov.lat && ov.lng) {
                for (const item of Object.values(DNIPRO_STREETS_MAP)) {
                  if (item && item.name && item.name.toLowerCase() === ov.street.toLowerCase()) {
                    item.lat = ov.lat;
                    item.lng = ov.lng;
                    item._isOverridden = true;
                  }
                }
              }
            });
          }
        }
      }
    } catch (e) {
      console.warn("Помилка синхронізації пам'яті:", e);
    }

    renderRulesList();
  };

  // 4. ГРАФІЧНИЙ ІНТЕРФЕЙС КЕРУВАННЯ БАЗОЮ ЗНАНЬ
  function ensureMemoryWidget() {
    let widget = document.getElementById("memWidget");
    if (!widget) {
      widget = document.createElement("button");
      widget.id = "memWidget";
      widget.title = "База знань ШІ / Синоніми вулиць";
      widget.style.cssText = `
        position: fixed;
        bottom: 74px;
        left: 14px;
        z-index: 2400;
        background: #0f172a;
        border: 1.5px solid #0284c7;
        color: #38bdf8;
        border-radius: 12px;
        padding: 6px 11px;
        font-size: 11.5px;
        font-weight: 800;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.5);
        user-select: none;
        transition: all 0.2s;
      `;
      widget.innerHTML = `<span>🧠 База знань</span>`;
      widget.onclick = openMemoryModal;
      document.body.appendChild(widget);
    }
  }

  function ensureMemoryModal() {
    let modal = document.getElementById("memoryModalCard");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "memoryModalCard";
      modal.className = "action-sheet-backdrop";
      modal.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.7);
        z-index: 9999999;
        display: none;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(4px);
      `;

      modal.innerHTML = `
        <div style="background:#0f172a; border:2px solid #00f3ff; border-radius:18px; width:94%; max-width:520px; max-height:86vh; padding:16px; display:flex; flex-direction:column; gap:10px; box-shadow:0 0 30px rgba(0,243,255,0.25);" onclick="event.stopPropagation()">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding-bottom:8px;">
            <div style="font-size:14px; font-weight:900; color:#00f3ff; display:flex; align-items:center; gap:6px;">
              <span>🧠 База знань та пам'ять вулиць</span>
            </div>
            <span id="memCloseBtn" style="cursor:pointer; font-size:20px; color:#94a3b8; font-weight:800; padding:0 6px;">✕</span>
          </div>

          <div style="display:flex; gap:6px; background:#0b1120; padding:4px; border-radius:10px; border:1px solid #1e293b;">
            <button id="memTabSynonyms" style="flex:1; background:#0284c7; border:none; color:#fff; padding:7px; border-radius:7px; font-size:11px; font-weight:800; cursor:pointer;">
              📖 Синоніми («Мозок»)
            </button>
            <button id="memTabOverrides" style="flex:1; background:transparent; border:none; color:#94a3b8; padding:7px; border-radius:7px; font-size:11px; font-weight:800; cursor:pointer;">
              📍 Калібровані зсуви
            </button>
          </div>

          <!-- Форма швидкого додавання синоніма -->
          <div id="memAddForm" style="display:flex; flex-direction:column; gap:6px; background:#0b1120; padding:10px; border-radius:10px; border:1px solid #1e293b;">
            <div style="font-size:11px; font-weight:800; color:#38bdf8;">➕ Додати правило в пам'ять:</div>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <input type="text" id="memInputPhrase" placeholder="Фраза в пості (напр. варус тополь)" style="flex:1; min-width:140px; background:#060913; border:1px solid #334155; color:#fff; padding:7px 9px; border-radius:6px; font-size:11px; outline:none;">
              <div style="position:relative; flex:1; min-width:140px;">
                <input type="text" id="memInputTarget" placeholder="Куди вести (офіційна вул.)" style="width:100%; box-sizing:border-box; background:#060913; border:1px solid #334155; color:#fff; padding:7px 9px; border-radius:6px; font-size:11px; outline:none;">
                <div id="memTargetSuggest" style="position:absolute; top:100%; left:0; width:100%; background:#0f172a; border:1.5px solid #0284c7; border-radius:6px; max-height:160px; overflow-y:auto; z-index:10; display:none; margin-top:3px; box-shadow:0 8px 20px rgba(0,0,0,0.9);"></div>
              </div>
            </div>
            <button id="memBtnSaveRule" style="background:#0284c7; border:none; color:#fff; padding:8px; border-radius:6px; font-size:11px; font-weight:800; cursor:pointer;">
              💾 Запам'ятати правило
            </button>
          </div>

          <!-- Список правил зі скролом -->
          <div id="memRulesList" style="flex:1; overflow-y:auto; max-height:42vh; display:flex; flex-direction:column; gap:6px; padding-right:3px;"></div>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById("memCloseBtn").onclick = () => { modal.style.display = "none"; };
      modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

      const tabSyn = document.getElementById("memTabSynonyms");
      const tabOvr = document.getElementById("memTabOverrides");
      const addForm = document.getElementById("memAddForm");

      tabSyn.onclick = () => {
        activeTab = "synonyms";
        tabSyn.style.background = "#0284c7"; tabSyn.style.color = "#fff";
        tabOvr.style.background = "transparent"; tabOvr.style.color = "#94a3b8";
        addForm.style.display = "flex";
        renderRulesList();
      };

      tabOvr.onclick = () => {
        activeTab = "overrides";
        tabOvr.style.background = "#0284c7"; tabOvr.style.color = "#fff";
        tabSyn.style.background = "transparent"; tabSyn.style.color = "#94a3b8";
        addForm.style.display = "none";
        renderRulesList();
      };

      setupTargetStreetAutocomplete();
      document.getElementById("memBtnSaveRule").onclick = handleManualRuleSave;
    }
    return modal;
  }

  function setupTargetStreetAutocomplete() {
    const input = document.getElementById("memInputTarget");
    const suggest = document.getElementById("memTargetSuggest");
    if (!input || !suggest) return;

    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (q.length < 2 || typeof DNIPRO_STREETS_MAP === "undefined") {
        suggest.style.display = "none";
        return;
      }

      suggest.innerHTML = "";
      const matches = [];

      for (const item of Object.values(DNIPRO_STREETS_MAP)) {
        if (!item || !item.name) continue;
        const name = item.name.toLowerCase();
        const old = (item.old || "").toLowerCase();
        if (name.includes(q) || old.includes(q)) {
          if (!matches.some(m => m.name === item.name)) {
            matches.push(item);
          }
        }
        if (matches.length >= 7) break;
      }

      if (matches.length === 0) {
        suggest.style.display = "none";
        return;
      }

      matches.forEach(item => {
        const row = document.createElement("div");
        row.style.cssText = "padding:7px 10px; font-size:11px; color:#cbd5e1; cursor:pointer; border-bottom:1px solid #1e293b;";
        const oldNote = item.old ? ` <span style="color:#64748b; font-size:9.5px;">(${escapeHtml(item.old)})</span>` : "";
        row.innerHTML = `📍 <b>${escapeHtml(item.name)}</b>${oldNote}`;
        row.onmouseover = () => row.style.background = "#1e293b";
        row.onmouseout = () => row.style.background = "transparent";
        row.onclick = () => {
          input.value = item.name;
          input._selectedCoords = { lat: item.lat, lng: item.lng };
          suggest.style.display = "none";
        };
        suggest.appendChild(row);
      });
      suggest.style.display = "block";
    });
  }

  async function handleManualRuleSave() {
    const pInput = document.getElementById("memInputPhrase");
    const tInput = document.getElementById("memInputTarget");
    const phrase = pInput.value.trim();
    const target = tInput.value.trim();

    if (phrase.length < 2 || target.length < 2) {
      alert("Вкажіть фразу повідомлення та цільову вулицю");
      return;
    }

    let lat = null, lng = null;
    if (tInput._selectedCoords) {
      lat = tInput._selectedCoords.lat;
      lng = tInput._selectedCoords.lng;
    } else if (typeof DNIPRO_STREETS_MAP !== "undefined") {
      for (const item of Object.values(DNIPRO_STREETS_MAP)) {
        if (item && item.name && item.name.toLowerCase() === target.toLowerCase()) {
          lat = item.lat; lng = item.lng; break;
        }
      }
    }

    if (!lat || !lng) {
      alert("Не вдалося визначити координати цільової вулиці. Виберіть її зі списку підказок!");
      return;
    }

    await window.saveMemorySynonymFromRelocate(phrase, target, lat, lng);
    pInput.value = "";
    tInput.value = "";
    tInput._selectedCoords = null;
    renderRulesList();
    if (typeof showToast === "function") showToast(`🧠 Правило додано: «${escapeHtml(phrase)}» ➔ ${escapeHtml(target)}`);
  }

  function renderRulesList() {
    const box = document.getElementById("memRulesList");
    if (!box) return;
    box.innerHTML = "";

    if (activeTab === "synonyms") {
      const items = Object.entries(customStreetsCache);
      if (items.length === 0) {
        box.innerHTML = `<div style="padding:15px; text-align:center; font-size:11.5px; color:#64748b;">База синонімів поки порожня. Переміщуйте мітки на карті або додавайте правила вручну!</div>`;
        return;
      }

      items.reverse().forEach(([key, item]) => {
        const card = document.createElement("div");
        card.style.cssText = "background:#060913; border:1px solid #1e293b; border-left:3.5px solid #00f3ff; border-radius:7px; padding:8px 10px; display:flex; justify-content:space-between; align-items:center;";
        card.innerHTML = `
          <div style="line-height:1.35;">
            <div style="font-size:11.5px; font-weight:800; color:#f8fafc;">
              «${escapeHtml(item.phrase || key)}» ➔ <span style="color:#38bdf8;">${escapeHtml(item.name || 'Вулиця')}</span>
            </div>
            <div style="font-size:9.5px; color:#64748b; font-family:monospace; margin-top:2px;">
              lat: ${item.lat}, lng: ${item.lng}
            </div>
          </div>
          <button style="background:transparent; border:1px solid #7f1d1d; color:#f87171; padding:4px 7px; border-radius:5px; font-size:10px; font-weight:800; cursor:pointer;" onclick="window.deleteMemoryRule('${key}')">
            🗑️
          </button>
        `;
        box.appendChild(card);
      });
    } else {
      const items = Object.entries(streetOverridesCache);
      if (items.length === 0) {
        box.innerHTML = `<div style="padding:15px; text-align:center; font-size:11.5px; color:#64748b;">Немає зміщених вулиць. Усі точки використовують заводські координати.</div>`;
        return;
      }

      items.forEach(([key, item]) => {
        const card = document.createElement("div");
        card.style.cssText = "background:#060913; border:1px solid #1e293b; border-left:3.5px solid #f59e0b; border-radius:7px; padding:8px 10px; display:flex; justify-content:space-between; align-items:center;";
        card.innerHTML = `
          <div style="line-height:1.35;">
            <div style="font-size:11.5px; font-weight:800; color:#fbbf24;">
              📍 ${escapeHtml(item.street || item.name || key)}
            </div>
            <div style="font-size:9.5px; color:#64748b; font-family:monospace; margin-top:2px;">
              Зсунуто на: ${item.lat}, ${item.lng}
            </div>
          </div>
          <button style="background:transparent; border:1px solid #334155; color:#94a3b8; padding:4px 7px; border-radius:5px; font-size:10px; font-weight:800; cursor:pointer;" onclick="window.resetStreetOverride('${key}', '${escapeHtml(item.street || item.name)}')">
            🔄 Скинути
          </button>
        `;
        box.appendChild(card);
      });
    }
  }

  window.deleteMemoryRule = async function (key) {
    if (!confirm("Видалити це правило з пам'яті ШІ?")) return;
    delete customStreetsCache[key];
    try {
      localStorage.setItem("radar_custom_streets", JSON.stringify(customStreetsCache));
      const url = appendAuth(`${BASE_URL}/custom_streets/${key}.json`);
      await fetch(url, { method: "DELETE" });
    } catch (e) {}
    renderRulesList();
    if (typeof showToast === "function") showToast("🗑️ Правило видалено");
  };

  window.resetStreetOverride = async function (key, streetName) {
    if (!confirm(`Скинути зміщення координат для «${streetName}» до заводських значень?`)) return;
    delete streetOverridesCache[key];
    try {
      localStorage.setItem("radar_street_overrides", JSON.stringify(streetOverridesCache));
      const url = appendAuth(`${FIREBASE_OVERRIDES_URL.replace(".json", `/\${key}.json`)}`);
      await fetch(url, { method: "DELETE" });
    } catch (e) {}
    renderRulesList();
    if (typeof showToast === "function") showToast("🔄 Координати скинуто до заводських");
  };

  function openMemoryModal() {
    const modal = ensureMemoryModal();
    renderRulesList();
    modal.style.display = "flex";
  }

  // СТАРТ МОДУЛЯ
  ensureMemoryWidget();
  window.loadCloudRules();

})();
