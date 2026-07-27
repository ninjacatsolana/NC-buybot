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
 * BUY:
 * - transaction fee payer gained NC
 * - transaction fee payer sent SOL
 *
 * SELL:
 * - transaction fee payer lost NC
 *
 * Transfers, liquidity actions, failed transactions, and sells are ignored.
 */
app.post("/helius", async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];

    console.log("Helius webhook hit:", events.length);

    for (const e of events) {
      const sig = e?.signature;

      if (!sig) {
        console.log("Skipping event without signature");
        continue;
      }

      if (hasSeen(sig)) {
        console.log("Skipping duplicate:", sig);
        continue;
      }

      // Ignore failed transactions
      if (e?.transactionError) {
        console.log("Skipping failed transaction:", sig, e.transactionError);
        markSeen(sig);
        continue;
      }

      const trader = e?.feePayer;

      if (!trader) {
        console.log("Skipping transaction without fee payer:", sig);
        markSeen(sig);
        continue;
      }

      const transfers = Array.isArray(e?.tokenTransfers)
        ? e.tokenTransfers
        : [];

      const ncTransfers = transfers.filter(
        (transfer) => transfer?.mint === NC_MINT
      );

      if (!ncTransfers.length) {
        console.log("Skipping transaction without NC transfer:", sig);
        markSeen(sig);
        continue;
      }

      /**
       * Calculate the fee payer's net NC change.
       *
       * Positive = received NC
       * Negative = sent NC
       */
      let ncDelta = 0;

      for (const transfer of ncTransfers) {
        const amount = Number(transfer?.tokenAmount || 0);

        if (!Number.isFinite(amount) || amount <= 0) continue;

        const from =
          transfer?.fromUserAccount ||
          transfer?.fromWallet ||
          null;

        const to =
          transfer?.toUserAccount ||
          transfer?.toWallet ||
          null;

        if (from === trader) ncDelta -= amount;
        if (to === trader) ncDelta += amount;
      }

      /**
       * Calculate how much SOL the fee payer actually sent.
       *
       * We use nativeTransfers instead of raw balance changes because
       * raw balance changes include transaction fees and account rent.
       */
      const nativeTransfers = Array.isArray(e?.nativeTransfers)
        ? e.nativeTransfers
        : [];

      let solSentLamports = 0;
      let solReceivedLamports = 0;

      for (const transfer of nativeTransfers) {
        const amount = Number(transfer?.amount || 0);

        if (!Number.isFinite(amount) || amount <= 0) continue;

        if (transfer?.fromUserAccount === trader) {
          solSentLamports += amount;
        }

        if (transfer?.toUserAccount === trader) {
          solReceivedLamports += amount;
        }
      }

      const solSent = solSentLamports / 1_000_000_000;
      const solReceived = solReceivedLamports / 1_000_000_000;

      console.log("TRANSACTION CLASSIFICATION:", {
        sig,
        type: e?.type,
        source: e?.source,
        trader,
        ncDelta,
        solSent,
        solReceived,
      });

      /**
       * SELL
       *
       * The trader lost NC. Mark it processed and do nothing.
       */
      if (ncDelta < 0) {
        console.log("SELL DETECTED - no alert:", {
          sig,
          trader,
          ncSold: Math.abs(ncDelta),
          solReceived,
        });

        markSeen(sig);
        continue;
      }

      /**
       * TRANSFER / LIQUIDITY / OTHER
       *
       * Receiving NC without sending meaningful SOL should not count
       * as a buy.
       *
       * 0.00001 SOL keeps tiny fees or unusual movements from firing.
       */
      const MIN_SOL_BUY = 0.00001;

      if (ncDelta <= 0 || solSent < MIN_SOL_BUY) {
        console.log("Skipping non-buy transaction:", {
          sig,
          trader,
          ncDelta,
          solSent,
          solReceived,
        });

        markSeen(sig);
        continue;
      }

      console.log("BUY CONFIRMED:", {
        sig,
        trader,
        ncBought: ncDelta,
        solSpent: solSent,
      });

      const txLink = `https://solscan.io/tx/${sig}`;

      const tweet =
        `🐾 NC BUY\n` +
        `Bought: ${ncDelta.toLocaleString("en-US", {
          maximumFractionDigits: 2,
        })} NC\n` +
        `Spent: ${solSent.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        })} SOL\n` +
        `Wallet: ${shortAddr(trader)}\n` +
        `TX: ${txLink}`;

      /**
       * Only mark the transaction completed after the tweet succeeds.
       * Your old version marked it before tweeting, meaning a failed
       * tweet could never be retried.
       */
      await tweetWithImage(tweet);
      markSeen(sig);

      // Trigger local overlay
      lastAlert = {
        msg: `${ncDelta.toLocaleString("en-US", {
          maximumFractionDigits: 0,
        })} NC Buy!`,
        ts: Date.now(),
      };

      // Optionally trigger hosted overlay
      if (PUBLIC_FIRE_ALERT_URL) {
        try {
          https
            .get(PUBLIC_FIRE_ALERT_URL)
            .on("error", (error) => {
              console.log("Public alert trigger failed:", error.message);
            });
        } catch (error) {
          console.log("Public alert trigger error:", error.message);
        }
      }
    }

    res.status(200).send("ok");
  } catch (err) {
    console.log(
      "Webhook error:",
      err?.message,
      err?.data || err
    );

    res.status(500).send("error");
  }
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("listening on", PORT));
