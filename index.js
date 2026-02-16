"use strict";

const express = require("express");
const { TwitterApi } = require("twitter-api-v2");
const fs = require("fs");
const path = require("path");
const https = require("https");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "2mb" }));

/**
 * CONFIG
 */
const NC_MINT = "7wH5YKNnhcjyqUUXZwsdQWK26JVj9ejfNwDFfR1VCyod";

// Optional: if you want to additionally ping your hosted overlay trigger endpoint
const PUBLIC_FIRE_ALERT_URL =
  process.env.PUBLIC_FIRE_ALERT_URL ||
  "https://nc-buybot-production-2946.up.railway.app/fire-alert?msg=Ninja+Cat+Buy";

/**
 * TWITTER CLIENT
 */
function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

const twitter = new TwitterApi({
  appKey: requireEnv("X_API_KEY"),
  appSecret: requireEnv("X_API_SECRET"),
  accessToken: requireEnv("X_ACCESS_TOKEN"),
  accessSecret: requireEnv("X_ACCESS_SECRET"),
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
  return twitter.v2.tweet({ text, media: { media_ids: [mediaId] } });
}

/**
 * OVERLAY (local)
 */
let lastAlert = null;

app.get("/health", (req, res) => res.status(200).send("ok"));

app.get("/overlay", (req, res) => {
  res.redirect("/public/overlay.html");
});
app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/fire-alert", (req, res) => {
  lastAlert = { msg: req.query.msg || "Ninja Cat Buy!", ts: Date.now() };
  res.status(200).send("ok");
});

app.get("/poll-alert", (req, res) => {
  res.json(lastAlert);
});

/**
 * DEDUPE CACHE (prevents double tweets)
 * Map: signature -> timestamp
 */
const seen = new Map();
const SEEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hasSeen(sig) {
  const ts = seen.get(sig);
  return ts && Date.now() - ts < SEEN_TTL_MS;
}

function markSeen(sig) {
  const now = Date.now();
  seen.set(sig, now);

  // cleanup when large
  if (seen.size > 5000) {
    for (const [s, ts] of seen) {
      if (now - ts > SEEN_TTL_MS) seen.delete(s);
    }
  }
}

/**
 * TEST TWEET
 */
app.get("/test-tweet", async (req, res) => {
  try {
    const msg = `🐾 NC Buybot test ${new Date().toISOString()}`;
    const resp = await tweetWithImage(msg);
    res.status(200).send(`Tweet sent ${resp.data?.id || ""}`);
  } catch (err) {
    console.log("TEST TWEET ERROR:", err?.message, err?.data || err);
    res.status(500).send("Tweet failed");
  }
});

/**
 * HELIUS WEBHOOK
 *
 * BUY definition:
 * - wallet net gained NC (tokenTransfers for NC mint)
 * - that same wallet net spent SOL (nativeBalanceChanges negative lamports)
 *
 * Then tweet + trigger overlay.
 */
app.post("/helius", async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    console.log("Helius webhook hit:", events.length);

    for (const e of events) {
      const sig = e?.signature;
      if (!sig) continue;
      if (hasSeen(sig)) continue;
      markSeen(sig);

      // Skip obvious sales if Helius tags them
      if (e?.type === "NFT_SALE") continue;

      const transfers = Array.isArray(e?.tokenTransfers) ? e.tokenTransfers : [];
      const ncTransfers = transfers.filter((t) => t?.mint === NC_MINT);
      if (!ncTransfers.length) continue;

      // Net NC by wallet
      const deltaByWallet = new Map();
      for (const t of ncTransfers) {
        const amt = Number(t.tokenAmount || 0);
        if (!amt) continue;

        const from = t.fromUserAccount || t.fromWallet || null;
        const to = t.toUserAccount || t.toWallet || null;

        if (from) deltaByWallet.set(from, (deltaByWallet.get(from) || 0) - amt);
        if (to) deltaByWallet.set(to, (deltaByWallet.get(to) || 0) + amt);
      }

      // Net SOL (lamports) by wallet
      const solDeltaByWallet = new Map();
      const native = Array.isArray(e?.nativeBalanceChanges)
        ? e.nativeBalanceChanges
        : [];

      for (const c of native) {
        const w = c.account;
        const lamports = Number(c.amount || 0);
        if (!w || !lamports) continue;
        solDeltaByWallet.set(w, (solDeltaByWallet.get(w) || 0) + lamports);
      }

      // Choose best BUY candidate: gained NC + spent SOL
      let trader = null;
      let ncDelta = 0;

      for (const [wallet, delta] of deltaByWallet.entries()) {
        if (!wallet) continue;
        const solDelta = solDeltaByWallet.get(wallet) || 0;

        if (delta > 0 && solDelta < 0) {
          if (delta > ncDelta) {
            ncDelta = delta;
            trader = wallet;
          }
        }
      }

      if (!trader || ncDelta <= 0) {
        console.log("Skipping non-buy:", sig, { trader, ncDelta });
        continue;
      }

      const traderSolDelta = solDeltaByWallet.get(trader) || 0;
      console.log("BUY CONFIRMED:", { sig, trader, ncDelta, traderSolDelta });

      const txLink = `https://solscan.io/tx/${sig}`;
      const tweet =
        `🐾 NC BUY\n` +
        `Amount: ${ncDelta.toLocaleString()} NC\n` +
        `Wallet: ${shortAddr(trader)}\n` +
        `TX: ${txLink}`;

      await tweetWithImage(tweet);

      // Trigger overlay locally
      lastAlert = { msg: "Ninja Cat Buy!", ts: Date.now() };

      // Optional: also ping your public app endpoint (ignore failures)
      if (PUBLIC_FIRE_ALERT_URL) {
        try {
          https.get(PUBLIC_FIRE_ALERT_URL).on("error", () => {});
        } catch (_) {}
      }
    }

    res.status(200).send("ok");
  } catch (err) {
    console.log("Webhook error:", err?.message, err?.data || err);
    res.status(500).send("error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("listening on", PORT));
