/**
 * Radar Dnipro — Модуль памяти топонимов ("А = Б") та Зсунутих вулиць v6.5
 * Дві окремі папки (Синоніми + Зсунуті вулиці)
 * Додано:
 * 1. Редагування назв зсунутих вулиць (✏️) безпосередньо у списку
 * 2. Кнопка «🎯 На карті» з переходом до жовтого пульсуючого маркера-маяка
 * 3. Клік по жовтому маяку повертає назад до папки «Зсунуті вулиці»
 */
(function() {
  const FB_CUSTOM_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/custom_streets.json";
  const FB_OVERRIDES_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/street_overrides.json";

  let cloudRules = {};
  let streetOverrides = {};
  let currentActiveTab = "synonyms"; // "synonyms" | "overrides"
  let selectedTargetCoords = null;
  let searchAbortController = null;
  let activeOverrideBeacon = null;
  const netSearchCache = new Map();

  // Встроенные народные ориентиры и мосты Днепра (0 мс отклик)
  const BUILTIN_LANDMARKS = [
    { name: "Центральний міст (Новий міст)", old: "Новый мост, Новий міст, Центральный мост", lat: 48.47750, lng: 35.05680 },
    { name: "Амурський міст (Старий міст)", old: "Старый мост, Старий міст, Амурский мост", lat: 48.48820, lng: 35.02750 },
    { name: "Кайдацький міст", old: "Кайдакский мост, Кайдацкий мост", lat: 48.49750, lng: 34.96880 },
    { name: "Південний міст", old: "Южный мост, Південний міст", lat: 48.41080, lng: 35.09750 },
    { name: "Усть-Самарський міст", old: "Усть-Самарский мост, Малиновского мост", lat: 48.46320, lng: 35.11950 },
    { name: "Самарський міст", old: "Самарский мост, Игреньский мост", lat: 48.48350, lng: 35.15820 },
    { name: "вул. Космічна", old: "Космическая, Космичка, Космічна", lat: 48.41920, lng: 35.04850 },
    { name: "просп. Слобожанський", old: "Правда, проспект Правды, Слобожанский", lat: 48.50850, lng: 35.08250 },
    { name: "просп. Науки (Гагаріна)", old: "Гагарина, проспект Гагаріна, Нагорка, Подстанция", lat: 48.43550, lng: 35.04120 },
    { name: "просп. Богдана Хмельницького", old: "Героев Сталинграда, Сталинграда, 12 квартал, Развилка", lat: 48.42650, lng: 35.01550 },
    { name: "просп. Олександра Поля", old: "Кирова, проспект Кирова, Олександра Поля", lat: 48.44850, lng: 35.02350 },
    { name: "просп. Лесі Українки", old: "Пушкина, проспект Пушкіна", lat: 48.46520, lng: 35.02100 },
    { name: "вул. Січових Стрільців", old: "Артема, вулиця Артема, Сечевых Стрельцов", lat: 48.45650, lng: 35.03950 },
    { name: "вул. В'ячеслава Чорновола", old: "Савченко, Юрия Савченко, Вячеслава Черновола", lat: 48.45820, lng: 35.01150 },
    { name: "вул. Калинова", old: "Калиновая, Калинова", lat: 48.51850, lng: 35.07550 },
    { name: "вул. Робоча", old: "Рабочая, Робоча", lat: 48.44800, lng: 34.99650 },
    { name: "ТРЦ Караван (Нижньодніпровська)", old: "Караван, Березинка, Донецкое шоссе", lat: 48.52850, lng: 35.03350 },
    { name: "ТРЦ Дафі (Підстанція)", old: "Дафи, Подстанция, Зоряний", lat: 48.42620, lng: 35.02150 },
    { name: "Ринок Озерка", old: "Озерка, Озёрка, Шмидта, Степана Бандери", lat: 48.47150, lng: 35.02250 },
    { name: "вул. Степана Бандери (Шмідта)", old: "Шмидта, вулиця Шмідта, Бандеры", lat: 48.46850, lng: 35.02150 },
    { name: "Набережна Перемоги", old: "Набережная Победы, Победа 1-6, Кольцо Победы", lat: 48.43150, lng: 35.06950 },
    { name: "Січеславська Набережна", old: "Набережная Ленина, Сичеславская Набережная, Цирк", lat: 48.46950, lng: 35.05450 },
    { name: "Набережна Заводська", old: "Заводская Набережная, Речпорт, Річпорт, Парус, Красный Камень", lat: 48.48550, lng: 34.97550 }
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

  // Стили
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
    .mem-input.autofilled {
      border-color: #a855f7 !important;
      background: rgba(168, 85, 247, 0.15) !important;
    }

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
      white-space: nowrap;
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
      white-space: nowrap;
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
      white-space: nowrap;
    }

    /* Нові кнопки та стилі для Зсунутих вулиць */
    .btn-mem-edit-override {
      background: #1e293b;
      border: 1px solid #64748b;
      color: #cbd5e1;
      padding: 6px 9px;
      border-radius: 7px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 800;
      white-space: nowrap;
      transition: all 0.2s;
    }
    .btn-mem-edit-override:hover {
      border-color: #38bdf8;
      color: #38bdf8;
      background: #0f172a;
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
      white-space: nowrap;
      transition: all 0.2s;
    }
    .btn-mem-show-map:hover {
      background: #0369a1;
      box-shadow: 0 0 10px rgba(56, 189, 248, 0.4);
    }

    /* Жовтий пульсуючий маяк на карті */
    .yellow-beacon-container {
      background: transparent !important;
      border: none !important;
    }
    @keyframes yellowBeaconPulseGlow {
      0% {
        transform: scale(0.85);
        box-shadow: 0 0 0 0 rgba(250, 204, 21, 0.95), 0 0 10px #facc15;
      }
      50% {
        transform: scale(1.2);
        box-shadow: 0 0 0 20px rgba(250, 204, 21, 0), 0 0 24px #eab308;
      }
      100% {
        transform: scale(0.85);
        box-shadow: 0 0 0 0 rgba(250, 204, 21, 0), 0 0 10px #facc15;
      }
    }
    .yellow-beacon-outer {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: #facc15;
      border: 3px solid #ffffff;
      animation: yellowBeaconPulseGlow 1.25s infinite ease-in-out;
      cursor: pointer;
      box-sizing: border-box;
    }
  `;
  document.head.appendChild(style);

  // Разметка
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

    <!-- ДВЕ ОТДЕЛЬНЫЕ ПАПКИ -->
    <div style="display:flex; gap:6px; margin-bottom:2px;">
      <button id="memTabSynonymsBtn" class="mem-tab-btn" style="background:#9333ea; color:#fff;">
        🧠 Синоніми (А = Б)
      </button>
      <button id="memTabOverridesBtn" class="mem-tab-btn" style="background:#1e293b; color:#94a3b8; border:1px solid #334155;">
        📍 Зсунуті вулиці
      </button>
    </div>

    <!-- ТУЛБАР ДЛЯ СИНОНИМОВ -->
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
      tabSynonymsBtn.style.border = "none";

      tabOverridesBtn.style.background = "#1e293b";
      tabOverridesBtn.style.color = "#94a3b8";
      tabOverridesBtn.style.border = "1px solid #334155";
      if (tools) tools.style.display = "flex";
      renderFullList();
    } else {
      tabOverridesBtn.style.background = "#9333ea";
      tabOverridesBtn.style.color = "#fff";
      tabOverridesBtn.style.border = "none";

      tabSynonymsBtn.style.background = "#1e293b";
      tabSynonymsBtn.style.color = "#94a3b8";
      tabSynonymsBtn.style.border = "1px solid #334155";
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

  // Поиск по сети
  async function fetchOnlineLocations(query, signal) {
    const cacheKey = normalizeSearchText(query) || query.toLowerCase().trim();
    if (netSearchCache.has(cacheKey)) return netSearchCache.get(cacheKey);

    const results = [];
    try {
      const photonUrl = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=48.4647&lon=35.0462&bbox=34.75,48.30,35.35,48.65&limit=5`;
      const res = await fetch(photonUrl, { signal });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.features)) {
          data.features.forEach(f => {
            const p = f.properties || {};
            const coords = f.geometry && f.geometry.coordinates;
            const rawName = p.name || p.street || "";
            if (rawName && coords && coords.length === 2) {
              const label = p.street && p.name && p.street !== p.name ? `${p.name} (${p.street})` : rawName;
              if (!results.some(r => r.name.toLowerCase() === label.toLowerCase())) {
                results.push({ name: label, lat: parseFloat(coords[1]), lng: parseFloat(coords[0]) });
              }
            }
          });
        }
      }
    } catch (e) {
      if (e.name === "AbortError") throw e;
    }

    if (results.length > 0) netSearchCache.set(cacheKey, results);
    return results;
  }

  function appendSearchRow(container, item) {
    const div = document.createElement("div");
    div.className = "mem-search-item";
    div.innerHTML = item.subtext
      ? `${item.badge} <b>${item.name}</b><br><span style="color:#f59e0b; font-size:10px;">${item.subtext}</span>`
      : `${item.badge} <b>${item.name}</b>`;
    div.onclick = () => {
      targetInput.value = item.name;
      selectedTargetCoords = { lat: item.lat, lng: item.lng, name: item.name };
      targetResults.style.display = "none";
    };
    container.appendChild(div);
  }

  targetInput.addEventListener("input", async () => {
    selectedTargetCoords = null;
    targetInput.classList.remove("autofilled");
    const query = targetInput.value.trim();

    if (searchAbortController) {
      searchAbortController.abort();
      searchAbortController = null;
    }

    if (query.length < 2) {
      targetResults.style.display = "none";
      targetResults.innerHTML = "";
      return;
    }

    targetResults.innerHTML = "";
    const matches = [];

    // Память синонимов
    for (const rule of Object.values(cloudRules)) {
      if (!rule || !rule.lat || !rule.lng) continue;
      const phrase = rule.alias || rule.phrase || "";
      const nameStr = rule.name || "";
      if (isSmartMatch(query, nameStr + " " + phrase)) {
        if (!matches.some(m => m.name === nameStr)) {
          matches.push({ name: nameStr, lat: rule.lat, lng: rule.lng, badge: "🧠", subtext: phrase ? `(память: ${phrase})` : "" });
        }
      }
    }

    // Встроенные ориентиры
    for (const lm of BUILTIN_LANDMARKS) {
      if (isSmartMatch(query, lm.name + " " + (lm.old || ""))) {
        if (!matches.some(m => m.name === lm.name)) {
          matches.push({ name: lm.name, lat: lm.lat, lng: lm.lng, badge: "🌉", subtext: lm.old ? `(${lm.old})` : "" });
        }
      }
    }

    // streets.js
    if (window.DNIPRO_STREETS_MAP) {
      const sortedKeys = Object.keys(window.DNIPRO_STREETS_MAP).sort((a, b) => b.length - a.length);
      for (const k of sortedKeys) {
        const item = window.DNIPRO_STREETS_MAP[k];
        if (!item || !item.name) continue;
        const fullTarget = `${k} ${item.name}${item.old || ""}`;
        if (isSmartMatch(query, fullTarget)) {
          if (!matches.some(m => m.name === item.name)) {
            matches.push({ name: item.name, lat: item.lat, lng: item.lng, badge: "📍", subtext: item.old ? `(бывшая: ${item.old})` : "" });
          }
        }
        if (matches.length >= 12) break;
      }
    }

    matches.forEach(item => appendSearchRow(targetResults, item));
    targetResults.style.display = matches.length > 0 ? "block" : "none";

    // Фоновая сеть
    if (query.length >= 2) {
      searchAbortController = new AbortController();
      const signal = searchAbortController.signal;
      try {
        const onlineItems = await fetchOnlineLocations(query, signal);
        if (signal.aborted) return;
        onlineItems.forEach(netItem => {
          if (!matches.some(m => isSmartMatch(netItem.name, m.name))) {
            matches.push(netItem);
            appendSearchRow(targetResults, { name: netItem.name, lat: netItem.lat, lng: netItem.lng, badge: "🌐", subtext: "Карта Днепра (онлайн)" });
          }
        });
        targetResults.style.display = targetResults.children.length > 0 ? "block" : "none";
      } catch (e) {}
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".mem-input-wrap")) {
      targetResults.style.display = "none";
    }
  });

  function formatDateTime(ts) {
    if (!ts) return "18.10.2026 12:00";
    const d = new Date(ts);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `📅 ${day}.${month}.${year} 🕒 ${hours}:${minutes}`;
  }

  async function loadCloudRules() {
    if (window.DNIPRO_STREETS_MAP) {
      BUILTIN_LANDMARKS.forEach(lm => {
        window.DNIPRO_STREETS_MAP[lm.name.toLowerCase()] = lm;
      });
    }

    // 1. Синонимы
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
          updateCountBadge();
        }
      }
    } catch(e) {}

    // 2. Зсунуті вулиці
    try {
      const resOvr = await fetch(`${FB_OVERRIDES_URL}?t=${Date.now()}`);
      if (resOvr.ok) {
        const dataOvr = await resOvr.json();
        if (dataOvr && typeof dataOvr === "object") {
          streetOverrides = dataOvr;
          if (window.DNIPRO_STREETS_MAP) {
            for (const item of Object.values(dataOvr)) {
              if (item && item.street && item.lat && item.lng) {
                const sName = item.street.toLowerCase().trim();
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
  }

  function updateCountBadge() {
    const badge = document.getElementById("memCountBadge");
    if (badge) badge.innerText = Object.keys(cloudRules).length;
  }

  // Вкладка 1: Синонимы
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
      const timeStr = formatDateTime(item.time);

      const row = document.createElement("div");
      row.className = "mem-full-card";
      row.innerHTML = `
        <div class="mem-full-info">
          <div class="mem-full-rule">«${aliasName}» ➔ <span style="color:#38bdf8;">${item.name || item.address}</span></div>
          <div class="mem-full-time">${timeStr} <span style="color:#64748b;">(${Number(item.lat).toFixed(4)},${Number(item.lng).toFixed(4)})</span></div>
        </div>
        <div class="mem-full-acts">
          <button class="btn-mem-edit" title="Редагувати">✏️</button>
          <button class="btn-mem-del" title="Видалити">🗑️</button>
        </div>
      `;

      row.querySelector(".btn-mem-edit").addEventListener("click", () => editRule(fbKey, item));
      row.querySelector(".btn-mem-del").addEventListener("click", () => deleteRule(fbKey));
      box.appendChild(row);
    });
  }

  // Вкладка 2: Зсунуті вулиці
  async function renderOverridesList() {
    const box = document.getElementById("memFullList");
    if (!box) return;
    box.innerHTML = '<span style="font-size:12px; color:#64748b; text-align:center; margin-top:20px;">Завантаження...</span>';

    try {
      const res = await fetch(`${FB_OVERRIDES_URL}?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        streetOverrides = (data && typeof data === "object") ? data : {};
      }
    } catch(e) {}

    box.innerHTML = "";
    const entries = Object.entries(streetOverrides);

    if (entries.length === 0) {
      box.innerHTML = `
        <div style="text-align:center; padding:30px 10px; color:#94a3b8; font-size:11.5px; line-height:1.5;">
          📍 <b>Немає зсунутих вулиць</b><br>
          Коли ви перетягуєте мітку і тиснете «Підтвердити», вулиця з'явиться тут, а нові повідомлення ставатимуть на нове місце.<br>
          Зараз усі вулиці мають заводські координати зі <b>streets.js</b>.
        </div>
      `;
      return;
    }

    entries.forEach(([key, item]) => {
      if (!item || !item.street) return;
      const streetName = item.street;
      const lat = Number(item.lat).toFixed(5);
      const lng = Number(item.lng).toFixed(5);
      const timeStr = formatDateTime(item.updated_at);

      const row = document.createElement("div");
      row.className = "mem-full-card";
      row.style.borderLeftColor = "#38bdf8";
      row.innerHTML = `
        <div class="mem-full-info">
          <div class="mem-full-rule" style="color:#38bdf8; font-size:13px;">📍 ${streetName}</div>
          <div style="font-family:monospace; font-size:10.5px; color:#f1f5f9; margin-top:2px;">lat: ${lat}, lng: ${lng}</div>
          <div class="mem-full-time">${timeStr}</div>
        </div>
        <div class="mem-full-acts">
          <button class="btn-mem-edit-override" title="Виправити назву або координати">✏️</button>
          <button class="btn-mem-show-map" title="Показати місце на карті">🎯 На карті</button>
          <button class="btn-mem-reset-coords" title="Повернути координати до стандартних зі streets.js">🔄 Скинути</button>
        </div>
      `;

      row.querySelector(".btn-mem-edit-override").addEventListener("click", () => editStreetOverride(key, item));
      row.querySelector(".btn-mem-show-map").addEventListener("click", () => showOverrideOnMap(item));
      row.querySelector(".btn-mem-reset-coords").addEventListener("click", () => resetStreetCoords(key, streetName));
      box.appendChild(row);
    });
  }

  // Редагування запису у папці «Зсунуті вулиці»
  async function editStreetOverride(key, item) {
    const oldStreet = item.street || key;
    const newStreet = prompt("✏️ Виправте офіційну назву вулиці (без номерів будинків):", oldStreet);
    if (newStreet === null) return;
    const cleanStreet = newStreet.trim();
    if (!cleanStreet) {
      alert("❌ Назва вулиці не може бути порожньою!");
      return;
    }

    const curCoords = `${Number(item.lat).toFixed(5)}, ${Number(item.lng).toFixed(5)}`;
    const newCoords = prompt("🌐 Координати вулиці (lat, lng):", curCoords);
    if (newCoords === null) return;

    const parts = newCoords.split(',').map(s => parseFloat(s.trim()));
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
      alert("❌ Некоректні координати! Приклад: 48.47595, 34.99346");
      return;
    }

    const newLat = Number(parts[0].toFixed(5));
    const newLng = Number(parts[1].toFixed(5));
    const newKey = toFirebaseKey(cleanStreet);

    const updatedItem = {
      street: cleanStreet,
      lat: newLat,
      lng: newLng,
      updated_at: Date.now()
    };

    // Якщо назва змінилася — видаляємо старий ключ з бази
    if (newKey !== key) {
      delete streetOverrides[key];
      await fetch(FB_OVERRIDES_URL.replace(".json", `/${key}.json`), { method: "DELETE" }).catch(() => {});
    }

    streetOverrides[newKey] = updatedItem;

    // Оновлюємо в пам'яті карти DNIPRO_STREETS_MAP
    if (window.DNIPRO_STREETS_MAP) {
      for (const mapItem of Object.values(window.DNIPRO_STREETS_MAP)) {
        if (mapItem && mapItem.name && mapItem.name.toLowerCase().trim() === cleanStreet.toLowerCase().trim()) {
          if (mapItem._origLat === undefined) {
            mapItem._origLat = mapItem.lat;
            mapItem._origLng = mapItem.lng;
          }
          mapItem.lat = newLat;
          mapItem.lng = newLng;
          mapItem._isOverridden = true;
        }
      }
    }

    // Зберігаємо оновлений запис у Firebase
    await fetch(FB_OVERRIDES_URL.replace(".json", `/${newKey}.json`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedItem)
    }).catch(() => {});

    try {
      localStorage.setItem("radar_street_overrides", JSON.stringify(streetOverrides));
    } catch(e) {}

    renderOverridesList();
    if (typeof window.showToast === "function") window.showToast(`✅ Запис оновлено: «${cleanStreet}»!`);
    if (typeof window.renderMarkers === "function") window.renderMarkers();
    if (typeof window.renderTrafficLights === "function") window.renderTrafficLights();
  }

  // Показ місця на карті з жовтим пульсуючим маяком
  function showOverrideOnMap(item) {
    if (!item || !item.lat || !item.lng) return;
    closeFullModal();

    if (!window.map) return;

    if (activeOverrideBeacon) {
      window.map.removeLayer(activeOverrideBeacon);
      activeOverrideBeacon = null;
    }

    const lat = Number(item.lat);
    const lng = Number(item.lng);

    window.map.flyTo([lat, lng], 17, { animate: true, duration: 0.85 });

    const beaconIcon = L.divIcon({
      className: 'yellow-beacon-container',
      html: `<div class="yellow-beacon-outer" title="Натисніть для повернення у список зсунутих вулиць"></div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    activeOverrideBeacon = L.marker([lat, lng], {
      icon: beaconIcon,
      zIndexOffset: 15000,
      interactive: true
    }).addTo(window.map);

    // Клік по жовтому шарику повертає назад до папки «Зсунуті вулиці»
    activeOverrideBeacon.on('click', (e) => {
      if (e && e.originalEvent) {
        e.originalEvent.stopPropagation();
      }
      if (activeOverrideBeacon) {
        window.map.removeLayer(activeOverrideBeacon);
        activeOverrideBeacon = null;
      }
      openFullModal();
      switchTab("overrides");
    });

    if (typeof window.showToast === "function") {
      window.showToast(`🎯 «${item.street}»: натисніть на жовту крапку для повернення до списку`, 4000);
    }
  }

  async function resetStreetCoords(key, streetName) {
    if (!confirm(`Скинути координати вулиці «${streetName}» до заводських із файлу streets.js?`)) return;

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
      alert("Помилка скидання: " + e.message);
    }
  }

  // Очистка спама бота
  btnCleanGarbage.addEventListener("click", async () => {
    if (!confirm("Видалити з пам'яті синонімів довгі тексти повідомлень, які автоматично залив бот?")) return;

    let removed = 0;
    for (const [key, item] of Object.entries(cloudRules)) {
      const phrase = item.alias || item.phrase || "";
      const isJunk = phrase.length > 35 || /\b(чисто|патруль|блок\s*пост|мусор|дастер|рено|тормоз|повернул|поехали)\b/i.test(phrase);

      if (isJunk) {
        removed++;
        delete cloudRules[key];
        fetch(FB_CUSTOM_URL.replace(".json", `/${key}.json`), { method: "DELETE" }).catch(() => {});
        if (window.DNIPRO_STREETS_MAP) delete window.DNIPRO_STREETS_MAP[phrase.toLowerCase()];
      }
    }

    renderFullList();
    if (typeof window.showToast === "function") window.showToast(`🧹 Видалено ${removed} спам-записів!`);
  });

  async function editRule(fbKey, item) {
    const oldAlias = item.alias || item.phrase || fbKey;
    const newAlias = prompt("🔑 Пошукове слово/фраза «А»:", oldAlias);
    if (newAlias === null) return;

    const newTarget = prompt("📍 Цільова назва вулиці «Б»:", item.name || item.address || "");
    if (newTarget === null) return;

    const newCoords = prompt("🌐 Координати (lat, lng):", `${item.lat},${item.lng}`);
    if (newCoords === null) return;

    const parts = newCoords.split(',').map(s => parseFloat(s.trim()));
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
      alert("❌ Некоректні координати! Приклад: 48.4840, 34.9850");
      return;
    }

    const cleanNewAlias = newAlias.trim().toLowerCase();
    const cleanNewTarget = newTarget.trim();
    const newFbKey = toFirebaseKey(cleanNewAlias);

    const updatedEntry = {
      alias: cleanNewAlias,
      phrase: cleanNewAlias,
      name: cleanNewTarget,
      address: cleanNewTarget,
      lat: Number(parts[0].toFixed(5)),
      lng: Number(parts[1].toFixed(5)),
      time: Date.now()
    };

    if (newFbKey !== fbKey) {
      delete cloudRules[fbKey];
      fetch(FB_CUSTOM_URL.replace(".json", `/${fbKey}.json`), { method: "DELETE" }).catch(() => {});
      if (window.DNIPRO_STREETS_MAP) delete window.DNIPRO_STREETS_MAP[oldAlias.toLowerCase()];
    }

    cloudRules[newFbKey] = updatedEntry;
    if (window.DNIPRO_STREETS_MAP) window.DNIPRO_STREETS_MAP[cleanNewAlias] = updatedEntry;

    await fetch(FB_CUSTOM_URL.replace(".json", `/${newFbKey}.json`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatedEntry)
    }).catch(() => {});

    renderFullList();
    if (typeof window.showToast === "function") window.showToast("✅ Правило оновлено!");
  }

  async function saveRule() {
    const alias = aliasInput.value.trim().toLowerCase();
    const target = targetInput.value.trim();

    if (!alias || !target) {
      alert("Заповніть обидва поля: [Що шукати] = [Куди вести]");
      return;
    }

    let lat = null, lng = null, realName = target;

    if (selectedTargetCoords && selectedTargetCoords.name === target) {
      lat = selectedTargetCoords.lat;
      lng = selectedTargetCoords.lng;
    } else {
      for (const lm of BUILTIN_LANDMARKS) {
        if (isSmartMatch(target, lm.name + " " + (lm.old || ""))) {
          lat = lm.lat; lng = lm.lng; realName = lm.name; break;
        }
      }
      if (!lat && typeof window.resolveLocationFromText === "function") {
        const res = window.resolveLocationFromText(target);
        if (res) { lat = res.lat; lng = res.lng; realName = res.name; }
      }
      if (!lat || !lng) {
        const netRes = await fetchOnlineLocations(target);
        if (netRes && netRes[0]) {
          lat = netRes[0].lat;
          lng = netRes[0].lng;
          realName = netRes[0].name;
        }
      }
    }

    if (!lat || !lng) {
      alert(`Не вдалося визначити координати для «${target}». Оберіть варіант зі списку.`);
      return;
    }

    const safeKey = toFirebaseKey(alias);
    const entry = {
      alias: alias,
      phrase: alias,
      name: realName,
      address: realName,
      lat: Number(lat.toFixed(5)),
      lng: Number(lng.toFixed(5)),
      time: Date.now()
    };

    cloudRules[safeKey] = entry;
    if (window.DNIPRO_STREETS_MAP) {
      window.DNIPRO_STREETS_MAP[alias] = entry;
    }

    await fetch(FB_CUSTOM_URL.replace(".json", `/${safeKey}.json`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    }).catch(() => {});

    if (Array.isArray(window.allPoints)) {
      window.allPoints.forEach(p => {
        const t = ((p.raw_text || p.text || "") + " " + (p.address || "")).toLowerCase();
        if (t.includes(alias)) {
          p.lat = entry.lat;
          p.lng = entry.lng;
          p.address = entry.name;
          p.needs_training = false;
        }
      });
    }

    if (typeof window.renderMarkers === "function") window.renderMarkers();
    if (typeof window.updateRouteStatus === "function") window.updateRouteStatus();
    if (window.map && window.map.flyTo) window.map.flyTo([entry.lat, entry.lng], 16, { animate: true, duration: 0.85 });

    aliasInput.value = "";
    targetInput.value = "";
    targetInput.classList.remove("autofilled");
    selectedTargetCoords = null;
    targetResults.style.display = "none";
    updateCountBadge();
    if (typeof window.showToast === "function") window.showToast(`✅ «${alias} = ${realName}» збережено!`);
  }

  saveBtn.addEventListener("click", saveRule);

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

  window.toFirebaseKey = toFirebaseKey;
  window.normalizeRadarSearch = normalizeSearchText;
  window.isRadarSmartMatch = isSmartMatch;
  window.fetchRadarOnlineLocations = fetchOnlineLocations;
  window.RADAR_BUILTIN_LANDMARKS = BUILTIN_LANDMARKS;
  window.openBindingJournal = openFullModal;
  window.showOverrideOnMap = showOverrideOnMap;

  setTimeout(loadCloudRules, 800);
})();
