/**
 * Radar Dnipro — Модуль пам'яті топонімів ("А = Б")
 * Автономний віджет із повноекранним журналом прив'язок за датами
 */
(function() {
  const FB_CUSTOM_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/custom_streets.json";
  let cloudRules = {};

  // 1. Стилі для віджета і повноекранного вікна
  const style = document.createElement("style");
  style.textContent = `
    #memWidget {
      position: absolute !important;
      bottom: 25px !important;
      left: 50% !important;
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
    .mem-row { display: flex; align-items: center; gap: 4px; width: 100%; box-sizing: border-box; }
    .mem-input {
      flex: 1;
      min-width: 0;
      background: #0b1120;
      border: 1px solid #475569;
      color: #fff;
      padding: 7px 8px;
      border-radius: 6px;
      font-size: 11px;
      outline: none;
      box-sizing: border-box;
    }
    .mem-input:focus { border-color: #c084fc; }
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

    /* Повноекранне вікно журналу прив'язок */
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
    .mem-full-info {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .mem-full-rule {
      font-size: 12px;
      color: #f8fafc;
      font-weight: 700;
      word-break: break-word;
      line-height: 1.35;
    }
    .mem-full-time {
      font-size: 10px;
      color: #94a3b8;
      display: flex;
      align-items: center;
      gap: 5px;
      font-weight: 600;
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
      flex-shrink: 0;
    }
  `;
  document.head.appendChild(style);

  // 2. Розмітка маленького віджета та повноекранного вікна
  const widget = document.createElement("div");
  widget.id = "memWidget";
  widget.innerHTML = `
    <div id="memBtn" title="Пам'ять топонімів (А = Б)">🧠</div>
    <div id="memCard">
      <div class="mem-header">
        <span>🧠 Пам'ять топонімів ("А = Б")</span>
        <span id="memCloseBtn" style="cursor:pointer; font-size:16px; padding:0 4px;">✕</span>
      </div>
      <div class="mem-row">
        <input type="text" id="memAlias" class="mem-input" placeholder="Що шукати (напр. карла маркса)">
        <span style="font-weight:900; color:#c084fc;">=</span>
        <input type="text" id="memTarget" class="mem-input" placeholder="Куди вести (напр. Яворницького)">
      </div>
      <button class="btn-mem-save" id="memSaveBtn">💾 Зберегти в пам'ять</button>
      <button class="btn-mem-view-all" id="memViewAllBtn">
        <span>📋 Збережені прив'язки:</span>
        <b id="memCountBadge" style="color:#c084fc;">0</b>
      </button>
    </div>
  `;
  document.body.appendChild(widget);

  const fullModal = document.createElement("div");
  fullModal.id = "memFullModal";
  fullModal.innerHTML = `
    <div class="mem-full-header">
      <span>📚 Журнал прив'язок ШІ</span>
      <span id="memFullCloseBtn" style="cursor:pointer; font-size:20px; padding:0 8px; color:#94a3b8;">✕</span>
    </div>
    <div id="memFullList" class="mem-full-list">
      <span style="font-size:12px; color:#64748b; text-align:center; margin-top:20px;">Завантаження...</span>
    </div>
  `;
  document.body.appendChild(fullModal);

  // 3. Захист від передачі кліків на карту
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

  function toggleCard() {
    const isOpen = card.style.display === "flex";
    card.style.display = isOpen ? "none" : "flex";
    btn.style.display = isOpen ? "flex" : "none";
  }

  function openFullModal() {
    card.style.display = "none";
    btn.style.display = "flex";
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

  function formatDateTime(ts) {
    if (!ts) return "Час не вказано";
    const d = new Date(ts);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `📅 ${day}.${month}.${year} 🕒 ${hours}:${minutes}`;
  }

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
          updateCountBadge();
        }
      }
    } catch(e) {}
  }

  function updateCountBadge() {
    const badge = document.getElementById("memCountBadge");
    if (badge) badge.innerText = Object.keys(cloudRules).length;
  }

  // 5. Відображення повного списку за датами
  function renderFullList() {
    const box = document.getElementById("memFullList");
    if (!box) return;
    box.innerHTML = "";

    const entries = Object.entries(cloudRules);
    updateCountBadge();

    if (entries.length === 0) {
      box.innerHTML = '<span style="font-size:12px; color:#64748b; text-align:center; margin-top:30px;">Немає збережених зв\'язок</span>';
      return;
    }

    // Сортуємо: свіжі зверху
    entries.sort((a, b) => (b[1].time || 0) - (a[1].time || 0));

    entries.forEach(([rawKey, item]) => {
      const key = decodeURIComponent(rawKey);
      const timeStr = formatDateTime(item.time);

      const row = document.createElement("div");
      row.className = "mem-full-card";
      row.innerHTML = `
        <div class="mem-full-info">
          <div class="mem-full-rule">«${key}» ➔ <span style="color:#38bdf8;">${item.name}</span></div>
          <div class="mem-full-time">${timeStr}</div>
        </div>
        <button class="btn-mem-del" title="Видалити">🗑️</button>
      `;

      row.querySelector(".btn-mem-del").addEventListener("click", () => deleteRule(rawKey));
      box.appendChild(row);
    });
  }

  // 6. Збереження правила
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
    updateCountBadge();
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
    renderFullList();
    if (typeof window.showToast === "function") window.showToast("🗑️ Прив'язку видалено!");
  }

  setTimeout(loadCloudRules, 1000);
})();
