/**
 * memory.js — Модуль бази знань, синонімів та калібрування вулиць v10.9
 * - Виправлено вирівнювання та прибрано відволікаючий блок останніх правил
 * - Додано лічильник загальної кількості правил у швидкому вікні
 * - Сортування: найсвіжіші записи завжди зверху (за часом, а не за алфавітом)
 */

(function () {
  const BASE_URL = (window.FIREBASE_POINTS_URL || "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/points.json")
    .replace("/points.json", "")
    .replace(".json", "");

  const FIREBASE_CUSTOM_STREETS_URL = `${BASE_URL}/custom_streets.json`;
  const FIREBASE_OVERRIDES_URL = `${BASE_URL}/street_overrides.json`;

  let customStreetsCache = {};
  let streetOverridesCache = {};
  let fullModalActiveTab = "synonyms";
  let editingSynonymKey = null;

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

    updateQuickModalUI();
    renderFullRulesList();
  };

  // 2. РЕЗОЛВЕР ЛОКАЦІЙ (Пам'ять -> Зміщення -> База міста)
  window.resolveLocationFromText = function (text) {
    if (!text || typeof text !== "string") return null;
    const lower = (" " + text.toLowerCase().replace(/[\r\n]+/g, " ").replace(/ё/g, "е") + " ");

    for (const item of Object.values(streetOverridesCache)) {
      if (!item || !item.street || !item.lat || !item.lng) continue;
      const stName = item.street.toLowerCase().replace(/ё/g, "е");
      if (stName.length >= 3 && lower.includes(stName)) {
        return { name: item.street, lat: item.lat, lng: item.lng };
      }
    }

    for (const item of Object.values(customStreetsCache)) {
      if (!item || !item.phrase || !item.lat || !item.lng) continue;
      const phr = item.phrase.toLowerCase().replace(/ё/g, "е");
      if (phr.length >= 3 && lower.includes(phr)) {
        return { name: item.name || item.phrase, lat: item.lat, lng: item.lng };
      }
    }

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

  // 3. СИНХРОНІЗАЦІЯ З ХМАРОЮ
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

    updateQuickModalUI();
    renderFullRulesList();
  };

  // =========================================================================
  // 4. РІВЕНЬ 1: КОМПАКТНЕ ВІКНО ШВИДКИХ СИНОНІМІВ З ЛІЧИЛЬНИКОМ
  // =========================================================================
  function ensureQuickModal() {
    let modal = document.getElementById("quickSynonymModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "quickSynonymModal";
      modal.className = "action-sheet-backdrop";
      modal.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        z-index: 9999999;
        display: none;
        align-items: center;
        justify-content: center;
        backdrop-filter: blur(3px);
      `;

      modal.innerHTML = `
        <div style="background:#0f172a; border:2px solid #0284c7; border-radius:18px; width:92%; max-width:390px; padding:15px; display:flex; flex-direction:column; gap:11px; box-shadow:0 10px 30px rgba(0,0,0,0.85);" onclick="event.stopPropagation()">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid #1e293b; padding-bottom:7px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:13.5px; font-weight:900; color:#38bdf8;">🧠 Швидкі синоніми</span>
              <span id="quickRulesCountBadge" style="font-size:10.5px; font-weight:800; color:#00f3ff; background:#0b1120; border:1px solid #0284c7; padding:1px 7px; border-radius:9px;">0 правил</span>
            </div>
            <span id="quickModalCloseBtn" style="cursor:pointer; font-size:19px; color:#94a3b8; font-weight:800; padding:0 6px;">✕</span>
          </div>

          <!-- Форма швидкого додавання -->
          <div style="display:flex; flex-direction:column; gap:6px; background:#0b1120; padding:10px; border-radius:10px; border:1px solid #1e293b;">
            <div style="font-size:11px; font-weight:800; color:#cbd5e1;">➕ Прив'язати орієнтир:</div>
            <input type="text" id="quickInputPhrase" placeholder="Фраза в пості (напр. каштанова)" style="background:#060913; border:1px solid #334155; color:#fff; padding:7px 9px; border-radius:6px; font-size:11.5px; outline:none;">
            <div style="position:relative;">
              <input type="text" id="quickInputTarget" placeholder="Офіційна назва вулиці..." style="width:100%; box-sizing:border-box; background:#060913; border:1px solid #334155; color:#fff; padding:7px 9px; border-radius:6px; font-size:11.5px; outline:none;">
              <div id="quickTargetSuggest" style="position:absolute; top:100%; left:0; width:100%; background:#0f172a; border:1.5px solid #0284c7; border-radius:6px; max-height:140px; overflow-y:auto; z-index:10010; display:none; margin-top:2px; box-shadow:0 8px 20px rgba(0,0,0,0.95);"></div>
            </div>
            <button id="quickBtnSave" style="background:#0284c7; border:none; color:#fff; padding:8px; border-radius:6px; font-size:11.5px; font-weight:800; cursor:pointer;">
              💾 Запам'ятати синонім
            </button>
          </div>

          <!-- КНОПКА ПЕРЕХОДУ В ПОВНУ БАЗУ ЗНАНЬ НА ВЕСЬ ЕКРАН -->
          <button id="quickBtnOpenFull" style="width:100%; background:linear-gradient(135deg, #0284c7 0%, #00f3ff 100%); border:none; color:#04101e; padding:10px; border-radius:9px; font-size:12px; font-weight:900; cursor:pointer; margin-top:2px; box-shadow:0 0 16px rgba(0,243,255,0.4); transition:transform 0.15s ease;">
            📖 Відкрити всю базу знань ➔
          </button>
        </div>
      `;
      document.body.appendChild(modal);

      document.getElementById("quickModalCloseBtn").onclick = () => { modal.style.display = "none"; };
      modal.onclick = (e) => { if (e.target === modal) modal.style.display = "none"; };

      setupAutocompleteForInput("quickInputTarget", "quickTargetSuggest");

      document.getElementById("quickBtnSave").onclick = handleQuickSave;
      document.getElementById("quickBtnOpenFull").onclick = () => {
        modal.style.display = "none";
        window.openFullKnowledgeBaseModal();
      };
    }
    return modal;
  }

  function updateQuickModalUI() {
    const totalCount = Object.keys(customStreetsCache).length;
    const badge = document.getElementById("quickRulesCountBadge");
    if (badge) {
      badge.innerText = `${totalCount} правил`;
    }
    const openBtn = document.getElementById("quickBtnOpenFull");
    if (openBtn) {
      openBtn.innerText = `📖 Відкрити всю базу знань (${totalCount} правил) ➔`;
    }
  }

  async function handleQuickSave() {
    const pInput = document.getElementById("quickInputPhrase");
    const tInput = document.getElementById("quickInputTarget");
    const phrase = pInput.value.trim();
    const target = tInput.value.trim();

    if (phrase.length < 2 || target.length < 2) {
      alert("Вкажіть фразу з повідомлення та цільову вулицю");
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
      alert("Оберіть вулицю зі списку підказок!");
      return;
    }

    await window.saveMemorySynonymFromRelocate(phrase, target, lat, lng);
    pInput.value = "";
    tInput.value = "";
    tInput._selectedCoords = null;
    updateQuickModalUI();
    renderFullRulesList();
    if (typeof showToast === "function") showToast(`🧠 Синонім додано: «${escapeHtml(phrase)}» ➔ ${escapeHtml(target)}`);
  }

  // =========================================================================
  // 5. РІВЕНЬ 2: ПОВНОЕКРАННИЙ ЖУРНАЛ КЕРУВАННЯ «МОЗКОМ» (НА ВЕСЬ ЕКРАН)
  // =========================================================================
  function ensureFullModal() {
    let modal = document.getElementById("fullKnowledgeBaseModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "fullKnowledgeBaseModal";
      modal.style.cssText = `
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        background: #060913;
        z-index: 10000000;
        display: none;
        flex-direction: column;
        padding: 12px 14px;
        box-sizing: border-box;
      `;

      modal.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1.5px solid #1e293b; padding-bottom:10px; margin-bottom:10px;">
          <div style="font-size:15px; font-weight:900; color:#00f3ff; display:flex; align-items:center; gap:8px;">
            <span>📚 Журнал керування «мозком»</span>
            <span id="fullRulesCountSubBadge" style="font-size:10px; color:#38bdf8; background:#0f172a; padding:2px 7px; border-radius:5px; border:1px solid #1e293b;">0 правил</span>
          </div>
          <button id="fullModalCloseBtn" style="background:#1e293b; border:1px solid #475569; color:#f8fafc; font-size:16px; font-weight:800; border-radius:8px; width:34px; height:34px; cursor:pointer;">✕</button>
        </div>

        <div style="display:flex; gap:8px; margin-bottom:10px;">
          <button id="fullTabBtnSynonyms" style="flex:1; background:#0284c7; border:none; color:#fff; padding:9px; border-radius:8px; font-size:12px; font-weight:900; cursor:pointer;">
            🧠 Синоніми (А = Б)
          </button>
          <button id="fullTabBtnOverrides" style="flex:1; background:#0b1120; border:1px solid #1e293b; color:#94a3b8; padding:9px; border-radius:8px; font-size:12px; font-weight:900; cursor:pointer;">
            📍 Зсунуті вулиці
          </button>
        </div>

        <div id="fullAddFormBox" style="background:#0b1120; border:1px solid #1e293b; border-radius:10px; padding:10px; display:flex; flex-direction:column; gap:7px; margin-bottom:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span id="fullFormTitle" style="font-size:11.5px; font-weight:800; color:#38bdf8;">➕ Додати правило в пам'ять:</span>
            <button id="fullBtnCancelEdit" style="display:none; background:transparent; border:none; color:#f87171; font-size:11px; font-weight:800; cursor:pointer;" onclick="cancelSynonymEdit()">✕ Скасувати редагування</button>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <input type="text" id="fullInputPhrase" placeholder="Фраза в пості (напр. каштанова)" style="flex:1; min-width:140px; background:#060913; border:1px solid #334155; color:#fff; padding:8px 10px; border-radius:6px; font-size:12px; outline:none;">
            <div style="position:relative; flex:1; min-width:140px;">
              <input type="text" id="fullInputTarget" placeholder="Куди вести (офіційна вул.)" style="width:100%; box-sizing:border-box; background:#060913; border:1px solid #334155; color:#fff; padding:8px 10px; border-radius:6px; font-size:12px; outline:none;">
              <div id="fullTargetSuggest" style="position:absolute; top:100%; left:0; width:100%; background:#0f172a; border:1.5px solid #0284c7; border-radius:6px; max-height:160px; overflow-y:auto; z-index:10015; display:none; margin-top:2px; box-shadow:0 8px 25px rgba(0,0,0,0.95);"></div>
            </div>
          </div>
          <button id="fullBtnSaveRule" style="background:#0284c7; border:none; color:#fff; padding:9px; border-radius:7px; font-size:12px; font-weight:900; cursor:pointer;">
            💾 Запам'ятати правило
          </button>
        </div>

        <div style="margin-bottom:8px;">
          <input type="text" id="fullFilterSearch" placeholder="🔍 Фільтр по записах..." style="width:100%; box-sizing:border-box; background:#0b1120; border:1px solid #1e293b; color:#fff; padding:7px 10px; border-radius:7px; font-size:11.5px; outline:none;">
        </div>

        <div id="fullRulesListBox" style="flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:7px; padding-right:2px;"></div>
      `;
      document.body.appendChild(modal);

      document.getElementById("fullModalCloseBtn").onclick = () => {
        modal.style.display = "none";
        cancelSynonymEdit();
      };

      const tabSyn = document.getElementById("fullTabBtnSynonyms");
      const tabOvr = document.getElementById("fullTabBtnOverrides");
      const formBox = document.getElementById("fullAddFormBox");

      tabSyn.onclick = () => {
        fullModalActiveTab = "synonyms";
        tabSyn.style.background = "#0284c7"; tabSyn.style.color = "#fff";
        tabOvr.style.background = "#0b1120"; tabOvr.style.color = "#94a3b8";
        formBox.style.display = "flex";
        renderFullRulesList();
      };

      tabOvr.onclick = () => {
        fullModalActiveTab = "overrides";
        tabOvr.style.background = "#0284c7"; tabOvr.style.color = "#fff";
        tabSyn.style.background = "#0b1120"; tabSyn.style.color = "#94a3b8";
        formBox.style.display = "none";
        renderFullRulesList();
      };

      setupAutocompleteForInput("fullInputTarget", "fullTargetSuggest");
      document.getElementById("fullBtnSaveRule").onclick = handleFullSave;
      document.getElementById("fullFilterSearch").addEventListener("input", renderFullRulesList);
    }
    return modal;
  }

  function setupAutocompleteForInput(inputId, suggestId) {
    const input = document.getElementById(inputId);
    const suggest = document.getElementById(suggestId);
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

  // 6. РЕДАГУВАННЯ СИНОНІМІВ
  window.editSynonymRule = function (key) {
    const item = customStreetsCache[key];
    if (!item) return;

    editingSynonymKey = key;

    const fullPhrase = document.getElementById("fullInputPhrase");
    const fullTarget = document.getElementById("fullInputTarget");
    const fullTitle = document.getElementById("fullFormTitle");
    const fullSave = document.getElementById("fullBtnSaveRule");
    const fullCancel = document.getElementById("fullBtnCancelEdit");

    if (fullPhrase && fullTarget) {
      fullPhrase.value = item.phrase || key;
      fullTarget.value = item.name || "";
      fullTarget._selectedCoords = { lat: item.lat, lng: item.lng };
      fullTitle.innerText = `✏️ Редагування: «${item.phrase || key}»`;
      fullTitle.style.color = "#f59e0b";
      fullSave.innerText = "💾 Зберегти зміни";
      fullSave.style.background = "#ca8a04";
      fullCancel.style.display = "inline";
      fullPhrase.focus();
    }

    const qPhrase = document.getElementById("quickInputPhrase");
    const qTarget = document.getElementById("quickInputTarget");
    const qSave = document.getElementById("quickBtnSave");
    if (qPhrase && qTarget) {
      qPhrase.value = item.phrase || key;
      qTarget.value = item.name || "";
      qTarget._selectedCoords = { lat: item.lat, lng: item.lng };
      qSave.innerText = "💾 Зберегти зміни";
      qSave.style.background = "#ca8a04";
      qPhrase.focus();
    }
  };

  window.cancelSynonymEdit = function () {
    editingSynonymKey = null;

    const fullPhrase = document.getElementById("fullInputPhrase");
    const fullTarget = document.getElementById("fullInputTarget");
    const fullTitle = document.getElementById("fullFormTitle");
    const fullSave = document.getElementById("fullBtnSaveRule");
    const fullCancel = document.getElementById("fullBtnCancelEdit");

    if (fullPhrase) fullPhrase.value = "";
    if (fullTarget) { fullTarget.value = ""; fullTarget._selectedCoords = null; }
    if (fullTitle) { fullTitle.innerText = "➕ Додати правило в пам'ять:"; fullTitle.style.color = "#38bdf8"; }
    if (fullSave) { fullSave.innerText = "💾 Запам'ятати правило"; fullSave.style.background = "#0284c7"; }
    if (fullCancel) fullCancel.style.display = "none";

    const qPhrase = document.getElementById("quickInputPhrase");
    const qTarget = document.getElementById("quickInputTarget");
    const qSave = document.getElementById("quickBtnSave");
    if (qPhrase) qPhrase.value = "";
    if (qTarget) { qTarget.value = ""; qTarget._selectedCoords = null; }
    if (qSave) { qSave.innerText = "💾 Запам'ятати синонім"; qSave.style.background = "#0284c7"; }
  };

  async function handleFullSave() {
    const pInput = document.getElementById("fullInputPhrase");
    const tInput = document.getElementById("fullInputTarget");
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
      alert("Оберіть вулицю зі списку підказок!");
      return;
    }

    if (editingSynonymKey && editingSynonymKey !== toSafeFirebaseKey(phrase)) {
      try {
        delete customStreetsCache[editingSynonymKey];
        const oldUrl = appendAuth(`${BASE_URL}/custom_streets/${editingSynonymKey}.json`);
        fetch(oldUrl, { method: "DELETE" }).catch(() => {});
      } catch (e) {}
    }

    await window.saveMemorySynonymFromRelocate(phrase, target, lat, lng);
    cancelSynonymEdit();
    updateQuickModalUI();
    renderFullRulesList();
    if (typeof showToast === "function") showToast(`🧠 Синонім збережено: «${escapeHtml(phrase)}» ➔ ${escapeHtml(target)}`);
  }

  // 7. РУЧНЕ РЕДАГУВАННЯ ЗСУВУ КООРДИНАТ
  window.editStreetOverrideCoords = async function (key, streetName) {
    const item = streetOverridesCache[key];
    if (!item) return;

    const newCoords = prompt(
      `Введіть нові координати (lat, lng) для «${streetName}»:\n(Поточні: ${item.lat}, ${item.lng})`,
      `${item.lat}, ${item.lng}`
    );

    if (!newCoords) return;
    const parts = newCoords.split(/[,;\s]+/).map(p => parseFloat(p.trim())).filter(p => !isNaN(p));
    if (parts.length < 2 || parts[0] < 48.20 || parts[0] > 48.75 || parts[1] < 34.60 || parts[1] > 35.45) {
      alert("❌ Некоректні координати! Вкажіть дійсні координати Дніпра (напр. 48.5035, 35.0838).");
      return;
    }

    item.lat = Number(parts[0].toFixed(5));
    item.lng = Number(parts[1].toFixed(5));
    item.updated_at = Date.now();

    try {
      localStorage.setItem("radar_street_overrides", JSON.stringify(streetOverridesCache));
      const url = appendAuth(`${FIREBASE_OVERRIDES_URL.replace(".json", `/${key}.json`)}`);
      await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item)
      });
    } catch (e) {}

    renderFullRulesList();
    if (typeof renderMarkers === "function") renderMarkers();
    if (typeof showToast === "function") showToast(`📍 Координати «${escapeHtml(streetName)}» оновлено!`);
  };

  // 8. РЕНДЕР ПОВНОГО СПИСКУ ПРАВИЛ У ПОВНОЕКРАННОМУ ВІКНІ (СВІЖІ ЗВЕРХУ)
  function renderFullRulesList() {
    const box = document.getElementById("fullRulesListBox");
    if (!box) return;
    box.innerHTML = "";

    const searchInput = document.getElementById("fullFilterSearch");
    const filterQuery = searchInput ? searchInput.value.trim().toLowerCase() : "";

    const totalSyn = Object.keys(customStreetsCache).length;
    const subBadge = document.getElementById("fullRulesCountSubBadge");
    if (subBadge) subBadge.innerText = `${totalSyn} правил`;

    if (fullModalActiveTab === "synonyms") {
      let items = Object.entries(customStreetsCache);
      if (filterQuery) {
        items = items.filter(([k, v]) => 
          (v.phrase || k).toLowerCase().includes(filterQuery) || 
          (v.name || "").toLowerCase().includes(filterQuery)
        );
      }

      // ПРИМУСОВЕ СОРТУВАННЯ: НАЙСВІЖІШІ ЗВЕРХУ
      items.sort((a, b) => {
        const timeA = a[1].updated_at || 0;
        const timeB = b[1].updated_at || 0;
        return timeB - timeA;
      });

      if (items.length === 0) {
        box.innerHTML = `<div style="padding:20px; text-align:center; font-size:12px; color:#64748b;">Синонімів не знайдено. Додайте нове правило вгорі!</div>`;
        return;
      }

      items.forEach(([key, item]) => {
        const card = document.createElement("div");
        card.style.cssText = "background:#0b1120; border:1px solid #1e293b; border-left:4px solid #00f3ff; border-radius:8px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center; gap:8px;";
        card.innerHTML = `
          <div style="line-height:1.4; flex:1; min-width:0;">
            <div style="font-size:12px; font-weight:800; color:#f8fafc; word-break:break-word;">
              «${escapeHtml(item.phrase || key)}» ➔ <span style="color:#38bdf8;">${escapeHtml(item.name || 'Вулиця')}</span>
            </div>
            <div style="font-size:10px; color:#64748b; font-family:monospace; margin-top:2px;">
              (${item.lat}, ${item.lng})
            </div>
          </div>
          <div style="display:flex; gap:6px; flex-shrink:0;">
            <button style="background:#0f172a; border:1px solid #0284c7; color:#38bdf8; padding:6px 9px; border-radius:6px; font-size:11px; cursor:pointer;" title="Редагувати правило" onclick="window.editSynonymRule('${key}')">✏️</button>
            <button style="background:#450a0a; border:1px solid #ef4444; color:#fca5a5; padding:6px 9px; border-radius:6px; font-size:11px; cursor:pointer;" title="Видалити правило" onclick="window.deleteMemoryRule('${key}')">🗑️</button>
          </div>
        `;
        box.appendChild(card);
      });
    } else {
      let items = Object.entries(streetOverridesCache);
      if (filterQuery) {
        items = items.filter(([k, v]) => 
          (v.street || v.name || k).toLowerCase().includes(filterQuery)
        );
      }

      // ПРИМУСОВЕ СОРТУВАННЯ: НАЙСВІЖІШІ ЗВЕРХУ
      items.sort((a, b) => {
        const timeA = a[1].updated_at || 0;
        const timeB = b[1].updated_at || 0;
        return timeB - timeA;
      });

      if (items.length === 0) {
        box.innerHTML = `<div style="padding:20px; text-align:center; font-size:12px; color:#64748b;">Немає зміщених вулиць. Усі координати стандартні.</div>`;
        return;
      }

      items.forEach(([key, item]) => {
        const card = document.createElement("div");
        card.style.cssText = "background:#0b1120; border:1px solid #1e293b; border-left:4px solid #f59e0b; border-radius:8px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center; gap:8px;";
        card.innerHTML = `
          <div style="line-height:1.4; flex:1; min-width:0;">
            <div style="font-size:12px; font-weight:800; color:#fbbf24; word-break:break-word;">
              📍 ${escapeHtml(item.street || item.name || key)}
            </div>
            <div style="font-size:10px; color:#64748b; font-family:monospace; margin-top:2px;">
              lat: ${item.lat}, lng: ${item.lng}
            </div>
          </div>
          <div style="display:flex; gap:6px; flex-shrink:0;">
            <button style="background:#0f172a; border:1px solid #0284c7; color:#38bdf8; padding:6px 9px; border-radius:6px; font-size:11px; cursor:pointer;" title="Змінити координати" onclick="window.editStreetOverrideCoords('${key}', '${escapeHtml(item.street || item.name)}')">✏️</button>
            <button style="background:#1e293b; border:1px solid #334155; color:#94a3b8; padding:6px 9px; border-radius:6px; font-size:10.5px; font-weight:800; cursor:pointer;" title="Скинути до заводських" onclick="window.resetStreetOverride('${key}', '${escapeHtml(item.street || item.name)}')">🔄 Скинути</button>
          </div>
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
    updateQuickModalUI();
    renderFullRulesList();
    if (typeof showToast === "function") showToast("🗑️ Правило видалено");
  };

  window.resetStreetOverride = async function (key, streetName) {
    if (!confirm(`Скинути зміщення координат для «${streetName}» до заводських значень?`)) return;
    delete streetOverridesCache[key];
    try {
      localStorage.setItem("radar_street_overrides", JSON.stringify(streetOverridesCache));
      const url = appendAuth(`${FIREBASE_OVERRIDES_URL.replace(".json", `/${key}.json`)}`);
      await fetch(url, { method: "DELETE" });
    } catch (e) {}
    renderFullRulesList();
    if (typeof showToast === "function") showToast("🔄 Координати скинуто до заводських");
  };

  // ФУНКЦІЇ ВІДКРИТТЯ ВІКОН
  window.openQuickSynonymModal = function () {
    const modal = ensureQuickModal();
    updateQuickModalUI();
    modal.style.display = "flex";
  };

  window.openFullKnowledgeBaseModal = function () {
    const modal = ensureFullModal();
    renderFullRulesList();
    modal.style.display = "flex";
  };

  const oldWidget = document.getElementById("memWidget");
  if (oldWidget) oldWidget.remove();

  window.loadCloudRules();

})();
