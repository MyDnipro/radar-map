// =========================================================================
// 🎯 МОДУЛЬ ПЕРЕМІЩЕННЯ ТА НАВЧАННЯ МІТОК (RELOCATE ENGINE v4.0)
// =========================================================================

const FB_CUSTOM_STREETS_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/custom_streets.json";

/**
 * Інтелектуальне вичленення назви вулиці / топоніму з повідомлення
 * Вирізає час, статуси, смайлики та стоп-слова, залишаючи чисте ядро.
 */
function extractCleanStreetAlias(rawText, fallbackName) {
  if (!rawText) return (fallbackName || "").toLowerCase().trim();

  let t = rawText
    .replace(/[\r\n]+/g, " ")
    // Вирізаємо час (16:20, 16-20, на 16.20 тощо)
    .replace(/\b(?:\d{1,2}[:.-]\d{2})\b/g, " ")
    .replace(/\b(?:на\s+зараз|на\s+сейчас|тільки\s+що|только\s+что)\b/gi, " ")
    // Вирізаємо статуси небезпеки та чистоти
    .replace(/\b(?:чисто|чистенько|пусто|вільно|спокійно|проїзд|проїхав|проехали|норм|добре|ясно|сухо)\b/gi, " ")
    .replace(/\b(?:бп|блокпост|патруль|мент|полиц|поліц|тцк|бусик|зупиня|стоят|облав|мусор)\b/gi, " ")
    // Вирізаємо напрямки та розмовні суфікси
    .replace(/\b(?:в\s+обе\s+стороны|в\s+обе\s+к|в\s+сторону|направление|направлении|съезд|заезд|вверх|вниз)\b/gi, " ")
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}🟢🔴👍👌🤝🌞☀️🌤️❓]/gu, " ")
    // Вирізаємо прийменники
    .replace(/\b(?:біля|возле|около|район|на|до|угол|перехрестя|перекресток|по)\b/gi, " ")
    .replace(/[^a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  return t.length >= 3 ? t : (fallbackName || "").toLowerCase().trim();
}

function openTrainingModal(point, marker) {
  activeActionPoint = point;
  activeActionMarker = marker || findMarkerByPoint(point);

  const rawTxt = point.raw_text || point.text || "";
  const quoteEl = document.getElementById("trainTextQuote");
  if (quoteEl) quoteEl.innerText = `«${rawTxt}»`;

  const inp = document.getElementById("trainCustomInput");
  if (inp) {
    inp.value = "";
    setTimeout(() => inp.focus(), 150);
  }

  const res = document.getElementById("trainSearchResults");
  if (res) {
    res.innerHTML = "";
    res.style.display = "none";
  }

  const modal = document.getElementById("trainModal");
  if (modal) {
    modal.style.display = "flex";
    modal.scrollTop = 0;
  }
}

function closeTrainModal(e) {
  if (e && e.target && e.target.id !== "trainModal" && !e.target.closest(".train-modal-card")) return;
  const modal = document.getElementById("trainModal");
  if (modal) modal.style.display = "none";
  const res = document.getElementById("trainSearchResults");
  if (res) res.style.display = "none";
  setTimeout(() => { if (window.map) window.map.invalidateSize(); }, 120);
}

function smoothGlideMarker(marker, startLatLng, endLatLng, duration = 900, onDone = null) {
  if (!marker) { if (onDone) onDone(); return; }
  const startTime = performance.now();
  function animateStep(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);

    const currentLat = startLatLng.lat + (endLatLng.lat - startLatLng.lat) * ease;
    const currentLng = startLatLng.lng + (endLatLng.lng - startLatLng.lng) * ease;
    marker.setLatLng([currentLat, currentLng]);

    if (progress < 1) {
      requestAnimationFrame(animateStep);
    } else {
      marker.setLatLng(endLatLng);
      if (onDone) onDone();
    }
  }
  requestAnimationFrame(animateStep);
}

async function applyPointRelocation(streetName, lat, lng) {
  if (!activeActionPoint) return;
  closeTrainModal();

  const p = activeActionPoint;
  let m = activeActionMarker || findMarkerByPoint(p);

  const startPos = L.latLng(p.lat, p.lng);
  const targetPos = L.latLng(Number(lat.toFixed(5)), Number(lng.toFixed(5)));

  p.lat = targetPos.lat;
  p.lng = targetPos.lng;

  pendingRelocation = {
    point: p,
    marker: m,
    startPos: startPos,
    targetPos: targetPos,
    streetName: streetName,
    originalCenter: window.map.getCenter(),
    originalZoom: window.map.getZoom()
  };

  const banner = document.getElementById("transferBanner");
  if (banner) {
    banner.innerText = `⏳ Перенесення до ${streetName}...`;
    banner.style.display = "block";
  }

  window.map.flyTo([targetPos.lat, targetPos.lng], 16, { animate: true, duration: 0.85 });

  smoothGlideMarker(m, startPos, targetPos, 850, () => {
    if (banner) banner.style.display = "none";
    if (m) m.setLatLng(targetPos);

    setTimeout(() => {
      const confirmBox = document.getElementById("confirmMoveModal");
      const nameEl = document.getElementById("confirmStreetName");
      if (nameEl) nameEl.innerText = `📍 ${streetName}`;
      if (confirmBox) confirmBox.style.display = "block";
    }, 300);
  });
}

function finalizeMoveConfirm(isConfirmed) {
  const confirmBox = document.getElementById("confirmMoveModal");
  if (confirmBox) confirmBox.style.display = "none";

  if (!pendingRelocation) return;
  const { point, marker, startPos, targetPos, streetName, originalCenter, originalZoom } = pendingRelocation;

  if (isConfirmed) {
    point.lat = targetPos.lat;
    point.lng = targetPos.lng;
    point.needs_training = false;
    point.address = streetName;

    // Вичленяємо чисту назву вулиці з тексту повідомлення
    const rawMsg = point.raw_text || point.text || "";
    const cleanAlias = extractCleanStreetAlias(rawMsg, streetName);

    // 1. Оновлюємо поточну точку в Firebase points.json
    if (point._fbKey) {
      fetch(FIREBASE_POINTS_URL.replace(".json", `/${point._fbKey}.json`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: point.lat, lng: point.lng, needs_training: false, address: streetName })
      }).catch(() => {});
    }

    // 2. ЗБЕРІГАЄМО ПРЯМО В МОЗОК (custom_streets.json "А = Б")
    const memEntry = {
      name: streetName,
      lat: Number(point.lat.toFixed(5)),
      lng: Number(point.lng.toFixed(5)),
      time: Date.now()
    };
    const safeKey = encodeURIComponent(cleanAlias).replace(/\./g, "%2E");

    fetch(FB_CUSTOM_STREETS_URL.replace(".json", `/${safeKey}.json`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(memEntry)
    }).catch(() => {});

    // 3. Дублюємо в Knowledge Base
    fetch(FIREBASE_KB_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phrase: cleanAlias, address: streetName, lat: point.lat, lng: point.lng, updated_at: Date.now() })
    }).catch(() => {});

    // 4. Оновлюємо локальний словник топонімів та лічильник Мозку
    if (window.DNIPRO_STREETS_MAP) {
      window.DNIPRO_STREETS_MAP[cleanAlias] = memEntry;
    }
    const memBadge = document.getElementById("memCountBadge");
    if (memBadge) {
      const currentCount = parseInt(memBadge.innerText || "0", 10);
      memBadge.innerText = currentCount + 1;
    }

    if (typeof learnedRules !== "undefined" && Array.isArray(learnedRules)) {
      learnedRules.push({ phrase: cleanAlias, address: streetName, lat: point.lat, lng: point.lng });
      localStorage.setItem("radar_learned_rules", JSON.stringify(learnedRules));
    }

    showToast(`✅ «${cleanAlias} = ${streetName}» збережено в Мозок!`);
    pendingRelocation = null;
    renderMarkers();
    renderTrafficLights();
    updateRouteStatus();
  } else {
    point.lat = startPos.lat;
    point.lng = startPos.lng;
    if (marker) marker.setLatLng(startPos);
    window.map.flyTo(originalCenter, originalZoom, { animate: true, duration: 0.8 });
    showToast("↩️ Перенесення скасовано");
    pendingRelocation = null;
    renderMarkers();
  }
}

function finalizeMoveManual() {
  const confirmBox = document.getElementById("confirmMoveModal");
  if (confirmBox) confirmBox.style.display = "none";

  if (!pendingRelocation || !pendingRelocation.marker) return;
  const { marker } = pendingRelocation;

  marker.options.autoPan = true;
  marker.options.autoPanPadding = [60, 60];
  marker.options.autoPanSpeed = 15;
  marker.dragging.enable();

  const circleEl = marker.getElement()?.querySelector('.radar-circle');
  if (circleEl) circleEl.classList.add('moving-super-marker');

  showToast("✋ Підтягніть мітку пальцем точно на потрібне місце!");

  marker.once('dragend', (e) => {
    marker.dragging.disable();
    if (circleEl) circleEl.classList.remove('moving-super-marker');
    const pos = e.target.getLatLng();
    pendingRelocation.targetPos = pos;
    pendingRelocation.streetName = "Встановлено користувачем (ручне)";

    const nameEl = document.getElementById("confirmStreetName");
    if (nameEl) nameEl.innerText = "📍 Встановлено користувачем (ручне)";
    if (confirmBox) confirmBox.style.display = "block";
  });
}

// =========================================================================
// 🔍 ЖИВИЙ ПОШУК І ПІДКАЗКИ
// =========================================================================
const trainCustomInput = document.getElementById("trainCustomInput");
const trainSearchResults = document.getElementById("trainSearchResults");
let trainSearchDebounceTimer = null;

if (trainCustomInput && trainSearchResults) {
  trainCustomInput.addEventListener("input", () => {
    clearTimeout(trainSearchDebounceTimer);
    const query = trainCustomInput.value.trim();
    if (query.length < 2) {
      trainSearchResults.style.display = "none";
      trainSearchResults.innerHTML = "";
      return;
    }

    trainSearchDebounceTimer = setTimeout(async () => {
      const lower = query.toLowerCase();
      trainSearchResults.innerHTML = "";
      const matches = [];

      // 1. Мозок
      if (typeof learnedRules !== "undefined" && Array.isArray(learnedRules)) {
        for (const rule of learnedRules) {
          if (!rule || !rule.lat || !rule.lng) continue;
          const phraseMatch = rule.phrase && rule.phrase.toLowerCase().includes(lower);
          const addrMatch = rule.address && rule.address.toLowerCase().includes(lower);
          
          if (phraseMatch || addrMatch) {
            const ruleName = rule.address || rule.phrase;
            if (!matches.some(m => m.name === ruleName)) {
              matches.push({
                name: ruleName,
                lat: rule.lat,
                lng: rule.lng,
                badge: "🧠",
                subtext: rule.phrase && rule.address && rule.phrase !== rule.address ? `(з пам'яті: ${rule.phrase})` : ""
              });
            }
          }
        }
      }

      // 2. Словник топонімів
      const sortedKeys = Object.keys(DNIPRO_STREETS_MAP).sort((a, b) => b.length - a.length);
      for (const key of sortedKeys) {
        const item = DNIPRO_STREETS_MAP[key];
        if (key.includes(lower) || (item.old && item.old.toLowerCase().includes(lower)) || item.name.toLowerCase().includes(lower)) {
          if (!matches.some(m => m.name === item.name)) {
            matches.push({
              name: item.name,
              lat: item.lat,
              lng: item.lng,
              badge: "📍",
              subtext: item.old ? `(колишня: ${item.old})` : ""
            });
          }
        }
      }

      matches.forEach(item => {
        const div = document.createElement("div");
        div.className = "search-item";
        div.innerHTML = item.subtext 
          ? `${item.badge} <b>${item.name}</b><br><span style="color:#f59e0b; font-size:10px;">${item.subtext}</span>` 
          : `${item.badge} <b>${item.name}</b>`;
        div.onclick = () => {
          trainCustomInput.value = item.name;
          trainSearchResults.style.display = "none";
          applyPointRelocation(item.name, item.lat, item.lng);
        };
        trainSearchResults.appendChild(div);
      });

      // 3. OpenStreetMap
      if (matches.length < 4 && query.length >= 3) {
        try {
          const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ", Дніпро")}&countrycodes=ua&limit=4`;
          const res = await fetch(url);
          const data = await res.json();
          if (data && data.length > 0) {
            data.forEach(osmItem => {
              const name = osmItem.display_name.split(",")[0];
              if (!matches.some(m => m.name.toLowerCase().includes(name.toLowerCase()))) {
                const div = document.createElement("div");
                div.className = "search-item";
                div.innerHTML = `🌐 ${name}`;
                div.onclick = () => {
                  trainCustomInput.value = name;
                  trainSearchResults.style.display = "none";
                  applyPointRelocation(name, parseFloat(osmItem.lat), parseFloat(osmItem.lon));
                };
                trainSearchResults.appendChild(div);
              }
            });
          }
        } catch(e) {}
      }

      trainSearchResults.style.display = trainSearchResults.children.length > 0 ? "block" : "none";
    }, 250);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".train-input-row")) {
      trainSearchResults.style.display = "none";
    }
  });
}

async function executeCustomTrain() {
  const q = document.getElementById("trainCustomInput").value.trim();
  if (!q) return;

  const lower = q.toLowerCase();

  if (typeof learnedRules !== "undefined" && Array.isArray(learnedRules)) {
    const memoryHit = learnedRules.find(r => r && ((r.phrase && r.phrase.toLowerCase().includes(lower)) || (r.address && r.address.toLowerCase().includes(lower))));
    if (memoryHit && memoryHit.lat && memoryHit.lng) {
      applyPointRelocation(memoryHit.address || memoryHit.phrase, memoryHit.lat, memoryHit.lng);
      return;
    }
  }

  const sortedKeys = Object.keys(DNIPRO_STREETS_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (lower.includes(key)) {
      const val = DNIPRO_STREETS_MAP[key];
      applyPointRelocation(val.name, val.lat, val.lng);
      return;
    }
  }

  showToast("🔍 Пошук вулиці у Дніпрі...");
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q + ", Дніпро")}&countrycodes=ua&limit=1`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.length > 0) {
      const item = data[0];
      applyPointRelocation(item.display_name.split(",")[0], parseFloat(item.lat), parseFloat(item.lon));
      return;
    }
  } catch(e) {}

  showToast(`⚠️ Не знайдено координат для «${q}».`);
}
