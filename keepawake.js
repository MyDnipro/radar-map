/**
 * Radar Dnipro — Бронебійний модуль "Не вимикати екран" (keepawake.js)
 * Працює за принципом YouTube: запускає невидимий апаратний відеопотік HTML5 <video>
 * + WebAudio + Screen Wake Lock API.
 * Сумісний з Opera / Chrome на Xiaomi HyperOS.
 */
(function() {
  let isKeepAwakeActive = false;
  let wakeLockObj = null;
  let videoEl = null;
  let canvasStream = null;
  let animFrameId = null;
  let audioCtx = null;

  // 1. Стилі для кнопки-індикатора 🔆 на карті
  const style = document.createElement("style");
  style.textContent = `
    #btnKeepAwake {
      position: fixed !important;
      bottom: 122px !important;
      right: 14px !important;
      z-index: 1900 !important;
      width: 40px;
      height: 40px;
      background: rgba(15, 23, 42, 0.92);
      backdrop-filter: blur(8px);
      border: 1.5px solid #475569;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 19px;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(0, 0, 0, 0.5);
      user-select: none;
      transition: all 0.2s ease;
    }
    #btnKeepAwake.active {
      background: rgba(6, 78, 59, 0.95) !important;
      border-color: #10b981 !important;
      box-shadow: 0 0 18px rgba(16, 185, 129, 0.75) !important;
    }
    #btnKeepAwake:active {
      transform: scale(0.92);
    }
  `;
  document.head.appendChild(style);

  // 2. Створюємо кнопку-індикатор на екрані
  const btn = document.createElement("div");
  btn.id = "btnKeepAwake";
  btn.title = "Утримання екрана увімкненим (Режим YouTube)";
  btn.innerText = "🔆";
  document.body.appendChild(btn);

  if (window.L && L.DomEvent) {
    L.DomEvent.disableClickPropagation(btn);
  }

  // 3. Створюємо живий мікро-відеопотік (щоб Xiaomi бачив справжнє відео в русі)
  function startHardwareVideoLoop() {
    if (!videoEl) {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d");

      let tick = 0;
      function drawFrame() {
        tick++;
        ctx.fillStyle = (tick % 2 === 0) ? "#010101" : "#020202";
        ctx.fillRect(0, 0, 16, 16);
        animFrameId = requestAnimationFrame(drawFrame);
      }
      drawFrame();

      videoEl = document.createElement("video");
      videoEl.setAttribute("playsinline", "");
      videoEl.setAttribute("webkit-playsinline", "");
      videoEl.setAttribute("loop", "");
      videoEl.muted = true;
      videoEl.volume = 0;

      // Важливо: для HyperOS відео має бути фізично в DOM (1x1 піксель), інакше система його ігнорує
      videoEl.style.cssText = "position:fixed; bottom:0; right:0; width:2px; height:2px; opacity:0.01; pointer-events:none; z-index:1;";
      document.body.appendChild(videoEl);

      if (canvas.captureStream) {
        canvasStream = canvas.captureStream(10); // 10 кадрів/сек
        videoEl.srcObject = canvasStream;
      }
    }

    if (videoEl) {
      videoEl.play().then(() => {
        isKeepAwakeActive = true;
        btn.classList.add("active");
      }).catch(() => {});
    }
  }

  // 4. Запускаємо безшумний аудіо-генератор (щоб Opera не присипляла вкладку)
  function startSilentAudio() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx && AudioContextClass) {
        audioCtx = new AudioContextClass();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        gain.gain.value = 0.00001; // Абсолютно нечутно
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
      }
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume();
      }
    } catch (e) {}
  }

  // 5. Запит системного WakeLock API
  async function requestSystemWakeLock() {
    if ("wakeLock" in navigator) {
      try {
        if (!wakeLockObj) {
          wakeLockObj = await navigator.wakeLock.request("screen");
          wakeLockObj.addEventListener("release", () => {
            wakeLockObj = null;
          });
        }
      } catch (e) {}
    }
  }

  // Комплексний запуск усіх 3 рівнів захисту
  function enableKeepAwake(showMessage = false) {
    startHardwareVideoLoop();
    startSilentAudio();
    requestSystemWakeLock();
    isKeepAwakeActive = true;
    btn.classList.add("active");

    if (showMessage && typeof window.showToast === "function") {
      window.showToast("🔆 Екран зафіксовано (режим В дорозі УВІМКНЕНО)");
    }
  }

  function disableKeepAwake() {
    isKeepAwakeActive = false;
    btn.classList.remove("active");
    if (videoEl) videoEl.pause();
    if (wakeLockObj) {
      wakeLockObj.release().catch(() => {});
      wakeLockObj = null;
    }
    if (typeof window.showToast === "function") {
      window.showToast("🌙 Автовимкнення екрана повернуто в стандартний режим");
    }
  }

  // Клік по самій кнопці 🔆 дозволяє вручну вмикати/вимикати режим
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (isKeepAwakeActive) {
      disableKeepAwake();
    } else {
      enableKeepAwake(true);
    }
  });

  // Автоматичний старт при ПЕРШОМУ дотику пальцем у будь-якому місці карти
  function autoUnlockOnFirstTouch() {
    if (!isKeepAwakeActive) {
      enableKeepAwake(false);
    } else if (videoEl && videoEl.paused) {
      videoEl.play().catch(() => {});
    }
  }

  document.addEventListener("touchstart", autoUnlockOnFirstTouch, { passive: true });
  document.addEventListener("click", autoUnlockOnFirstTouch, { passive: true });

  // Якщо згорнули Opera і повернулися назад — миттєво відновлюємо відеопотік
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isKeepAwakeActive) {
      enableKeepAwake(false);
    }
  });

  // Контрольний пульс кожні 10 секунд: якщо система спробувала поставити відео на паузу — запускаємо знову
  setInterval(() => {
    if (isKeepAwakeActive && videoEl && videoEl.paused) {
      videoEl.play().catch(() => {});
      requestSystemWakeLock();
    }
  }, 10000);
})();
