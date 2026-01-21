const express = require("express");
const { TwitterApi } = require("twitter-api-v2");
require("dotenv").config();

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});

console.log("BOOT STAMP:", "v2026-01-20-A", "PID:", process.pid);
console.log("BOOT: index.js loaded at", new Date().toISOString());
console.log("BOOT FILE:", __filename);

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

app.get("/", (req, res) => {
  res.status(200).send("nc-buybot alive");
});

// DEPLOY PROOF ROUTE
app.get("/version", (req, res) => {
  res.status(200).json({
    version: "FORCE-REDEPLOY-XYZ",
    file: __filename,
    ts: new Date().toISOString(),
  });
});




// ---------- Twitter ----------
const twitter = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

// ---------- Ninja Cat config ----------
const NC_MINT = "7wH5YKNnhcjyqUUXZwsdQWK26JVj9ejfNwDFfR1VCyod";
const NC_POOL = "F9MJEtLDppZA9d6Su2HomT1Bay3DjZaKSP8SamcrYDP4";

// ---------- Helpers ----------
const seen = new Set();
const fs = require("fs");
const path = require("path");

async function tweetWithImage(text) {
  const imagePath = path.join(__dirname, "assets", "buybot.png");

  console.log("IMAGE CHECK:", imagePath, "exists:", fs.existsSync(imagePath));

  const mediaId = await twitter.v1.uploadMedia(
    fs.readFileSync(imagePath),
    { mimeType: "image/png" }
  );

  console.log("MEDIA UPLOADED:", mediaId);

  return twitter.v2.tweet({
    text,
    media: { media_ids: [mediaId] },
  });
}




  


function shortAddr(a) {
  if (!a || typeof a !== "string") return "unknown";
  return a.slice(0, 4) + "…" + a.slice(-4);
}

function lamportsToSol(lamports) {
  return lamports / 1_000_000_000;
}

function pickSolSpent(e) {
  const changes = Array.isArray(e?.nativeBalanceChanges)
    ? e.nativeBalanceChanges
    : [];

  let best = null;

  for (const c of changes) {
    const lamports = Number(c?.amount || 0);
    if (lamports < 0 && (!best || lamports < best.lamports)) {
      best = lamports;
    }
  }

  if (!best) return null;
  return Math.abs(lamportsToSol(best));
}

// ---------- Health ----------

app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

app.get("/", (req, res) => {
  res.status(200).send("nc-buybot alive");
});

app.get("/version", (req, res) => {
  res.status(200).json({
    version: "v2026-01-20-A",
    file: __filename,
    ts: new Date().toISOString(),
  });
});


// ---------- Test tweet ----------
app.get("/test-tweet", async (req, res) => {
  try {
    const msg = `🐾 NC Buybot test ${new Date().toISOString()}`;

    const resp = await tweetWithImage(msg, "./assets/buybot.png");

    console.log("TWEET SENT OK:", resp.data?.id);

require("https")
  .get("https://nc-buybot-production-2946.up.railway.app/fire-alert?msg=Ninja+Cat+Buy")
  .on("error", () => {});

    res.status(200).send("Tweet sent ✅");
  } catch (err) {
    console.log("TEST TWEET ERROR MESSAGE:", err?.message);
    console.log("TEST TWEET ERROR DATA:", err?.data);
    console.log("TEST TWEET ERROR FULL:", err);
    res.status(500).send("Tweet failed ❌");
  }
});


// ---------- Helius webhook ----------
app.post("/helius", async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
console.log("Helius webhook hit:", events.length);
console.log("WEBHOOK FINGERPRINT: v2026-01-20-A");
console.log("WEBHOOK FINGERPRINT: v2026-01-20-A");
console.log("REQ PATH:", req.originalUrl);
console.log("HOST:", req.headers.host);

for (const e of events) {
  console.log("Event type:", e.type);

  const sig = e?.signature;
  if (!sig || seen.has(sig)) continue;
  seen.add(sig);

  // Ignore NFT sales
  if (e.type === "NFT_SALE") continue;

  





      // Check token transfers
      const transfers = Array.isArray(e?.tokenTransfers)
        ? e.tokenTransfers
        : [];

      // === FIX BUY vs SELL LOGIC ===
const trader = e.tokenTransfers?.find(t => t.mint === NC_MINT)?.toUserAccount;


if (!trader) {
  console.log("No trader found, skipping. sig:", sig);
  continue;
}


const ncTransfers = transfers.filter(t => t.mint === NC_MINT);

let ncDelta = 0;

for (const t of ncTransfers) {
  const amt = Number(t.tokenAmount || 0);
  if (!amt) continue;

  if (t.toUserAccount === trader) {
    ncDelta += amt;
  }
}


// 🔎 DEBUG – ADD THIS BLOCK
console.log("sig:", sig);
console.log("trader:", trader);
console.log("transfers total:", transfers?.length || 0);
console.log("ncTransfers length:", ncTransfers.length);

if (ncTransfers[0]) {
  console.log("sample nc transfer keys:", Object.keys(ncTransfers[0]));
  console.log("sample nc transfer:", ncTransfers[0]);
}

console.log("ncDelta:", ncDelta);


// 🚫 SKIP IF NO NET CHANGE
if (ncDelta === 0) continue;


const side = "BUY";


// 🚫 SKIP SELLS
if (ncDelta <= 0) {
  console.log("Skipping non-buy tx:", sig, "ncDelta:", ncDelta);
  continue;
}


const tokenQty = Math.abs(ncDelta);


const solSpent = null;

const txLink = `https://solscan.io/tx/${sig}`;


const tweet =
  `🐾 NC ${side}\n` +
  `Amount: ${tokenQty.toLocaleString()} NC\n` +
  `Wallet: ${shortAddr(trader)}\n` +
  `TX: ${txLink}`;

console.log("ABOUT TO TWEET side:", side, "sig:", sig);
console.log("tweet text:\n", tweet);


const resp = await tweetWithImage(tweet, "./assets/buybot.png");
console.log("TWEET SENT OK:", resp.data?.id);

require("https")
  .get("https://nc-buybot-production-2946.up.railway.app/fire-alert?msg=Ninja+Cat+Buy")
  .on("error", () => {});




console.log("TWEET SENT OK:", resp?.data?.id);

console.log(`Tweeted ${side}:`, sig);




 
    }

    res.status(200).send("ok");
 } catch (err) {
  console.log("Webhook error message:", err?.message);
  console.log("Webhook error data:", err?.data);
  console.log("Webhook error full:", err);
  res.status(500).send("error");
}

});


// serve files in /public
app.use("/public", express.static(path.join(__dirname, "public")));

// serve the overlay page
app.get("/overlay", (req, res) => {
  res.redirect("/public/overlay.html");
});

// ---- Ninja Cat Buy Alert state ----
let lastAlert = null;

// Trigger an alert (your buybot will call this)
app.get("/fire-alert", (req, res) => {
  lastAlert = {
    msg: req.query.msg || "Ninja Cat Buy!",
    ts: Date.now(),
  };
  res.status(200).send("ok");
});

// Overlay polls this endpoint
app.get("/poll-alert", (req, res) => {
  res.json(lastAlert);
});

app.get("*", (req, res) => {
  res.status(200).send("nc-buybot catchall " + req.path);
});

// --------- Start ---------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("BOOT: listening", { PORT, node: process.version });
});





























































