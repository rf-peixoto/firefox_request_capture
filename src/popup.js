/* global browser */
const primaryBtn = document.getElementById("primaryBtn");
const btnLabel   = document.getElementById("btnLabel");
const iconStart  = document.getElementById("iconStart");
const iconStop   = document.getElementById("iconStop");
const stateDot   = document.getElementById("stateDot");
const stateText  = document.getElementById("stateText");
const pendingVal = document.getElementById("pendingVal");
const capturedVal= document.getElementById("capturedVal");

let currentState = { capturing: false, pending: 0, captured: 0 };
let pollTimer = null;

function applyState(s) {
  currentState = s || currentState;

  // Status text + dot
  if (currentState.capturing) {
    stateText.textContent = "Capturing…";
    stateDot.className = "dot on";
    primaryBtn.classList.remove("start");
    primaryBtn.classList.add("stop");
    primaryBtn.setAttribute("aria-pressed", "true");
    btnLabel.textContent = "Stop & Export";
    iconStart.style.display = "none";
    iconStop .style.display = "";
  } else {
    stateText.textContent = "Idle";
    stateDot.className = "dot off";
    primaryBtn.classList.add("start");
    primaryBtn.classList.remove("stop");
    primaryBtn.setAttribute("aria-pressed", "false");
    btnLabel.textContent = "Start Capture";
    iconStart.style.display = "";
    iconStop .style.display = "none";
  }

  // Metrics
  pendingVal.textContent  = (currentState.pending  ?? 0).toString();
  capturedVal.textContent = (currentState.captured ?? 0).toString();
}

async function refresh() {
  try {
    const res = await browser.runtime.sendMessage({ type: "state" });
    if (res) applyState(res);
  } catch (e) {
    // No-op in production; popup can outlive background on reload
  }
}

primaryBtn.addEventListener("click", async () => {
  try {
    stateDot.className = "dot busy";
    // Toggle behavior
    if (currentState.capturing) {
      await browser.runtime.sendMessage({ type: "stop_export" });
    } else {
      await browser.runtime.sendMessage({ type: "start" });
    }
  } finally {
    await refresh();
  }
});

// Live updates while popup is visible
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    refresh();
    pollTimer = setInterval(refresh, 900);
  } else if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});

refresh();
pollTimer = setInterval(refresh, 900);
