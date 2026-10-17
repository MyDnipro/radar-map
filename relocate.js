/**
 * relocate.js — Модуль перенесення міток, розумного навчання та керування базою знань (v4.0)
 */

(function () {
  const FIREBASE_POINTS_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/points.json";
  const FIREBASE_KB_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/knowledge_base.json";

  // =========================================================================
  // 1. АЛГОРИТМ ВИТЯГУВАННЯ ЧИСТОЇ НАЗВИ ВУЛИЦІ (БЕЗ БУСІВ, СМАЙЛІВ ТА СТАТУСІВ)
  // =========================================================================
  function extractCleanLocationPhrase(rawText, targetStreetName) {
    if (!rawText) return "";

    let s = rawText
      // Видаляємо всі емодзі та спецсимволи
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, " ")
      .replace(/&#\d+;/g, " ")
      .replace(/[,.!?:;\"'«»()–—\/\\]/g, " ")
      .toLowerCase();

    // Дорожній шум, статуси, авто та зайві дієслова
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

    // Якщо передано офіційну назву вулиці — знаходимо точне слово у повідомленні
    if (targetStreetName) {
      const cleanTarget = targetStreetName.toLowerCase()
        .replace(/(?:вулиця|проспект|просп|провулок|вул|шосе|тупик|узвіз)\.?/gi, "")
        .trim();

      const parts = cleanTarget.split(/\s+/).filter(w => w.length >= 4);

      for (const p of parts) {
        const root = p.slice(0, -2); // Корінь слова (наприклад, "богомаз", "сикорск")
        const words = s.split(" ");
        const matchedWord = words.find(w => w.includes(root));

        if (matchedWord) {
          const mIdx = words.indexOf(matchedWord);
          // Якщо це ім'я + прізвище (наприклад, "ігоря сікорського")
          if (mIdx > 0 && ["игоря", "ігоря", "академика", "академіка", "олександра", "маршала", "генерала"].includes(words[mIdx - 1])) {
            return `${words[mIdx - 1]} ${matchedWord}`;
          }
          // Якщо орієнтир типу "от апполо к метеору"
          if (words.length <= 4 && words.length > 1) {
            return s.replace(/^\s*(?:на|по|в|до|от)\s+/i, "").trim();
          }
          return matchedWord;
        }
      }
    }

    // Зрізаємо залишки прийменників на краях
    s = s.replace(/^\s*(?:на|по|в|до|от|біля|возле|коло)\s+/i, "");
    s = s.replace(/\s+(?:на|по|в|до|от)\$/i, "");
    s = s.replace(/\s+/g, " ").trim();

    return s.length >= 3 ? s : rawText.trim();
  }

  // =========================================================================
  // 2. ВІДКРИТТЯ МОДАЛКИ ПЕРЕНЕСЕННЯ ЗА АДРЕСОЮ
  // =========================================================================
  window.openTrainingModal = function (point, marker) {
    window.activeActionPoint = point;
    window.activeActionMarker = marker;

    const modal = document.getElementById("trainModal");
    const quoteEl = document.getElementById("trainTextQuote");
    const inputEl = document.getElementById("trainCustomInput");
    const resultsEl = document.getElementById("trainSearchResults");

    if (!modal) return;

    const rawText = point.text || point.raw_text || "";
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

  window.closeTrainModal = function (e) {
    if (e && e.target && e.target.id !== "trainModal" && !e.target.closest(".train-modal-card")) return;
    const modal = document.getElementById("trainModal");
    if (modal) modal.style.display = "none";
  };

  // =========================================================================
  // 3. ПОШУК ВУЛИЦЬ У СПИСКУ
  // =========================================================================
  window.executeCustomTrain = function () {
    const inputEl = document.getElementById("trainCustomInput");
    const resultsEl = document.getElementById("trainSearchResults");
    if (!inputEl || !resultsEl) return;

    const q = inputEl.value.trim().toLowerCase();
    if (q.length < 2) {
      resultsEl.style.display = "none";
      return;
    }

    resultsEl.innerHTML = "";
    const matches = [];

    if (typeof DNIPRO_STREETS_MAP !== "undefined") {
      for (const [key, item] of Object.entries(DNIPRO_STREETS_MAP)) {
        if (key.includes(q) || (item.old && item.old.toLowerCase().includes(q)) || item.name.toLowerCase().includes(q)) {
          if (!matches.some(m => m.name === item.name)) matches.push(item);
        }
      }
    }

    if (matches.length === 0) {
      resultsEl.innerHTML = `<div style="padding:8px 10px; font-size:11px; color:#94a3b8;">Вулицю не знайдено. Спробуйте іншу назву.</div>`;
      resultsEl.style.display = "block";
      return;
    }

    matches.slice(0, 7).forEach(st => {
      const row = document.createElement("div");
      row.className = "search-item";
      row.innerHTML = `📍 <b>${st.name}</b> ${st.old ? `<span style="font-size:10px; color:#94a3b8;">(\${st.old})</span>` : ""}`;
      row.onclick = () => selectStreetForRelocation(st);
      resultsEl.appendChild(row);
    });

    resultsEl.style.display = "block";
  };

  const trainInput = document.getElementById("trainCustomInput");
  if (trainInput) {
    trainInput.addEventListener("input", () => {
      if (trainInput.value.trim().length >= 2) window.executeCustomTrain();
      else {
        const res = document.getElementById("trainSearchResults");
        if (res) res.style.display = "none";
      }
    });
  }

  // =========================================================================
  // 4. ПІДТВЕРДЖЕННЯ ПЕРЕНЕСЕННЯ ТА ЗБЕРЕЖЕННЯ ОЧИЩЕНОГО ПРАВИЛА
  // =========================================================================
  function selectStreetForRelocation(streetObj) {
    const p = window.activeActionPoint;
    if (!p) return;

    window.closeTrainModal();

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
      window.map.flyTo([streetObj.lat, streetObj.lng], 15.5, { animate: true, duration: 0.8 });
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

    // ВИТЯГУЄМО ЧИСТУ НАЗВУ ВУЛИЦІ
    const cleanRulePhrase = extractCleanLocationPhrase(rawText, pr.streetName);

    p.lat = Number(pr.targetLat.toFixed(5));
    p.lng = Number(pr.targetLng.toFixed(5));
    p.address = pr.streetName;
    p.needs_training = false;
    p.geo_refined = true;

    // Зберігаємо зміну точки у Firebase
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

    // Зберігаємо чисте правило в Базу Знань
    if (cleanRulePhrase && cleanRulePhrase.length >= 3) {
      saveRuleToKnowledgeBase(cleanRulePhrase, pr.streetName, p.lat, p.lng);
    }

    window.pendingRelocation = null;
    if (typeof showToast === "function") showToast(`✅ Закріплено: «${cleanRulePhrase}» ➔ ${pr.streetName}`);
    if (typeof renderMarkers === "function") renderMarkers();
    if (typeof renderTrafficLights === "function") renderTrafficLights();
    if (typeof updateRouteStatus === "function") updateRouteStatus();
  };

  window.finalizeMoveManual = function () {
    const modal = document.getElementById("confirmMoveModal");
    if (modal) modal.style.display = "none";

    const pr = window.pendingRelocation;
    if (!pr || !pr.point) return;

    const fbKey = pr.point._fbKey;
    window.pendingRelocation = null;
    if (typeof startDirectManualDrag === "function") {
      startDirectManualDrag(fbKey);
    }
  };

  async function saveRuleToKnowledgeBase(phrase, streetName, lat, lng) {
    const ruleObj = {
      phrase: phrase,
      street: streetName,
      lat: lat,
      lng: lng,
      created_at: Date.now()
    };

    // 1. Локальна пам'ять
    try {
      let rules = JSON.parse(localStorage.getItem("radar_learned_rules") || "[]");
      rules = rules.filter(r => r.phrase !== phrase);
      rules.push(ruleObj);
      localStorage.setItem("radar_learned_rules", JSON.stringify(rules));
    } catch (e) {}

    // 2. Хмара Firebase
    try {
      await fetch(FIREBASE_KB_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ruleObj)
      });
    } catch (e) {}
  }

  // =========================================================================
  // 5. РУЧНЕ ОЧИЩЕННЯ БАЗИ ВІД СМІТТЯ (ЗАПУСКАЄТЬСЯ ТІЛЬКИ ПО КНОПЦІ)
  // =========================================================================
  window.cleanAllExistingRules = async function () {
    if (!confirm("Очистити всі наявні правила в базі від сміття (смайлів, описів авто та слів 'блокпост/чисто')?")) {
      return;
    }

    if (typeof showToast === "function") showToast("⏳ Очищення бази знань...");

    try {
      const res = await fetch(`${FIREBASE_KB_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error("Помилка підключення");
      const data = await res.json();
      if (!data) return;

      let cleanedCount = 0;
      const updatedLocalRules = [];

      for (const [key, item] of Object.entries(data)) {
        if (!item) continue;
        const oldPhrase = item.phrase || item.text || item.raw_text || "";
        const targetStreet = item.street || item.name || item.address || "";
        const cleanP = extractCleanLocationPhrase(oldPhrase, targetStreet);

        if (cleanP && cleanP !== oldPhrase) {
          item.phrase = cleanP;
          cleanedCount++;
          // Оновлюємо тільки поле phrase в Firebase
          fetch(`https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/knowledge_base/${key}.json`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phrase: cleanP })
          }).catch(() => {});
        }
        updatedLocalRules.push(item);
      }

      localStorage.setItem("radar_learned_rules", JSON.stringify(updatedLocalRules));

      if (typeof showToast === "function") {
        showToast(`🧹 Очищено правил: ${cleanedCount}!`);
      }
      renderBindingJournal();
    } catch (e) {
      alert("Помилка очищення: " + e.message);
    }
  };

  // =========================================================================
  // 6. ЖУРНАЛ ПРИВ'ЯЗОК ІІ (ПЕРЕГЛЯД, РЕДАГУВАННЯ, ВИДАЛЕННЯ)
  // =========================================================================
  window.openBindingJournal = async function () {
    let journalModal = document.getElementById("bindingJournalModal");
    if (!journalModal) {
      journalModal = document.createElement("div");
      journalModal.id = "bindingJournalModal";
      journalModal.className = "action-sheet-backdrop";
      journalModal.style.zIndex = "4000";
      journalModal.onclick = (e) => {
        if (e.target.id === "bindingJournalModal") journalModal.style.display = "none";
      };

      journalModal.innerHTML = `
        <div class="action-sheet-card" style="max-height:85vh; display:flex; flex-direction:column; padding:16px;" onclick="event.stopPropagation()">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #334155; padding-bottom:8px;">
            <div style="font-size:14px; font-weight:900; color:#38bdf8;">📚 Журнал прив'язок ІІ</div>
            <div style="display:flex; gap:8px; align-items:center;">
              <button onclick="window.cleanAllExistingRules()" style="background:#1e293b; border:1px solid #0284c7; color:#38bdf8; font-size:10px; font-weight:800; padding:5px 8px; border-radius:6px; cursor:pointer;" title="Очистити всі записи від сміття">🧹 Очистити від сміття</button>
              <span style="cursor:pointer; font-size:16px; color:#94a3b8; font-weight:800; padding:0 4px;" onclick="document.getElementById('bindingJournalModal').style.display='none'">✕</span>
            </div>
          </div>
          <div id="journalItemsList" style="overflow-y:auto; flex:1; display:flex; flex-direction:column; gap:8px;">
            <div style="text-align:center; padding:20px; color:#94a3b8; font-size:11px;">Завантаження бази знань...</div>
          </div>
        </div>
      `;
      document.body.appendChild(journalModal);
    }

    journalModal.style.display = "flex";
    renderBindingJournal();
  };

  async function renderBindingJournal() {
    const listEl = document.getElementById("journalItemsList");
    if (!listEl) return;

    try {
      const res = await fetch(`${FIREBASE_KB_URL}?t=${Date.now()}`);
      if (!res.ok) throw new Error();
      const data = await res.json();

      if (!data || Object.keys(data).length === 0) {
        listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#94a3b8; font-size:11px;">База знань порожня.</div>`;
        return;
      }

      const entries = Object.entries(data).reverse();
      let html = "";

      entries.forEach(([key, item]) => {
        if (!item) return;
        const phrase = item.phrase || item.text || item.raw_text || "—";
        const street = item.street || item.name || item.address || "Невідомо";
        const dateStr = item.created_at ? new Date(item.created_at).toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' }) : "17.10.2026";
        const timeStr = item.created_at ? new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "12:00";
        const coordsStr = item.lat && item.lng ? `(${Number(item.lat).toFixed(4)}, ${Number(item.lng).toFixed(4)})` : "";

        html += `
          <div style="background:#0b1120; border:1px solid #1e293b; border-radius:10px; padding:10px; display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <div style="flex:1; min-width:0;">
              <div style="font-size:11.5px; font-weight:800; color:#f1f5f9; line-height:1.4;">
                «<span style="color:#f87171;">${phrase}</span>» ➔ <span style="color:#38bdf8;">${street}</span>
              </div>
              <div style="font-size:9.5px; color:#64748b; margin-top:4px;">
                📅 ${dateStr} 🕒 ${timeStr} ${coordsStr}
              </div>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              <button onclick="editJournalRule('${key}', '${encodeURIComponent(phrase)}')" style="background:#0284c7; border:none; color:#fff; width:28px; height:28px; border-radius:6px; cursor:pointer; font-size:12px; display:flex; align-items:center; justify-content:center;" title="Редагувати фразу">✏️</button>
              <button onclick="deleteJournalRule('${key}')" style="background:#7f1d1d; border:none; color:#fca5a5; width:28px; height:28px; border-radius:6px; cursor:pointer; font-size:12px; display:flex; align-items:center; justify-content:center;" title="Видалити правило">🗑️</button>
            </div>
          </div>
        `;
      });

      listEl.innerHTML = html;
    } catch (e) {
      listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#ef4444; font-size:11px;">Помилка зв'язку з базою знань.</div>`;
    }
  }

  window.deleteJournalRule = async function (key) {
    if (!confirm("Видалити це правило прив'язки назавжди?")) return;
    try {
      await fetch(`https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/knowledge_base/${key}.json`, { method: "DELETE" });
      if (typeof showToast === "function") showToast("🗑️ Правило видалено");
      renderBindingJournal();
    } catch (e) {
      alert("Помилка видалення: " + e.message);
    }
  };

  window.editJournalRule = async function (key, encodedOldPhrase) {
    const oldPhrase = decodeURIComponent(encodedOldPhrase);
    const newPhrase = prompt("Введіть точну ключову фразу для правила:", oldPhrase);
    if (!newPhrase || newPhrase.trim() === oldPhrase) return;

    try {
      await fetch(`https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/knowledge_base/${key}.json`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phrase: newPhrase.trim().toLowerCase() })
      });
      if (typeof showToast === "function") showToast("✏️ Правило оновлено");
      renderBindingJournal();
    } catch (e) {
      alert("Помилка збереження: " + e.message);
    }
  };

})();
