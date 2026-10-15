// =========================================================================
// 🎯 МОДУЛЬ ПЕРЕМЕЩЕНИЯ И ОБУЧЕНИЯ МЕТОК (RELOCATE ENGINE v4.2 — SAFE KEYS)
// =========================================================================

const FB_CUSTOM_STREETS_URL = "https://dnepr-radar-2026-alexx-default-rtdb.europe-west1.firebasedatabase.app/custom_streets.json";

function toSafeDbKey(str) {
  if (typeof window.toFirebaseKey === "function") {
    return window.toFirebaseKey(str);
  }
  return encodeURIComponent((str || "").trim().toLowerCase())
    .replace(/%/g, "_")
    .replace(/\./g, "_")
    .replace(/\$/g, "_")
    .replace(/#/g, "_")
    .replace(/\[/g, "_") .replace(/\]/g, "_")
    .slice(0, 80);
}

function getSimilarityScore(str1, str2) {
  const s1 = (str1 || "").toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, "");
  const s2 = (str2 || "").toLowerCase().replace(/[^a-zа-яіїєґ0-9]/g, "");
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) {
    const minLen = Math.min(s1.length, s2.length);
    const maxLen = Math.max(s1.length, s2.length);
    if (minLen >= 4) return minLen / maxLen;
  }
  if (s1.length < 2 || s2.length < 2) return 0;

  const getBigrams = str => {
    const bigrams = new Set();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.substring(i, i + 2));
    }
    return bigrams;
  };

  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  let intersection = 0;
  for (const item of b1) {
    if (b2.has(item)) intersection++;
  }
  return (2.0 * intersection) / (b1.size + b2.size);
}

function extractCleanStreetAlias(rawText, targetStreetName) {
  if (!rawText) return (targetStreetName || "").toLowerCase().trim();

  let cleanText = rawText
    .replace(/[\r\n]+/g, " ")
    .replace(/\b(?:\d{1,2}[:.-]\d{2})\b/g, " ")
    .replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}🟢🔴👍👌🤝🌞☀️🌤️❓]/gu, " ")
    .replace(/[^a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  const words = cleanText.split(" ").filter(w => w.length >= 3);
  if (words.length === 0) return (targetStreetName || "").toLowerCase().trim();
  if (words.length === 1) return words[0];

  const targetWords = new Set();
  const rawTargetParts = (targetStreetName || "")
    .toLowerCase()
    .replace(/\b(вул|вулиця|проспект|просп|провулок|шосе|тупик|набережна|площа|майдан|street|st)\b/gi, " ")
    .replace(/[^a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3);

  rawTargetParts.forEach(w => targetWords.add(w));

  if (window.DNIPRO_STREETS_MAP) {
    for (const [key, val] of Object.entries(window.DNIPRO_STREETS_MAP)) {
      const isTarget = targetStreetName.toLowerCase().includes(val.name.toLowerCase()) || 
                       val.name.toLowerCase().includes(targetStreetName.toLowerCase());
      if (isTarget) {
        targetWords.add(key.toLowerCase());
        if (val.old) {
          val.old.toLowerCase().split(/[\s,]+/).filter(w => w.length >= 3).forEach(w => targetWords.add(w));
        }
      }
    }
  }

  let bestWord = "";
  let bestScore = 0;

  for (const w of words) {
    for (const tw of targetWords) {
      const score = getSimilarityScore(w, tw);
      if (score > bestScore) {
        bestScore = score;
        bestWord = w;
      }
    }
  }

  if (bestScore >= 0.45 && bestWord) {
    return bestWord;
  }

  const stopWords = new Set([
    "чисто", "чистенько", "пусто", "вільно", "спокійно", "проїзд", "норм", "добре", "ясно",
    "бп", "блокпост", "патруль", "мент", "полиц", "поліц", "тцк", "бусик", "стоят", "облав",
    "дтп", "авария", "пробка", "тягучка", "съезд", "заезд", "сторону", "возле", "около"
  ]);

  const candidates = words.filter(w => !stopWords.has(w));
  if (candidates.length > 0) {
    candidates.sort((a, b) => b.length - a.length);
    return candidates[0];
  }

  return cleanText;
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
    banner.innerText = `⏳ Перемещение к ${streetName}...`;
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

    const rawMsg = point.raw_text || point.text || "";
    const cleanAlias = extractCleanStreetAlias(rawMsg, streetName);

    // 1. Обновляем метку в Firebase points.json
    if (point._fbKey) {
      fetch(FIREBASE_POINTS_URL.replace(".json", `/${point._fbKey}.json`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat: point.lat, lng: point.lng, needs_training: false, address: streetName })
      }).catch(() => {});
    }

    // 2. Сохраняем в единую таблицу custom_streets.json с безопасным ключом
    const memEntry = {
      alias: cleanAlias,
      phrase: cleanAlias,
      name: streetName,
      address: streetName,
      lat: Number(point.lat.toFixed(5)),
      lng: Number(point.lng.toFixed(5)),
      time: Date.now()
    };
    const safeKey = toSafeDbKey(cleanAlias);

    fetch(FB_CUSTOM_STREETS_URL.replace(".json", `/${safeKey}.json`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(memEntry)
    }).catch(() => {});

    // 3. Обновляем локальный справочник топонимов
    if (window.DNIPRO_STREETS_MAP) {
      window.DNIPRO_STREETS_MAP[cleanAlias] = memEntry;
    }
    const memBadge = document.getElementById("memCountBadge");
    if (memBadge) {
      const currentCount = parseInt(memBadge.innerText || "0", 10);
      memBadge.innerText = currentCount + 1;
    }

    showToast(`✅ «${cleanAlias} = ${streetName}» сохранено в память!`);
    pendingRelocation = null;
    renderMarkers();
    renderTrafficLights();
    updateRouteStatus();
  } else {
    point.lat = startPos.lat;
    point.lng = startPos.lng;
    if (marker) marker.setLatLng(startPos);
    window.map.flyTo(originalCenter, originalZoom, { animate: true, duration: 0.8 });
    showToast("↩️ Перемещение отменено");
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

  showToast("✋ Подтяните метку пальцем на точное место!");

  marker.once('dragend', (e) => {
    marker.dragging.disable();
    if (circleEl) circleEl.classList.remove('moving-super-marker');
    const pos = e.target.getLatLng();
    pendingRelocation.targetPos = pos;
    pendingRelocation.streetName = "Установлено вручную";

    const nameEl = document.getElementById("confirmStreetName");
    if (nameEl) nameEl.innerText = "📍 Установлено вручную";
    if (confirmBox) confirmBox.style.display = "block";
  });
}

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
              subtext: item.old ? `(бывшая: ${item.old})` : ""
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

  const sortedKeys = Object.keys(DNIPRO_STREETS_MAP).sort((a, b) => b.length - a.length);
  for (const key of sortedKeys) {
    if (lower.includes(key)) {
      const val = DNIPRO_STREETS_MAP[key];
      applyPointRelocation(val.name, val.lat, val.lng);
      return;
    }
  }

  showToast("🔍 Поиск улицы в Днепре...");
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

  showToast(`⚠️ Не найдено координат для «${q}».`);
}
