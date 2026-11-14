const TOTAL_MS = 25 * 60 * 1000;
const MAX_BLUR = 5; // same blur as the "Before starting" design

const timeEl = document.getElementById("time");
const artEl = document.getElementById("art");
const infoEl = document.getElementById("info");
const mainButton = document.getElementById("main-button");
const resetButton = document.getElementById("reset-button");
const restartButton = document.getElementById("restart-button");

let state = "idle"; // "idle", "running", "paused" or "finished"
let remainingMs = TOTAL_MS;
let endTime = 0; // the clock time when the timer will reach zero
let intervalId = null;

// ---- Bell (made with the browser's built-in Web Audio, no sound files) ----
let audioCtx = null;
let bell = null; // the bell that is ringing, or waiting to ring

// Browsers only allow sound after a click, so this runs when Start is pressed.
function prepareAudio() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
  } catch (error) {
    audioCtx = null; // no sound available, the timer still works
  }
}

// The "Warm bell": a deep, round bell that fades out over 3 seconds.
// It is planned on the sound system's own clock, so it still rings on time
// when the page is in a background tab.
function planBell(startAt) {
  const fade = 3;
  const parts = [[1, 0.4], [2.01, 0.2], [2.76, 0.12], [4.07, 0.06]];
  const voices = parts.map(([ratio, level]) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.value = 392 * ratio;
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(level, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + fade);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(startAt);
    osc.stop(startAt + fade + 0.05);
    return { osc, gain };
  });
  return { startAt, voices };
}

// Stops the bell, whether it is still waiting or already ringing.
function stopBell() {
  if (!bell) return;
  const now = audioCtx.currentTime;
  bell.voices.forEach(({ osc, gain }) => {
    try {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setTargetAtTime(0.0001, now, 0.03);
      osc.stop(now + 0.15);
    } catch (error) {
      // already finished
    }
  });
  bell = null;
}

function scheduleBell() {
  if (!audioCtx) return;
  stopBell();
  bell = planBell(audioCtx.currentTime + remainingMs / 1000);
}

// Safety net: if the planned bell did not start on time, ring it now.
function ringIfMissed() {
  if (!audioCtx) return;
  if (bell && audioCtx.state === "running" && audioCtx.currentTime >= bell.startAt - 0.5) {
    return; // it is already ringing
  }
  stopBell();
  if (audioCtx.state === "suspended") audioCtx.resume();
  bell = planBell(audioCtx.currentTime + 0.05);
}

function show() {
  const seconds = Math.ceil(remainingMs / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  timeEl.textContent = mm + ":" + ss;
  artEl.style.setProperty("--blur", (MAX_BLUR * remainingMs) / TOTAL_MS);
  document.body.dataset.state = state;

  const finished = state === "finished";
  mainButton.hidden = finished;
  resetButton.hidden = finished;
  restartButton.hidden = !finished;
  infoEl.hidden = !finished;
  mainButton.textContent =
    state === "running" ? "Pause" : state === "paused" ? "Resume" : "Start";
}

// Works out the time left from the real clock, so it stays correct
// even when the browser slows this page down in a background tab.
function update() {
  remainingMs = Math.max(0, endTime - Date.now());
  if (remainingMs === 0) {
    clearInterval(intervalId);
    intervalId = null;
    state = "finished";
    ringIfMissed();
  }
  show();
}

function start() {
  prepareAudio();
  state = "running";
  endTime = Date.now() + remainingMs;
  scheduleBell();
  intervalId = setInterval(update, 250);
  show();
}

function pause() {
  update();
  if (state !== "running") return; // it just finished
  clearInterval(intervalId);
  intervalId = null;
  stopBell();
  state = "paused";
  show();
}

function reset() {
  clearInterval(intervalId);
  intervalId = null;
  stopBell();
  state = "idle";
  remainingMs = TOTAL_MS;
  show();
}

mainButton.addEventListener("click", () => {
  if (state === "running") pause();
  else start();
});

resetButton.addEventListener("click", reset);

restartButton.addEventListener("click", () => {
  reset();
  mainButton.focus();
});

document.addEventListener("visibilitychange", () => {
  if (state === "running") update();
});

show();
