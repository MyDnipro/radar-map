/**
 * Radar Dnipro — Автоматичне утримання екрана (keepawake.js)
 * Завжди увімкнено за замовчуванням, без іконки 🔆 на екрані.
 */
(function() {
  let wakeLockObj = null;
  let videoEl = null;
  let audioCtx = null;

  function ensureAlwaysAwake() {
    // 1. Невидимий відеопотік HTML5 <video> (принцип YouTube)
    if (!videoEl) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext("2d");
        let tick = 0;
        function drawLoop() {
          tick++;
          ctx.fillStyle = (tick % 2 === 0) ? "#010101" : "#020202";
          ctx.fillRect(0, 0, 16, 16);
          requestAnimationFrame(drawLoop);
        }
        drawLoop();

        videoEl = document.createElement("video");
        videoEl.setAttribute("playsinline", "");
        videoEl.setAttribute("webkit-playsinline", "");
        videoEl.setAttribute("loop", "");
        videoEl.muted = true;
        videoEl.volume = 0;
        videoEl.style.cssText = "position:fixed;bottom:0;right:0;width:2px;height:2px;opacity:0.01;pointer-events:none;z-index:1;";
        document.body.appendChild(videoEl);

        if (canvas.captureStream) {
          videoEl.srcObject = canvas.captureStream(10);
        }
      } catch (e) {}
    }

    if (videoEl && videoEl.paused) {
      videoEl.play().catch(() => {});
    }

    // 2. Безшумний WebAudio
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx && AudioContextClass) {
        audioCtx = new AudioContextClass();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        gain.gain.value = 0.00001;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
      }
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume().catch(() => {});
      }
    } catch (e) {}

    // 3. Системний Wake Lock API
    if ("wakeLock" in navigator && !wakeLockObj) {
      navigator.wakeLock.request("screen").then(lock => {
        wakeLockObj = lock;
        wakeLockObj.addEventListener("release", () => { wakeLockObj = null; });
      }).catch(() => {});
    }
  }

  ensureAlwaysAwake();
  document.addEventListener("touchstart", ensureAlwaysAwake, { passive: true });
  document.addEventListener("click", ensureAlwaysAwake, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") ensureAlwaysAwake();
  });
  setInterval(ensureAlwaysAwake, 8000);
})();
