// 001 index.js
// 002 Core
const express = require("express");
// 003
const { TwitterApi } = require("twitter-api-v2");
// 004
const fs = require("fs");
// 005
const path = require("path");
// 006
require("dotenv").config();

// 007 Boot log
console.log("BOOTING NC BUYBOT", new Date().toISOString());

// 008 App
const app = express();
// 009
app.use(express.json({ limit: "2mb" }));

// 010 Config
const NC_MINT = "7wH5YKNnhcjyqUUXZwsdQWK26JVj9ejfNwDFfR1VCyod";

// 011 Twitter client
const twitter = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

// 012 State
const seen = new Set();
// 013
let lastAlert = null;
// 014 Tweet queue so we do not spam X all at once
let tweetQueue = Promise.resolve();
// 015 Cache media id so we do not re upload every buy
let cachedMediaId = null;
// 016
let mediaInitPromise = null;

// 017 Helpers
function shortAddr(a) {
  if (!a || typeof a !== "string") return "unknown";
  return a.slice(0, 4) + "…" + a.slice(-4);
}

// 018 Alert setter
function setAlert(msg) {
  lastAlert = { msg: msg || "Ninja Cat Buy!", ts: Date.now() };
  console.log("ALERT SET:", lastAlert);
}

// 019 Sum tokenAmount safely
function sumTokenAmount(transfers) {
  let total = 0;
  for (const t of transfers) {
    const amt = Number(t?.tokenAmount || 0);
    if (Number.isFinite(amt)) total += amt;
  }
  return Math.abs(total);
}

// 020 Ensure media uploaded once
async function ensureMediaId() {
  if (cachedMediaId) return cachedMediaId;
  if (mediaInitPromise) return mediaInitPromise;

  mediaInitPromise = (async () => {
    const imagePath = path.join(__dirname, "assets", "buybot.png");
    const exists = fs.existsSync(imagePath);
    console.log("IMAGE CHECK:", imagePath, "exists:", exists);

    if (!exists) {
      throw new Error("buybot.png not found at " + imagePath);
    }

    const mediaId = await twitter.v1.uploadMedia(fs.readFileSync(imagePath), {
      mimeType: "image/png",
    });

    cachedMediaId = mediaId;
    console.log("MEDIA READY:", mediaId);
    return mediaId;
  })();

  return mediaInitPromise;
}

// 021 Tweet using cached media id, with one retry on 429 style failures
async function tweetWithImage(text) {
  const mediaId = await ensureMediaId();

  try {
    const resp = await twitter.v2.tweet({
      text,
      media: { media_ids: [mediaId] },
    });
    return resp;
  } catch (err) {
    const status = err?.code || err?.status || err?.data?.status;
    const msg = err?.message || "unknown error";
    console.log("TWEET FAIL status:", status, "message:", msg);

    // If media went stale or permissions changed, re upload once and retry
    cachedMediaId = null;
    mediaInitPromise = null;

    const mediaId2 = await ensureMediaId();
    const resp2 = await twitter.v2.tweet({
      text,
      media: { media_ids: [mediaId2] },
    });
    return resp2;
  }
}

// 022 Basic routes
app.get("/ping", (req, res) => res.status(200).send("ok"));
app.get("/health", (req, res) => res.status(200).send("ok"));
app.get("/", (req, res) => res.status(200).send("NC buybot is alive"));

// 023 Overlay routes
app.use("/public", express.static(path.join(__dirname, "public")));
app.get("/overlay", (req, res) => res.redirect("/public/overlay.html"));

app.get("/fire-alert", (req, res) => {
  setAlert(req.query.msg || "Ninja Cat Buy!");
  res.status(200).send("ok");
});

app.get("/poll-alert", (req, res) => {
  res.json(lastAlert);
});

// 024 Test tweet route
app.get("/test-tweet", async (req, res) => {
  try {
    const msg = `🐾 NC Buybot test ${new Date().toISOString()}`;
    const resp = await tweetWithImage(msg);
    console.log("TEST TWEET SENT OK:", resp?.data?.id);
    setAlert("Test alert ✅");
    res.status(200).send("Tweet sent ✅");
  } catch (err) {
    console.log("TEST TWEET FAIL message:", err?.message);
    console.log("TEST TWEET FAIL data:", err?.data);
    console.log("TEST TWEET FAIL full:", err);
    res.status(500).send("Tweet failed ❌");
  }
});

// 025 Helius webhook
app.post("/helius", (req, res) => {
  // Always respond fast so Helius does not retry or time out
  res.status(200).send("ok");

  // Process async
  (async () => {
    try {
      const events = Array.isArray(req.body) ? req.body : [req.body];
      console.log("Helius webhook hit:", events.length);

      for (const e of events) {
        const type = e?.type;
        const sig = e?.signature;

        console.log("Event type:", type);
        if (!sig) continue;

        if (seen.has(sig)) {
          console.log("Skipping duplicate sig:", sig);
          continue;
        }
        seen.add(sig);

        // Prevent memory creep
        if (seen.size > 2000) {
          console.log("Seen set too big, clearing");
          seen.clear();
          seen.add(sig);
        }

        if (type === "NFT_SALE") continue;
        if (type !== "TRANSFER") continue;

        const transfers = Array.isArray(e?.tokenTransfers) ? e.tokenTransfers : [];
        console.log("transfers total:", transfers.length);

        const ncTransfers = transfers.filter((t) => t?.mint === NC_MINT);
        console.log("ncTransfers length:", ncTransfers.length);
        if (ncTransfers.length === 0) continue;

        // Helpful debug
        console.log("sample nc transfer keys:", Object.keys(ncTransfers[0] || {}));
        console.log("sample nc transfer:", ncTransfers[0]);

        const tokenQty = sumTokenAmount(ncTransfers);
        console.log("tokenQty:", tokenQty);
        if (!Number.isFinite(tokenQty) || tokenQty <= 0) continue;

        // Pick a wallet to display
        const buyer =
          ncTransfers.find((t) => t?.toUserAccount)?.toUserAccount ||
          e?.feePayer ||
          ncTransfers?.[0]?.toUserAccount ||
          ncTransfers?.[0]?.fromUserAccount ||
          "unknown";

        const txLink = `https://solscan.io/tx/${sig}`;
        const tweetText =
          `🐾 NC BUY\n` +
          `Amount: ${tokenQty.toLocaleString()} NC\n` +
          `Wallet: ${shortAddr(buyer)}\n` +
          `TX: ${txLink}`;

        console.log("ABOUT TO TWEET:\n", tweetText);

        // Always alert even if tweeting fails
        setAlert(`Ninja Cat Buy! (${tokenQty.toLocaleString()} NC)`);

        // Queue tweet so multiple buys do not explode rate limits
        tweetQueue = tweetQueue
          .then(async () => {
            try {
              const resp = await tweetWithImage(tweetText);
              console.log("TWEET SENT OK:", resp?.data?.id);
            } catch (err) {
              console.log("TWEET FAIL message:", err?.message);
              console.log("TWEET FAIL data:", err?.data);
              console.log("TWEET FAIL full:", err);
            }
          })
          .catch((e2) => {
            console.log("tweetQueue error:", e2?.message || e2);
          });
      }
    } catch (err) {
      console.log("Webhook error message:", err?.message);
      console.log("Webhook error data:", err?.data);
      console.log("Webhook error full:", err);
    }
  })();
});

// 026 Start
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
