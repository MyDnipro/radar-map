/**
 * Radar Dnipro — Модуль памяти топонимов ("А = Б") та Зсунутих вулиць v6.7
 */
(function() {
  const FB_CUSTOM_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/custom_streets.json";
  const FB_OVERRIDES_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/street_overrides.json";

  let cloudRules = {};
  let streetOverrides = {};
  let currentActiveTab = "synonyms";
  let selectedTargetCoords = null;
  let searchAbortController = null;
  let activeOverrideBeacon = null;
  const netSearchCache = new Map();

  const BUILTIN_LANDMARKS = [
    { name: "Центральний міст (Новий міст)", old: "Новый мост, Новий міст", lat: 48.47750, lng: 35.05680, type: "landmark", street: "Січеславська Набережна" },
    { name: "Амурський міст (Старий міст)", old: "Старый мост, Старий міст", lat: 48.48820, lng: 35.02750, type: "landmark", street: "вул. Пастера / пл. Старомостова" },
    { name: "Кайдацький міст", old: "Кайдакский мост, Кайдацкий мост", lat: 48.49750, lng: 34.96880, type: "landmark", street: "Набережна Заводська" },
    { name: "Південний міст", old: "Южный мост, Південний міст", lat: 48.41080, lng: 35.09750, type: "landmark", street: "вул. Набережна Перемоги" },
    { name: "вул. Космічна", lat: 48.41920, lng: 35.04850, type: "not_renamed" },
    { name: "просп. Слобожанський", old: "просп. Правди", lat: 48.50850, lng: 35.08250, type: "renamed" },
    { name: "просп. Науки", old: "просп. Гагаріна", lat: 48.43550, lng: 35.04120, type: "renamed" },
    { name: "просп. Богдана Хмельницького", old: "просп. Героїв Сталінграда", lat: 48.42650, lng: 35.01550, type: "renamed" },
    { name: "просп. Олександра Поля", old: "просп. Кірова", lat: 48.44850, lng: 35.02350, type: "renamed" },
    { name: "вул. Січових Стрільців", old: "вул. Артема", lat: 48.45650, lng: 35.03950, type: "renamed" },
    { name: "вул. В'ячеслава Чорновола", old: "вул. Савченка", lat: 48.45820, lng: 35.01150, type: "renamed" },
    { name: "вул. Калинова", lat: 48.51850, lng: 35.07550, type: "not_renamed" },
    { name: "вул. Робоча", lat: 48.44800, lng: 34.99650, type: "not_renamed" },
    { name: "ТРЦ Караван", lat: 48.52850, lng: 35.03350, type: "landmark", street: "Донецьке шосе" },
    { name: "ТРЦ Дафі", lat: 48.42620, lng: 35.02150, type: "landmark", street: "просп. Зоряний / просп. Науки" },
    { name: "Ринок Озерка", lat: 48.47150, lng: 35.02250, type: "landmark", street: "вул. Степана Бандери (Шмідта)" },
    { name: "Набережна Перемоги", lat: 48.43150, lng: 35.06950, type: "not_renamed" },
    { name: "Набережна Заводська", lat: 48.48550, lng: 34.97550, type: "not_renamed" }
  ];

  function toFirebaseKey(str) {
    if (!str) return "key_" + Date.now();
    return encodeURIComponent(str.trim().toLowerCase())
      .replace(/%/g, "_")
      .replace(/\./g, "_")
      .replace(/\$/g, "_")
      .replace(/#/g, "_")
      .replace(/\[/g, "_").replace(/\]/g, "_")
      .slice(0, 80);
  }

  function normalizeSearchText(str) {
    if (!str) return "";
    return str
      .toLowerCase()
      .replace(/['’`ʼ"]/g, "")
      .replace(/\b(вул|вулиця|ул|улица|просп|проспект|пр-т|пров|провулок|пер|тупик|пл|площа|площадь|наб|набережна|набережная|шосе|шоссе|міст|мост)\b\.?/gi, " ")
      .replace(/[іїы]/g, "и")
      .replace(/[єэ]/g, "е")
      .replace(/ґ/g, "г")
      .replace(/щ/g, "шч")
      .replace(/[^a-zа-я0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function isSmartMatch(query, targetStr) {
    if (!query || !targetStr) return false;
    const rawQ = query.toLowerCase().trim();
    const rawT = targetStr.toLowerCase();
    if (rawT.includes(rawQ)) return true;

    const normQ = normalizeSearchText(query);
    const normT = normalizeSearchText(targetStr);
    if (!normQ) return false;
    if (normT.includes(normQ)) return true;

    const qWords = normQ.split(" ").filter(w => w.length >= 2);
    if (qWords.length > 0 && qWords.every(w => normT.includes(w))) return true;
    return false;
  }

  const style = document.createElement("style");
  style.textContent = `
    #memWidget {
      position: absolute !important;
      bottom: 25px !important;
      left: calc(50% - 10px) !important;
      transform: translateX(-50%) !important;
      z-index: 2200 !important;
      user-select: none;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    #memBtn {
      width: 38px;
      height: 38px;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.94);
      backdrop-filter: blur(10px);
      border: 1.5px solid #a855f7;
      color: #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      cursor: pointer;
      box-shadow: 0 4px 18px rgba(168, 85, 247, 0.45);
      transition: transform 0.15s ease;
    }
    #memBtn:active { transform: scale(0.92); }

    #memCard {
      display: none;
      position: fixed !important;
      bottom: 75px !important;
      left: 50% !important;
      transform: translateX(-50%) !important;
      width: 340px;
      max-width: calc(100vw - 30px) !important;
      background: rgba(15, 23, 42, 0.98);
      backdrop-filter: blur(12px);
      border: 1.5px solid #a855f7;
      border-radius: 14px;
      padding: 12px;
      color: #fff;
      box-shadow: 0 10px 35px rgba(0, 0, 0, 0.85);
      flex-direction: column;
      gap: 8px;
      box-sizing: border-box;
      overflow: visible !important;
      z-index: 10000;
    }
    .mem-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 12px;
      font-weight: 800;
      color: #c084fc;
      border-bottom: 1px solid #334155;
      padding-bottom: 6px;
    }
    .mem-row { display: flex; align-items: center; gap: 6px; width: 100%; box-sizing: border-box; }
    .mem-input-wrap { position: relative; flex: 1; min-width: 0; }
    .mem-input {
      width: 100%;
      background: #0b1120;
      border: 1px solid #475569;
      color: #fff;
      padding: 7px 8px;
      border-radius: 6px;
      font-size: 11px;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.2s ease, background 0.2s ease;
    }
    .mem-input:focus { border-color: #c084fc; }

    #memTargetResults {
      position: absolute;
      top: 100%;
      left: 0;
      width: 100%;
      min-width: 210px;
      background: #0f172a;
      border: 1.5px solid #a855f7;
      border-radius: 8px;
      max-height: 200px;
      overflow-y: auto;
      z-index: 10005;
      display: none;
      margin-top: 4px;
      box-shadow: 0 8px 25px rgba(0,0,0,0.85);
    }
    .mem-search-item {
      padding: 7px 9px;
      font-size: 11px;
      color: #cbd5e1;
      cursor: pointer;
      border-bottom: 1px solid #1e293b;
      line-height: 1.35;
    }
    .mem-search-item:hover { background: #1e293b; color: #c084fc; }

    .btn-mem-save {
      background: #9333ea;
      border: none;
      color: #fff;
      padding: 8px 10px;
      border-radius: 7px;
      font-size: 11px;
      font-weight: 800;
      cursor: pointer;
      width: 100%;
      margin-top: 2px;
    }
    .btn-mem-save:hover { background: #a855f7; }
    .btn-mem-view-all {
      background: #1e293b;
      border: 1px solid #64748b;
      color: #e2e8f0;
      padding: 7px 10px;
      border-radius: 7px;
      font-size: 11px;
      font-weight: 700;
      cursor: pointer;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .btn-mem-view-all:hover { border-color: #c084fc; color: #c084fc; }

    #memFullModal {
      display: none;
      position: fixed !important;
      inset: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      background: rgba(11, 17, 32, 0.96);
      backdrop-filter: blur(14px);
      z-index: 99999 !important;
      padding: 16px 14px;
      box-sizing: border-box;
      flex-direction: column;
      gap: 10px;
    }
    .mem-full-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 15px;
      font-weight: 800;
      color: #c084fc;
      border-bottom: 1.5px solid #334155;
      padding-bottom: 8px;
    }
    .mem-tab-btn {
      flex: 1;
      padding: 8px 4px;
      border-radius: 8px;
      font-size: 11.5px;
      font-weight: 800;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }
    .mem-full-list {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-right: 2px;
    }
    .mem-full-card {
      background: #0f172a;
      border: 1px solid #334155;
      border-left: 3px solid #a855f7;
      border-radius: 10px;
      padding: 10px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }
    .mem-full-info { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; }
    .mem-full-rule { font-size: 12px; color: #f8fafc; font-weight: 700; word-break: break-word; line-height: 1.35; }
    .mem-full-time { font-size: 10px; color: #94a3b8; display: flex; align-items: center; gap: 5px; font-weight: 600; }
    .mem-full-acts {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .btn-mem-edit {
      background: #0284c7;
      border: 1px solid #38bdf8;
      color: #fff;
      padding: 6px 10px;
      border-radius: 7px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 800;
    }
    .btn-mem-del {
      background: #7f1d1d;
      border: 1px solid #ef4444;
      color: #fca5a5;
      padding: 6px 10px;
      border-radius: 7px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 800;
    }
    .btn-mem-reset-coords {
      background: #1e293b;
      border: 1px solid #ef4444;
      color: #fca5a5;
      padding: 6px 10px;
      border-radius: 7px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 800;
    }
    .btn-mem-edit-override {
      background: #1e293b;
      border: 1px solid #64748b;
      color: #cbd5e1;
      padding: 6px 9px;
      border-radius: 7px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 800;
    }
    .btn-mem-show-map {
      background: #0284c7;
      border: 1px solid #38bdf8;
      color: #fff;
      padding: 6px 10px;
      border-radius: 7px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 800;
    }
  `;
  document.head.appendChild(style);

  const widget = document.createElement("div");
  widget.id = "memWidget";
  widget.innerHTML = `
    <div id="memBtn" title="Память топонимов (А = Б)">🧠</div>

    <div id="memCard">
      <div class="mem-header">
        <span>🧠 Память топонимов ("А = Б")</span>
        <span id="memCloseBtn" style="cursor:pointer; font-size:16px; padding:0 4px;">✕</span>
      </div>
      <div class="mem-row">
        <div class="mem-input-wrap">
          <input type="text" id="memAlias" class="mem-input" placeholder="Что искать (напр. образцова)" autocomplete="off">
        </div>
        <span style="font-weight:900; color:#c084fc;">=</span>
        <div class="mem-input-wrap">
          <input type="text" id="memTarget" class="mem-input" placeholder="Куда вести (напр. Зразкова)" autocomplete="off">
          <div id="memTargetResults"></div>
        </div>
      </div>
      <button class="btn-mem-save" id="memSaveBtn">💾 Сохранить в память</button>
      <button class="btn-mem-view-all" id="memViewAllBtn">
        <span>📋 Сохраненные правила:</span>
        <b id="memCountBadge" style="color:#c084fc;">0</b>
      </button>
    </div>
  `;
  document.body.appendChild(widget);

  const fullModal = document.createElement("div");
  fullModal.id = "memFullModal";
  fullModal.innerHTML = `
    <div class="mem-full-header">
      <span>📚 Журнал керування «мозком»</span>
      <span id="memFullCloseBtn" style="cursor:pointer; font-size:20px; padding:0 8px; color:#94a3b8;">✕</span>
    </div>

    <div style="display:flex; gap:6px; margin-bottom:2px;">
      <button id="memTabSynonymsBtn" class="mem-tab-btn" style="background:#9333ea; color:#fff;">
        🧠 Синоніми (А = Б)
      </button>
      <button id="memTabOverridesBtn" class="mem-tab-btn" style="background:#1e293b; color:#94a3b8; border:1px solid #334155;">
        📍 Зсунуті вулиці
      </button>
    </div>

    <div id="memSynonymsTools" style="display:flex; justify-content:flex-end;">
      <button id="btnCleanGarbageRules" style="background:#1e293b; border:1px solid #a855f7; color:#c084fc; font-size:10px; font-weight:800; padding:4px 8px; border-radius:6px; cursor:pointer;">
        🧹 Очистити спам від бота
      </button>
    </div>

    <div id="memFullList" class="mem-full-list">
      <span style="font-size:12px; color:#64748b; text-align:center; margin-top:20px;">Загрузка...</span>
    </div>
  `;
  document.body.appendChild(fullModal);

  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(widget);
    L.DomEvent.disableScrollPropagation(widget);
    L.DomEvent.disableClickPropagation(fullModal);
    L.DomEvent.disableScrollPropagation(fullModal);
  }

  const btn = document.getElementById("memBtn");
  const card = document.getElementById("memCard");
  const closeBtn = document.getElementById("memCloseBtn");
  const saveBtn = document.getElementById("memSaveBtn");
  const viewAllBtn = document.getElementById("memViewAllBtn");
  const fullCloseBtn = document.getElementById("memFullCloseBtn");
  const tabSynonymsBtn = document.getElementById("memTabSynonymsBtn");
  const tabOverridesBtn = document.getElementById("memTabOverridesBtn");
  const btnCleanGarbage = document.getElementById("btnCleanGarbageRules");
  const aliasInput = document.getElementById("memAlias");
  const targetInput = document.getElementById("memTarget");
  const targetResults = document.getElementById("memTargetResults");

  function toggleCard() {
    const isOpen = card.style.display === "flex";
    card.style.display = isOpen ? "none" : "flex";
    if (!isOpen) {
      targetResults.style.display = "none";
      setTimeout(() => aliasInput.focus(), 100);
    }
  }

  function openFullModal() {
    card.style.display = "none";
    switchTab(currentActiveTab);
    fullModal.style.display = "flex";
  }

  function closeFullModal() {
    fullModal.style.display = "none";
  }

  function switchTab(tab) {
    currentActiveTab = tab;
    const tools = document.getElementById("memSynonymsTools");
    if (tab === "synonyms") {
      tabSynonymsBtn.style.background = "#9333ea";
      tabSynonymsBtn.style.color = "#fff";
      tabOverridesBtn.style.background = "#1e293b";
      tabOverridesBtn.style.color = "#94a3b8";
      if (tools) tools.style.display = "flex";
      renderFullList();
    } else {
      tabOverridesBtn.style.background = "#9333ea";
      tabOverridesBtn.style.color = "#fff";
      tabSynonymsBtn.style.background = "#1e293b";
      tabSynonymsBtn.style.color = "#94a3b8";
      if (tools) tools.style.display = "none";
      renderOverridesList();
    }
  }

  tabSynonymsBtn.addEventListener("click", () => switchTab("synonyms"));
  tabOverridesBtn.addEventListener("click", () => switchTab("overrides"));
  btn.addEventListener("click", toggleCard);
  closeBtn.addEventListener("click", toggleCard);
  viewAllBtn.addEventListener("click", openFullModal);
  fullCloseBtn.addEventListener("click", closeFullModal);

  function updateCountBadge() {
    const badge = document.getElementById("memCountBadge");
    if (badge) {
      const synCount = Object.keys(cloudRules || {}).length;
      const ovrCount = Object.keys(streetOverrides || {}).length;
      badge.innerText = synCount + ovrCount;
    }
  }

  async function loadCloudRules() {
    if (window.DNIPRO_STREETS_MAP) {
      BUILTIN_LANDMARKS.forEach(lm => {
        window.DNIPRO_STREETS_MAP[lm.name.toLowerCase()] = lm;
      });
    }

    try {
      const res = await fetch(`${FB_CUSTOM_URL}?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object") {
          cloudRules = data;
          Object.entries(data).forEach(([key, item]) => {
            if (item && item.lat && item.lng && window.DNIPRO_STREETS_MAP) {
              const aliasName = (item.alias || item.phrase || key).toLowerCase();
              window.DNIPRO_STREETS_MAP[aliasName] = item;
            }
          });
        }
      }
    } catch(e) {}

    try {
      const resOvr = await fetch(`${FB_OVERRIDES_URL}?t=${Date.now()}`);
      if (resOvr.ok) {
        const dataOvr = await resOvr.json();
        if (dataOvr && typeof dataOvr === "object") {
          streetOverrides = dataOvr;
          if (window.DNIPRO_STREETS_MAP) {
            for (const item of Object.values(dataOvr)) {
              const recName = item.street || item.name;
              if (item && recName && item.lat && item.lng) {
                const sName = recName.toLowerCase().trim();
                for (const mapItem of Object.values(window.DNIPRO_STREETS_MAP)) {
                  if (mapItem && mapItem.name && mapItem.name.toLowerCase().trim() === sName) {
                    if (mapItem._origLat === undefined) {
                      mapItem._origLat = mapItem.lat;
                      mapItem._origLng = mapItem.lng;
                    }
                    mapItem.lat = Number(item.lat);
                    mapItem.lng = Number(item.lng);
                  }
                }
              }
            }
          }
        }
      }
    } catch(e) {}

    updateCountBadge();
    if (fullModal.style.display === "flex") {
      if (currentActiveTab === "overrides") renderOverridesList();
      else renderFullList();
    }
  }

  function renderFullList() {
    const box = document.getElementById("memFullList");
    if (!box) return;
    box.innerHTML = "";

    const entries = Object.entries(cloudRules);
    updateCountBadge();

    if (entries.length === 0) {
      box.innerHTML = '<span style="font-size:12px; color:#64748b; text-align:center; margin-top:30px;">Немає збережених синонімів</span>';
      return;
    }

    entries.sort((a, b) => (b[1].time || 0) - (a[1].time || 0));

    entries.forEach(([fbKey, item]) => {
      const aliasName = item.alias || item.phrase || fbKey;
      const row = document.createElement("div");
      row.className = "mem-full-card";
      row.innerHTML = `
        <div class="mem-full-info">
          <div class="mem-full-rule">«${aliasName}» ➔ <span style="color:#38bdf8;">${item.name || item.address}</span></div>
          <div class="mem-full-time"><span style="color:#64748b;">(${Number(item.lat).toFixed(4)},${Number(item.lng).toFixed(4)})</span></div>
        </div>
        <div class="mem-full-acts">
          <button class="btn-mem-del" title="Видалити">🗑️</button>
        </div>
      `;

      row.querySelector(".btn-mem-del").addEventListener("click", () => deleteRule(fbKey));
      box.appendChild(row);
    });
  }

  async function renderOverridesList() {
    const box = document.getElementById("memFullList");
    if (!box) return;

    box.innerHTML = "";
    const entries = Object.entries(streetOverrides);
    updateCountBadge();

    if (entries.length === 0) {
      box.innerHTML = `
        <div style="text-align:center; padding:30px 10px; color:#94a3b8; font-size:11.5px; line-height:1.5;">
          📍 <b>Немає зсунутих вулиць</b><br>
          Коли ви перетягуєте мітку і тиснете «Підтвердити», вулиця з'явиться тут.
        </div>
      `;
      return;
    }

    entries.forEach(([key, item]) => {
      const streetName = item.street || item.name;
      if (!item || !streetName) return;
      const lat = Number(item.lat).toFixed(5);
      const lng = Number(item.lng).toFixed(5);

      const row = document.createElement("div");
      row.className = "mem-full-card";
      row.style.borderLeftColor = "#38bdf8";
      row.innerHTML = `
        <div class="mem-full-info">
          <div class="mem-full-rule" style="color:#38bdf8; font-size:13px;">📍 ${streetName}</div>
          <div style="font-family:monospace; font-size:10.5px; color:#f1f5f9; margin-top:2px;">lat: ${lat}, lng: ${lng}</div>
        </div>
        <div class="mem-full-acts">
          <button class="btn-mem-reset-coords" title="Скинути до streets.js">🔄 Скинути</button>
        </div>
      `;

      row.querySelector(".btn-mem-reset-coords").addEventListener("click", () => resetStreetCoords(key, streetName));
      box.appendChild(row);
    });
  }

  async function resetStreetCoords(key, streetName) {
    if (!confirm(`Скинути координати вулиці «${streetName}» до заводських із streets.js?`)) return;

    try {
      await fetch(FB_OVERRIDES_URL.replace(".json", `/${key}.json`), { method: "DELETE" });

      if (window.DNIPRO_STREETS_MAP) {
        for (const item of Object.values(window.DNIPRO_STREETS_MAP)) {
          if (item && item.name && item.name.toLowerCase().trim() === streetName.toLowerCase().trim()) {
            if (item._origLat !== undefined && item._origLng !== undefined) {
              item.lat = item._origLat;
              item.lng = item._origLng;
            }
          }
        }
      }

      delete streetOverrides[key];
      renderOverridesList();
      if (typeof window.showToast === "function") window.showToast(`🔄 Координати «${streetName}» повернуто до заводських!`);
      if (typeof window.renderMarkers === "function") window.renderMarkers();
    } catch(e) {
      alert("Помилка: " + e.message);
    }
  }

  async function deleteRule(fbKey) {
    if (!confirm("Видалити це правило з пам'яті?")) return;
    const item = cloudRules[fbKey];
    const aliasName = (item?.alias || item?.phrase || fbKey).toLowerCase();

    delete cloudRules[fbKey];
    if (window.DNIPRO_STREETS_MAP) {
      delete window.DNIPRO_STREETS_MAP[aliasName];
    }

    await fetch(FB_CUSTOM_URL.replace(".json", `/${fbKey}.json`), { method: "DELETE" }).catch(() => {});
    renderFullList();
    if (typeof window.showToast === "function") window.showToast("🗑️ Правило видалено!");
  }

  window.loadCloudRules = loadCloudRules;
  setTimeout(loadCloudRules, 800);
})();
