const express = require("express");
const { TwitterApi } = require("twitter-api-v2");
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const https = require("https");

const app = express();
app.use(express.json({ limit: "2mb" }));

// ---- CONFIG ----
const NC_MINT = "7wH5YKNnhcjyqUUXZwsdQWK26JVj9ejfNwDFfR1VCyod";

// Start numbers (tweak)
const MIN_SOL_SPEND_LAMPORTS = 0.002 * 1e9; // 0.002 SOL
const MIN_NC_AMOUNT = 50; // 50 NC

// Seen signatures so we don’t double-tweet
const seen = new Set();
const SEEN_MAX = 5000;

// ---- TWITTER ----
const twitter = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

function shortAddr(a) {
  if (!a || typeof a !== "string") return "unknown";
  return a.slice(0, 4) + "…" + a.slice(-4);
}

async function tweetWithImage(text) {
  const imagePath = path.join(__dirname, "assets", "buybot.png");
  const mediaId = await twitter.v1.uploadMedia(fs.readFileSync(imagePath), {
    mimeType: "image/png",
  });

  return twitter.v2.tweet({
    text,
    media: { media_ids: [mediaId] },
  });
}

// ---- BASIC ROUTES ----
app.get("/health", (req, res) => res.status(200).send("ok"));

app.get("/version", (req, res) => {
  res.json({
    file: __filename,
    now: new Date().toISOString(),
    node: process.version,
    railwayCommit:
      process.env.RAILWAY_GIT_COMMIT_SHA ||
      process.env.RAILWAY_GIT_COMMIT ||
      null,
  });
});

// Overlay for Streamlabs
app.get("/overlay", (req, res) => res.redirect("/public/overlay.html"));
app.use("/public", express.static(path.join(__dirname, "public")));

// ---- ALERT STATE (NO REPLAY) ----
let lastAlert = null;

app.get("/fire-alert", (req, res) => {
  lastAlert = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    msg: req.query.msg || "Ninja Cat Buy!",
    ts: Date.now(),
  };
  res.status(200).send("ok");
});

// Client passes ?lastId=...
app.get("/poll-alert", (req, res) => {
  const lastId = req.query.lastId || "";
  if (!lastAlert) return res.json(null);
  if (lastAlert.id === lastId) return res.json(null);
  return res.json(lastAlert);
});

// Optional: manual test alert (no tweet)
app.get("/test-alert", (req, res) => {
  const msg = req.query.msg || "Test Alert";
  lastAlert = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    msg,
    ts: Date.now(),
  };
  res.status(200).send("ok");
});

// ---- HELIUS WEBHOOK ----
app.post("/helius", async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    console.log("Helius webhook hit:", events.length);

    for (const e of events) {
      const sig = e?.signature;
      if (!sig || seen.has(sig)) continue;

      seen.add(sig);
      if (seen.size > SEEN_MAX) {
        const first = seen.values().next().value;
        seen.delete(first);
      }

      if (e?.type === "NFT_SALE") continue;

      // Keep this strict for now (reduces transfers)
      if (e?.type && e.type !== "SWAP") continue;

      const transfers = Array.isArray(e?.tokenTransfers) ? e.tokenTransfers : [];
      const ncTransfers = transfers.filter((t) => t?.mint === NC_MINT);
      if (!ncTransfers.length) continue;

      // Net NC delta per wallet
      const deltaByWallet = new Map();
      for (const t of ncTransfers) {
        const amt = Number(t.tokenAmount || 0);
        if (!amt) continue;

        const from = t.fromUserAccount || t.fromWallet || null;
        const to = t.toUserAccount || t.toWallet || null;

        if (from) deltaByWallet.set(from, (deltaByWallet.get(from) || 0) - amt);
        if (to) deltaByWallet.set(to, (deltaByWallet.get(to) || 0) + amt);
      }

      // Net SOL delta per wallet (lamports)
      const solDeltaByWallet = new Map();
      const native = Array.isArray(e?.nativeBalanceChanges) ? e.nativeBalanceChanges : [];
      for (const c of native) {
        const w = c.account;
        const lamports = Number(c.amount || 0);
        if (!w || !lamports) continue;
        solDeltaByWallet.set(w, (solDeltaByWallet.get(w) || 0) + lamports);
      }

      // Pick best BUY candidate: gained NC AND spent SOL
      let trader = null;
      let ncDelta = 0;

      for (const [wallet, delta] of deltaByWallet.entries()) {
        const solDelta = solDeltaByWallet.get(wallet) || 0;
        if (delta > 0 && solDelta < 0 && delta > ncDelta) {
          ncDelta = delta;
          trader = wallet;
        }
      }

      if (!trader || ncDelta <= 0) continue;

      const traderSolDelta = solDeltaByWallet.get(trader) || 0;

      // Threshold filters
      if (Math.abs(traderSolDelta) < MIN_SOL_SPEND_LAMPORTS) continue;
      if (ncDelta < MIN_NC_AMOUNT) continue;

      console.log("BUY CONFIRMED:", { sig, trader, ncDelta, traderSolDelta });

      const txLink = `https://solscan.io/tx/${sig}`;
      const tweet =
        `🐾 NC BUY\n` +
        `Amount: ${ncDelta.toLocaleString()} NC\n` +
        `Wallet: ${shortAddr(trader)}\n` +
        `TX: ${txLink}`;

      await tweetWithImage(tweet);

      // Trigger overlay alert (same server)
      const msg = encodeURIComponent("Ninja Cat Buy");
      https
        .get(`https://nc-buybot-production-2946.up.railway.app/fire-alert?msg=${msg}`)
        .on("error", () => {});
    }

    res.status(200).send("ok");
  } catch (err) {
    console.log("Webhook error:", err?.message, err?.data || "");
    res.status(500).send("error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("listening on", PORT));
