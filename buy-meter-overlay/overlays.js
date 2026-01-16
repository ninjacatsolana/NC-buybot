const GOAL = 500;

const fillEl = document.getElementById("fill");
const usdText = document.getElementById("usdText");
const pctText = document.getElementById("pctText");
const hintText = document.getElementById("hintText");

let currentUsd = 0;

function setMeter(usd) {
  currentUsd = Math.max(0, usd);
  const pct = Math.min((currentUsd / GOAL) * 100, 100);

  fillEl.style.width = pct.toFixed(2) + "%";
  usdText.textContent = `$${currentUsd.toFixed(2)} / $${GOAL}`;
  pctText.textContent = `${Math.floor(pct)}%`;
}

// Debug mode, lets you test in a browser
const params = new URLSearchParams(location.search);
const debug = params.get("debug") === "1";

if (debug) {
  let v = 0;
  setInterval(() => {
    v += 20 + Math.random() * 40;
    if (v > 520) v = 0;
    setMeter(v);
  }, 1200);
} else {
  setMeter(0);
}


