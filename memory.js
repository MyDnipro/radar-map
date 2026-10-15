/**
 * Radar Dnipro — Модуль памяти топонимов ("А = Б")
 * Автономный виджет нижней панели [ 🧠 ]
 */
(function() {
  const FB_CUSTOM_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/custom_streets.json";
  let cloudRules = {};
  let selectedTargetCoords = null;

  function toFirebaseKey(str) {
    if (!str) return "key_" + Date.now();
    return encodeURIComponent(str.trim().toLowerCase())
      .replace(/%/g, "_")
      .replace(/\./g, "_")
      .replace(/\$/g, "_")
      .replace(/#/g, "_")
      .replace(/\[/g, "_") .replace(/\]/g, "_")
      .slice(0, 80);
  }

  // 1. Стили
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
      min-width: 200px;
      background: #0f172a;
      border: 1.5px solid #a855f7;
      border-radius: 8px;
      max-height: 190px;
      overflow-y: auto;
      z-index: 10005;
      display: none;
      margin-top: 4px;
      box-shadow: 0 8px 25px rgba(0,0,0,0.8);
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
      gap: 12px;
    }
    .mem-full-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 15px;
      font-weight: 800;
      color: #c084fc;
      border-bottom: 1.5px solid #334155;
      padding-bottom: 10px;
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
    .mem-full-acts { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
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
  `;
  document.head.appendChild(style);

  // 2. Разметка
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
      <span>📚 Журнал привязок ИИ</span>
      <span id="memFullCloseBtn" style="cursor:pointer; font-size:20px; padding:0 8px; color:#94a3b8;">✕</span>
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
    renderFullList();
    fullModal.style.display = "flex";
  }

  function closeFullModal() {
    fullModal.style.display = "none";
  }

  btn.addEventListener("click", toggleCard);
  closeBtn.addEventListener("click", toggleCard);
  viewAllBtn.addEventListener("click", openFullModal);
  fullCloseBtn.addEventListener("click", closeFullModal);

  let aliasDebounceTimer = null;
  aliasInput.addEventListener("input", () => {
    clearTimeout(aliasDebounceTimer);
    const query = aliasInput.value.trim().toLowerCase();
    targetInput.classList.remove("autofilled");

    if (query.length < 2) return;

    aliasDebounceTimer = setTimeout(() => {
      for (const rule of Object.values(cloudRules)) {
        if (!rule || !rule.name) continue;
        const phrase = (rule.alias || rule.phrase || "").toLowerCase();
        if (phrase === query || query.includes(phrase) || phrase.includes(query)) {
          targetInput.value = rule.name;
          targetInput.classList.add("autofilled");
          selectedTargetCoords = { lat: rule.lat, lng: rule.lng, name: rule.name };
          return;
        }
      }

      if (window.DNIPRO_STREETS_MAP) {
        for (const [key, item] of Object.entries(window.DNIPRO_STREETS_MAP)) {
          if (query.includes(key) || key.includes(query)) {
            targetInput.value = item.name;
            targetInput.classList.add("autofilled");
            selectedTargetCoords = { lat: item.lat, lng: item.lng, name: item.name };
            return;
          }
        }
      }
    }, 250);
  });

  let targetDebounceTimer = null;
  targetInput.addEventListener("input", () => {
    clearTimeout(targetDebounceTimer);
    selectedTargetCoords = null;
    targetInput.classList.remove("autofilled");
    const query = targetInput.value.trim();

    if (query.length < 2) {
      targetResults.style.display = "none";
      targetResults.innerHTML = "";
      return;
    }

    targetDebounceTimer = setTimeout(async () => {
      const lower = query.toLowerCase();
      targetResults.innerHTML = "";
      const matches = [];

      for (const rule of Object.values(cloudRules)) {
        if (!rule || !rule.lat || !rule.lng) continue;
        const phrase = (rule.alias || rule.phrase || "").toLowerCase();
        const nameLower = (rule.name || "").toLowerCase();
        if (nameLower.includes(lower) || phrase.includes(lower)) {
          if (!matches.some(m => m.name === rule.name)) {
            matches.push({
              name: rule.name,
              lat: rule.lat,
              lng: rule.lng,
              badge: "🧠",
              subtext: phrase ? `(память: ${phrase})` : ""
            });
          }
        }
      }

      if (window.DNIPRO_STREETS_MAP) {
        const sortedKeys = Object.keys(window.DNIPRO_STREETS_MAP).sort((a, b) => b.length - a.length);
        for (const k of sortedKeys) {
          const item = window.DNIPRO_STREETS_MAP[k];
          if (k.includes(lower) || (item.old && item.old.toLowerCase().includes(lower)) || item.name.toLowerCase().includes(lower)) {
            if (!matches.some(m => m.name === item.name)) {
              matches.push({
                name: item.name,
                lat: item.lat,
                lng: item.lng,
                badge: "📍",
                subtext: item.old ? `(бывшая: ${item.old})` : ""
              });
            }
          }
        }
      }

      matches.forEach(item => {
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
        targetResults.appendChild(div);
      });

      if (matches.length < 4 && query.length >= 3) {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ", Дніпро")}&countrycodes=ua&limit=3`;
          const res = await fetch(url);
          const data = await res.json();
          if (data && data.length > 0) {
            data.forEach(osmItem => {
              const name = osmItem.display_name.split(",")[0];
              if (!matches.some(m => m.name.toLowerCase().includes(name.toLowerCase()))) {
                const div = document.createElement("div");
                div.className = "mem-search-item";
                div.innerHTML = `🌐 ${name}`;
                div.onclick = () => {
                  targetInput.value = name;
                  selectedTargetCoords = { lat: parseFloat(osmItem.lat), lng: parseFloat(osmItem.lon), name: name };
                  targetResults.style.display = "none";
                };
                targetResults.appendChild(div);
              }
            });
          }
        } catch(e) {}
      }

      targetResults.style.display = targetResults.children.length > 0 ? "block" : "none";
    }, 200);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".mem-input-wrap")) {
      targetResults.style.display = "none";
    }
  });

  function formatDateTime(ts) {
    if (!ts) return "Время не указано";
    const d = new Date(ts);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `📅 ${day}.${month}.${year} 🕒 ${hours}:${minutes}`;
  }

  async function loadCloudRules() {
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
  }

  function updateCountBadge() {
    const badge = document.getElementById("memCountBadge");
    if (badge) badge.innerText = Object.keys(cloudRules).length;
  }

  function renderFullList() {
    const box = document.getElementById("memFullList");
    if (!box) return;
    box.innerHTML = "";

    const entries = Object.entries(cloudRules);
    updateCountBadge();

    if (entries.length === 0) {
      box.innerHTML = '<span style="font-size:12px; color:#64748b; text-align:center; margin-top:30px;">Нет сохраненных правил</span>';
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
          <div class="mem-full-time">${timeStr} <span style="color:#64748b;">(${Number(item.lat).toFixed(4)}, ${Number(item.lng).toFixed(4)})</span></div>
        </div>
        <div class="mem-full-acts">
          <button class="btn-mem-edit" title="Редактировать">✏️</button>
          <button class="btn-mem-del" title="Удалить">🗑️</button>
        </div>
      `;

      row.querySelector(".btn-mem-edit").addEventListener("click", () => editRule(fbKey, item));
      row.querySelector(".btn-mem-del").addEventListener("click", () => deleteRule(fbKey));
      box.appendChild(row);
    });
  }

  async function editRule(fbKey, item) {
    const oldAlias = item.alias || item.phrase || fbKey;
    const newAlias = prompt("🔑 Поисковое слово/фраза «А»:", oldAlias);
    if (newAlias === null) return;

    const newTarget = prompt("📍 Целевое название улицы «Б»:", item.name || item.address || "");
    if (newTarget === null) return;

    const newCoords = prompt("🌐 Координаты (lat, lng):", `${item.lat}, ${item.lng}`);
    if (newCoords === null) return;

    const parts = newCoords.split(',').map(s => parseFloat(s.trim()));
    if (parts.length !== 2 || isNaN(parts[0]) || isNaN(parts[1])) {
      alert("❌ Некорректные координаты! Пример: 48.4840, 34.9850");
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
    if (typeof window.showToast === "function") window.showToast("✅ Правило обновлено!");
  }

  async function saveRule() {
    const alias = aliasInput.value.trim().toLowerCase();
    const target = targetInput.value.trim();

    if (!alias || !target) {
      alert("Заполните оба поля: [Что искать] = [Куда вести]");
      return;
    }

    let lat = null, lng = null, realName = target;

    if (selectedTargetCoords && selectedTargetCoords.name === target) {
      lat = selectedTargetCoords.lat;
      lng = selectedTargetCoords.lng;
    } else {
      if (typeof window.resolveLocationFromText === "function") {
        const res = window.resolveLocationFromText(target);
        if (res) { lat = res.lat; lng = res.lng; realName = res.name; }
      }

      if (!lat || !lng) {
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(target + ", Дніпро")}&countrycodes=ua&limit=1`);
          const data = await r.json();
          if (data && data[0]) {
            lat = parseFloat(data[0].lat);
            lng = parseFloat(data[0].lon);
            realName = data[0].display_name.split(",")[0];
          }
        } catch(e) {}
      }
    }

    if (!lat || !lng) {
      alert(`Не удалось определить координаты для «${target}». Выберите вариант из списка подсказок.`);
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
    if (typeof window.showToast === "function") window.showToast(`✅ «${alias} = ${realName}» сохранено!`);
  }

  saveBtn.addEventListener("click", saveRule);

  async function deleteRule(fbKey) {
    if (!confirm("Удалить это правило из памяти?")) return;
    const item = cloudRules[fbKey];
    const aliasName = (item?.alias || item?.phrase || fbKey).toLowerCase();

    delete cloudRules[fbKey];
    if (window.DNIPRO_STREETS_MAP) {
      delete window.DNIPRO_STREETS_MAP[aliasName];
    }

    await fetch(FB_CUSTOM_URL.replace(".json", `/${fbKey}.json`), { method: "DELETE" }).catch(() => {});
    renderFullList();
    if (typeof window.showToast === "function") window.showToast("🗑️ Правило удалено!");
  }

  window.toFirebaseKey = toFirebaseKey;
  setTimeout(loadCloudRules, 1000);
})();
