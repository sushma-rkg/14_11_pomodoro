const TOTAL_MS = 30 * 1000; // TEMPORARY for testing: set back to 25 * 60 * 1000

const timeEl = document.getElementById("time");
const paintingEl = document.getElementById("painting");
const frameEl = document.getElementById("frame");
const noteEl = document.getElementById("note");
const blurEl = document.getElementById("blur-layer");
const titleEl = document.getElementById("painting-title");
const metaEl = document.getElementById("painting-meta");
const linkEl = document.getElementById("painting-link");
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

// ---- The painting (from the Met Museum's free public API) ----
const MET = "https://collectionapi.metmuseum.org/public/collection";
const SEARCH = MET + "/v1.1/search?q=*&hasImages=true&medium=Paintings";
const OBJECT = MET + "/v1/objects/";
let painting = null; // everything we show comes from this one record
let maxBlur = 0; // the strongest blur (in pixels) for the painting on screen
let blurJump = false; // true = change the blur at once instead of gliding
let loadCount = 0;

const REQUEST_TIMEOUT_MS = 10000; // how long we wait for the Met
const MAX_PAINTINGS = 5; // how many different paintings we try
const FRIENDLY_MESSAGE =
  "We couldn't load a painting right now. You can still use the timer. Refresh the page to try again.";

// Asks the Met for something. Gives up (throws) if the Met takes longer than
// 10 seconds or answers with an error. Returns null if the Met has no such record.
async function getJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error("The Met answered with an error");
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// Shows the image in the page. Gives true if it loaded, false if it is broken.
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The image took too long")),
      REQUEST_TIMEOUT_MS
    );
    paintingEl.onload = () => {
      clearTimeout(timer);
      resolve(true);
    };
    paintingEl.onerror = () => {
      clearTimeout(timer);
      resolve(false);
    };
    paintingEl.src = url;
  });
}

function isUsable(object) {
  if (!object || object.isPublicDomain !== true) return false;
  const kind = (object.classification || "") + " " + (object.objectName || "");
  return /painting/i.test(kind) && Boolean(object.primaryImageSmall || object.primaryImage);
}

// Picks a random painting. A record that is not a public domain painting, has
// no image, or whose image will not load is quietly skipped (up to 5 paintings).
// Throws if the Met does not answer. Gives null if all 5 paintings were no good.
async function pickPainting(thisLoad) {
  const first = await getJson(SEARCH + "&limit=1");
  if (!first || !first.total) throw new Error("No search answer");
  const reachable = Math.min(first.total, 10000);
  const tried = new Set();
  let paintings = 0;
  for (let round = 0; round < 25 && paintings < MAX_PAINTINGS; round++) {
    const offset = Math.floor(Math.random() * reachable);
    const page = await getJson(SEARCH + "&offset=" + offset + "&limit=1");
    if (!page) throw new Error("No search answer");
    const id = page.objectIDs && page.objectIDs[0];
    if (!id || tried.has(id)) continue;
    tried.add(id);
    paintings++;
    const object = await getJson(OBJECT + id);
    if (thisLoad !== loadCount) return null;
    if (!isUsable(object)) continue;
    const image = object.primaryImageSmall || object.primaryImage;
    if (await loadImage(image)) {
      return {
        title: object.title,
        artist: object.artistDisplayName || "Unknown",
        year: object.objectDate || "Unknown",
        link: object.objectURL,
      };
    }
    if (thisLoad !== loadCount) return null;
    paintingEl.removeAttribute("src");
  }
  return null;
}

function setNote(text) {
  noteEl.textContent = text || "";
  noteEl.hidden = !text;
}

// The blurred copy of the painting. The picture is mirrored around its own
// edges before it is blurred, so the edges stay crisp and the blur never
// spills outside the painting area. It uses the picture that is already
// loaded, so it asks the Met for nothing extra.
function drawBlurLayer() {
  const width = frameEl.clientWidth;
  const height = frameEl.clientHeight;
  if (!width || !height || !paintingEl.naturalWidth) return;
  maxBlur = 0.06 * Math.min(width, height);
  const pad = Math.ceil(maxBlur * 3);
  const scale = window.devicePixelRatio || 1;
  blurEl.width = Math.round((width + 2 * pad) * scale);
  blurEl.height = Math.round((height + 2 * pad) * scale);
  blurEl.style.width = width + 2 * pad + "px";
  blurEl.style.height = height + 2 * pad + "px";
  blurEl.style.left = -pad + "px";
  blurEl.style.top = -pad + "px";
  const ctx = blurEl.getContext("2d");
  ctx.scale(scale, scale);
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      ctx.save();
      ctx.translate(
        i === 0 ? pad : pad + (i + 1) * width,
        j === 0 ? pad : pad + (j + 1) * height
      );
      ctx.scale(i === 0 ? 1 : -1, j === 0 ? 1 : -1);
      ctx.drawImage(paintingEl, 0, 0, width, height);
      ctx.restore();
    }
  }
  applyBlur(true);
}

// The blur depends on how much of the set time is left: strongest at the
// start, none at 00:00.
function applyBlur(jump) {
  const blur = maxBlur * (remainingMs / TOTAL_MS);
  const on = blur > 0.05;
  blurEl.style.transition = jump ? "none" : "filter 0.3s linear";
  blurEl.style.filter = on ? "blur(" + blur + "px)" : "none";
  blurEl.style.visibility = on ? "visible" : "hidden";
}

new ResizeObserver(drawBlurLayer).observe(frameEl);

async function loadPainting() {
  const thisLoad = ++loadCount;
  painting = null;
  frameEl.classList.remove("ready");
  paintingEl.removeAttribute("src");
  blurJump = true;
  setNote("Loading painting…");
  show();
  let chosen = null;
  try {
    chosen = await pickPainting(thisLoad);
  } catch (error) {
    chosen = null; // the Met did not answer
  }
  if (thisLoad !== loadCount) return; // a newer painting was asked for
  if (!chosen) {
    paintingEl.removeAttribute("src");
    setNote(FRIENDLY_MESSAGE);
    show();
    return;
  }
  painting = chosen;
  setNote(null);
  frameEl.style.setProperty(
    "--ratio",
    paintingEl.naturalWidth / paintingEl.naturalHeight
  );
  drawBlurLayer(); // blurred first, then shown: it never appears sharp
  frameEl.classList.add("ready");
  show();
}

// The details are only put on the page once the timer has finished.
function showDetails(finished) {
  if (finished && painting) {
    titleEl.textContent = painting.title;
    metaEl.textContent = painting.artist + " · " + painting.year;
    linkEl.href = painting.link;
  } else {
    titleEl.textContent = "";
    metaEl.textContent = "";
    linkEl.removeAttribute("href");
  }
}

function show() {
  const seconds = Math.ceil(remainingMs / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  timeEl.textContent = mm + ":" + ss;
  document.body.dataset.state = state;

  const finished = state === "finished";
  mainButton.hidden = finished;
  resetButton.hidden = finished;
  restartButton.hidden = !finished;
  infoEl.hidden = !(finished && painting);
  showDetails(finished);
  mainButton.textContent =
    state === "running" ? "Pause" : state === "paused" ? "Resume" : "Start";
  applyBlur(blurJump);
  blurJump = false;
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
  blurJump = true;
  show();
}

mainButton.addEventListener("click", () => {
  if (state === "running") pause();
  else start();
});

resetButton.addEventListener("click", reset);

restartButton.addEventListener("click", () => {
  reset();
  loadPainting();
  mainButton.focus();
});

document.addEventListener("visibilitychange", () => {
  if (state === "running") update();
});

show();
loadPainting();
