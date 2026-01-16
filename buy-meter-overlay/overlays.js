// buy-meter-overlay/overlay.js
// Debug mode: add ?debug=1 to the URL
// Goal: $500 = 100%
// Effects: smoke at 20 and 50, sparks at 75, ignite at 100

const GOAL = 500;

const fillEl = document.getElementById("fill");
const usdText = document.getElementById("usdText");
const pctText = document.getElementById("pctText");
const hintText = document.getElementById("hintText");

let currentUsd = 0;

// Tier flags so effects only fire once per run
const tierFired = {
  smoke20: false,
  smoke50: false,
  sparks75: false,
  ignite100: false,
};

// Canvas setup
const canvas = document.getElementById("fx");
const ctx = canvas.getContext("2d", { alpha: true });

function resize() {
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

const particles = [];

function addSmokeBurst(intensity = 1, seconds = 6) {
  const start = performance.now();
  const end = start + seconds * 1000;

  function spawn() {
    // Spawn around the meter area (top left). If you move meter, we can adjust these.
    const baseX = 40;
    const baseY = 40 + 50;

    const count = Math.floor(18 * intensity);
    for (let i = 0; i < count; i++) {
      particles.push({
        kind: "smoke",
        x: baseX + Math.random() * 560,
        y: baseY + 40 + Math.random() * 30,
        vx: (Math.random() - 0.5) * 12,
        vy: -20 - Math.random() * 30,
        r: 16 + Math.random() * 40,
        a: 0.08 + Math.random() * 0.10,
        life: 0,
        ttl: 2200 + Math.random() * 2200,
      });
    }
  }

  function tick() {
    const now = performance.now();
    if (now > end) return;
    spawn();
    setTimeout(tick, 220);
  }

  tick();
}

function addSparksBurst(intensity = 1) {
  const baseX = 40;
  const baseY = 40 + 60;

  const count = Math.floor(70 * intensity);
  for (let i = 0; i < count; i++) {
    const ang = (-Math.PI / 2) + (Math.random() - 0.5) * 1.1;
    const spd = 180 + Math.random() * 320;
    particles.push({
      kind: "spark",
      x: baseX + 40 + Math.random() * 500,
      y: baseY + Math.random() * 20,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      r: 1 + Math.random() * 2.4,
      life: 0,
      ttl: 520 + Math.random() * 520,
    });
  }
}

function igniteBurst() {
  addSparksBurst(1.8);
  addSmokeBurst(1.6, 9);
}

function render(dt) {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life += dt;

    const t = p.life / p.ttl;
    if (t >= 1) {
      particles.splice(i, 1);
      continue;
    }

    p.x += p.vx * (dt / 1000);
    p.y += p.vy * (dt / 1000);

    if (p.kind === "smoke") {
      // Smoke slows and expands, fades out
      p.vx *= 0.985;
      p.vy *= 0.99;

      const alpha = p.a * (1 - t);
      const radius = p.r * (1 + t * 1.5);

      ctx.save();
      ctx.filter = "blur(1.4px)";
      ctx.beginPath();
      ctx.fillStyle = `rgba(220,220,220,${alpha})`;
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (p.kind === "spark") {
      // Sparks drop with gravity and fade
      p.vy += 520 * (dt / 1000);
      const alpha = 0.95 * (1 - t);

      ctx.beginPath();
      ctx.fillStyle = `rgba(255,190,90,${alpha})`;
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

let last = performance.now();
function loop(now) {
  const dt = Math.min(40, now - last);
  last = now;
  render(dt);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function resetTiers() {
  tierFired.smoke20 = false;
  tierFired.smoke50 = false;
  tierFired.sparks75 = false;
  tierFired.ignite100 = false;
  hintText.textContent = "Forge run: live volume";
}

function setMeter(usd) {
  currentUsd = Math.max(0, usd);
  const pct = Math.min((currentUsd / GOAL) * 100, 100);

  fillEl.style.width = pct.toFixed(2) + "%";
  usdText.textContent = `$${currentUsd.toFixed(2)} / $${GOAL}`;
  pctText.textContent = `${Math.floor(pct)}%`;

  if (pct >= 20 && !tierFired.smoke20) {
    tierFired.smoke20 = true;
    hintText.textContent = "Smoke rises, the forge wakes";
    addSmokeBurst(0.9, 6);
  }

  if (pct >= 50 && !tierFired.smoke50) {
    tierFired.smoke50 = true;
    hintText.textContent = "Thicker smoke, pressure builds";
    addSmokeBurst(1.3, 8);
  }

  if (pct >= 75 && !tierFired.sparks75) {
    tierFired.sparks75 = true;
    hintText.textContent = "Sparks fly, the heat climbs";
    addSparksBurst(1.0);
  }

  if (pct >= 100 && !tierFired.ignite100) {
    tierFired.ignite100 = true;
    hintText.textContent = "IGNITION, 100% reached";
    igniteBurst();
  }
}

// Debug mode, fakes buys so you can see effects
const params = new URLSearchParams(location.search);
const debug = params.get("debug") === "1";

if (debug) {
  resetTiers();
  let v = 0;

  setInterval(() => {
    v += 25 + Math.random() * 55;

    // loop back to 0 so you can watch tiers fire again
    if (v > 520) {
      v = 0;
      resetTiers();
    }

    setMeter(v);
  }, 1200);
} else {
  setMeter(0);
}
