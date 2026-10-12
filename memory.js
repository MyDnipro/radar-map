/**
 * Radar Dnipro — Модуль пам'яті топонімів ("А = Б")
 * Повністю автономний віджет (кнопка з мозком 🧠)
 */
(function() {
  const FB_CUSTOM_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/custom_streets.json";
  let cloudRules = {};

  // 1. Впровадження стилів у сторінку
  const style = document.createElement("style");
  style.textContent = `
    #memWidget {
      position: absolute !important;
      bottom: 75px !important;
      right: 15px !important;
      z-index: 2200 !important;
      user-select: none;
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
      transition: transform 0.2s ease;
    }
    #memBtn:active { transform: scale(0.92); }
    #memCard {
      display: none;
      width: 300px;
      max-width: calc(100vw - 30px);
      background: rgba(15, 23, 42, 0.98);
      backdrop-filter: blur(12px);
      border: 1.5px solid #a855f7;
      border-radius: 14px;
      padding: 12px;
      color: #fff;
      box-shadow: 0 10px 35px rgba(0, 0, 0, 0.75);
      flex-direction: column;
      gap: 8px;
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
    .mem-row { display: flex; align-items: center; gap: 4px; }
    .mem-input {
      flex: 1;
      background: #0b1120;
      border: 1px solid #475569;
      color: #fff;
      padding: 6px 8px;
      border-radius: 6px;
      font-size: 11px;
      outline: none;
    }
    .mem-input:focus { border-color: #c084fc; }
    .btn-mem-save {
      background: #9333ea;
      border: none;
      color: #fff;
      padding: 7px 10px;
      border-radius: 7px;
      font-size: 11px;
      font-weight: 800;
      cursor: pointer;
      width: 100%;
      margin-top: 2px;
    }
    .btn-mem-save:hover { background: #a855f7; }
    .mem-list-box {
      max-height: 120px;
      overflow-y: auto;
      background: #070d1d;
      border-radius: 6px;
      padding: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 4px;
    }
    .mem-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 10px;
      color: #cbd5e1;
      border-bottom: 1px solid #1e293b;
      padding: 3px 0;
    }
  `;
  document.head.appendChild(style);

  // 2. Створення розмітки віджета
  const widget = document.createElement("div");
  widget.id = "memWidget";
  widget.innerHTML = `
    <div id="memBtn" title="Пам'ять топонімів (А = Б)">🧠</div>
    <div id="memCard">
      <div class="mem-header">
        <span>🧠 Пам'ять топонімів ("А = Б")</span>
        <span id="memCloseBtn" style="cursor:pointer; font-size:15px; padding:0 4px;">✕</span>
      </div>
      <div class="mem-row">
        <input type="text" id="memAlias" class="mem-input" placeholder="Що шукати (напр. карла маркса)">
        <span style="font-weight:900; color:#c084fc;">=</span>
        <input type="text" id="memTarget" class="mem-input" placeholder="Куди вести (напр. Яворницького)">
      </div>
      <button class="btn-mem-save" id="memSaveBtn">💾 Зберегти в пам'ять</button>
      <div style="font-size:10px; font-weight:800; color:#94a3b8; margin-top:2px;">Збережені прив'язки:</div>
      <div id="memList" class="mem-list-box">
        <span style="font-size:10px; color:#64748b;">Завантаження...</span>
      </div>
    </div>
  `;
  document.body.appendChild(widget);

  // 3. Захист від передачі кліків на карту Leaflet
  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(widget);
    L.DomEvent.disableScrollPropagation(widget);
  }

  const btn = document.getElementById("memBtn");
  const card = document.getElementById("memCard");
  const closeBtn = document.getElementById("memCloseBtn");
  const saveBtn = document.getElementById("memSaveBtn");

  function toggleCard() {
    const isOpen = card.style.display === "flex";
    card.style.display = isOpen ? "none" : "flex";
    btn.style.display = isOpen ? "flex" : "none";
    if (!isOpen) renderList();
  }

  btn.addEventListener("click", toggleCard);
  closeBtn.addEventListener("click", toggleCard);

  // 4. Завантаження збережених правил із Firebase
  async function loadCloudRules() {
    try {
      const res = await fetch(`${FB_CUSTOM_URL}?t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data === "object") {
          cloudRules = data;
          Object.entries(data).forEach(([rawKey, item]) => {
            if (item && item.lat && item.lng && window.DNIPRO_STREETS_MAP) {
              window.DNIPRO_STREETS_MAP[decodeURIComponent(rawKey).toLowerCase()] = item;
            }
          });
          renderList();
        }
      }
    } catch(e) {}
  }

  // 5. Відображення списку правил із кнопкою видалення
  function renderList() {
    const box = document.getElementById("memList");
    if (!box) return;
    box.innerHTML = "";
    const entries = Object.entries(cloudRules);
    if (entries.length === 0) {
      box.innerHTML = '<span style="font-size:10px; color:#64748b;">Немає збережених зв\'язок</span>';
      return;
    }
    entries.forEach(([rawKey, item]) => {
      const key = decodeURIComponent(rawKey);
      const row = document.createElement("div");
      row.className = "mem-item";
      row.innerHTML = `
        <span>«${key}» ➔ <b>${item.name}</b></span>
        <span style="color:#ef4444; cursor:pointer; font-weight:800; padding:2px;" title="Видалити">🗑️</span>
      `;
      row.querySelector("span[title='Видалити']").addEventListener("click", () => deleteRule(rawKey));
      box.appendChild(row);
    });
  }

  // 6. Збереження нового правила
  async function saveRule() {
    const aliasInput = document.getElementById("memAlias");
    const targetInput = document.getElementById("memTarget");
    const alias = aliasInput.value.trim().toLowerCase();
    const target = targetInput.value.trim();

    if (!alias || !target) {
      alert("Заповніть обидва поля: [Що шукати] = [Куди вести]");
      return;
    }

    let lat = null, lng = null, realName = target;
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

    if (!lat || !lng) {
      alert(`Не вдалося знайти координати для «${target}».`);
      return;
    }

    const entry = { name: realName, lat: Number(lat.toFixed(5)), lng: Number(lng.toFixed(5)), time: Date.now() };
    const safeKey = encodeURIComponent(alias).replace(/\./g, "%2E");

    cloudRules[safeKey] = entry;
    if (window.DNIPRO_STREETS_MAP) {
      window.DNIPRO_STREETS_MAP[alias] = entry;
    }

    fetch(FB_CUSTOM_URL.replace(".json", `/${safeKey}.json`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry)
    }).catch(() => {});

    // Переміщуємо відповідні точки на карті
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
    renderList();
    if (typeof window.showToast === "function") window.showToast(`✅ Зв'язку «${alias} = ${realName}» збережено!`);
  }

  saveBtn.addEventListener("click", saveRule);

  // 7. Видалення правила
  async function deleteRule(rawKey) {
    if (!confirm("Видалити цю прив'язку з пам'яті?")) return;
    delete cloudRules[rawKey];
    if (window.DNIPRO_STREETS_MAP) {
      delete window.DNIPRO_STREETS_MAP[decodeURIComponent(rawKey).toLowerCase()];
    }
    fetch(FB_CUSTOM_URL.replace(".json", `/${rawKey}.json`), { method: "DELETE" }).catch(() => {});
    renderList();
    if (typeof window.showToast === "function") window.showToast("🗑️ Прив'язку видалено!");
  }

  setTimeout(loadCloudRules, 1000);
})();
