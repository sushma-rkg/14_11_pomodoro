const TOTAL_MS = 25 * 60 * 1000;
const MAX_BLUR = 5; // same blur as the "Before starting" design

const timeEl = document.getElementById("time");
const artEl = document.getElementById("art");
const mainButton = document.getElementById("main-button");
const resetButton = document.getElementById("reset-button");

let state = "idle"; // "idle", "running" or "paused"
let remainingMs = TOTAL_MS;
let endTime = 0; // the clock time when the timer will reach zero
let intervalId = null;

function show() {
  const seconds = Math.ceil(remainingMs / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  timeEl.textContent = mm + ":" + ss;
  artEl.style.setProperty("--blur", (MAX_BLUR * remainingMs) / TOTAL_MS);
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
  }
  show();
}

function start() {
  state = "running";
  endTime = Date.now() + remainingMs;
  intervalId = setInterval(update, 250);
  show();
}

function pause() {
  update();
  clearInterval(intervalId);
  intervalId = null;
  state = "paused";
  show();
}

function reset() {
  clearInterval(intervalId);
  intervalId = null;
  state = "idle";
  remainingMs = TOTAL_MS;
  show();
}

mainButton.addEventListener("click", () => {
  if (state === "running") {
    if (remainingMs > 0) pause();
  } else if (remainingMs > 0) {
    start();
  }
});

resetButton.addEventListener("click", reset);

document.addEventListener("visibilitychange", () => {
  if (state === "running") update();
});

show();
