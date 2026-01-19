// index.js

// 1
const express = require("express");
// 2
const { TwitterApi } = require("twitter-api-v2");
// 3
const fs = require("fs");
// 4
const path = require("path");
// 5
require("dotenv").config();

// 6
console.log("BOOTING NC BUYBOT", new Date().toISOString());

// 7
const app = express();
// 8
app.use(express.json({ limit: "2mb" }));

// 9  ---------- Config ----------
const NC_MINT = "7wH5YKNnhcjyqUUXZwsdQWK26JVj9ejfNwDFfR1VCyod";

// 10 ---------- Twitter ----------
const twitter = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

// 11 ---------- State ----------
const seen = new Set();
// 12
let lastAlert = null;

// 13  Serialize tweets so we do not burst and get rate limited
let tweetQueue = Promise.resolve();

// 14 ---------- Helpers ----------
function shortAddr(a) {
  if (!a || typeof a !== "string") return "unknown";
  return a.slice(0, 4) + "…" + a.slice(-4);
}

async function tweetWithImage(text) {
  const imagePath = path.join(__dirname, "assets", "buybot.png");

  console.log("IMAGE CHECK:", imagePath, "exists:", fs.existsSync(imagePath));

  const mediaId = await twitter.v1.uploadMedia(fs.readFileSync(imagePath), {
    mimeType: "image/png",
  });

  console.log("MEDIA UPLOADED:", mediaId);

  const resp = await twitter.v2.tweet({
    text,
    media: { media_ids: [mediaId] },
  });

  return resp;
}

function setAlert(msg) {
  lastAlert = { msg: msg || "Ninja Cat Buy!", ts: Date.now() };
  console.log("ALERT SET:", lastAlert);
}

function sumTokenAmount(transfers) {
  let total = 0;
  for (const t of transfers) {
    const amt = Number(t?.tokenAmount || 0);
    if (Number.isFinite(amt)) total += amt;
  }
  return Math.abs(total);
}

// 15 ---------- Basic routes ----------
app.get("/ping", (req, res) => res.status(200).send("ok"));
app.get("/health", (req, res) => res.status(200).send("ok"));
app.get("/", (req, res) => res.status(200).send("NC buybot is alive"));

// 16 ---------- Overlay routes ----------
app.use("/public", express.static(path.join(__dirname, "public")));
app.get("/overlay", (req, res) => res.redirect("/public/overlay.html"));

app.get("/fire-alert", (req, res) => {
  setAlert(req.query.msg || "Ninja Cat Buy!");
  res.status(200).send("ok");
});

app.get("/poll-alert", (req, res) => {
  res.json(lastAlert);
});

// 17 ---------- Test tweet ----------
app.get("/test-tweet", async (req, res) => {
  try {
    const msg = `🐾 NC Buybot test ${new Date().toISOString()}`;
    const resp = await tweetWithImage(msg);
    console.log("TEST TWEET SENT OK:", resp.data?.id);
    setAlert("Test alert ✅");
    res.status(200).send("Tweet sent ✅");
  } catch (err) {
    console.log("TEST TWEET FAIL message:", err?.message);
    console.log("TEST TWEET FAIL data:", err?.data);
    console.log("TEST TWEET FAIL full:", err);
    res.status(500).send("Tweet failed ❌");
  }
});

// 18 ---------- Helius webhook ----------
app.post("/helius", async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    console.log("Helius webhook hit:", events.length);

    for (const e of events) {
      const type = e?.type;
      const sig = e?.signature;

      console.log("Event type:", type);
      console.log("sig:", sig);

      if (!sig) continue;
      if (seen.has(sig)) {
        console.log("Skipping duplicate sig:", sig);
        continue;
      }
      seen.add(sig);

      // keep the set from growing forever
      if (seen.size > 2000) {
        console.log("Seen set too big, clearing.");
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

      // Log one sample transfer (helps a ton)
      console.log("sample nc transfer keys:", Object.keys(ncTransfers[0] || {}));
      console.log("sample nc transfer:", ncTransfers[0]);

      const tokenQty = sumTokenAmount(ncTransfers);
      console.log("tokenQty:", tokenQty);

      if (!Number.isFinite(tokenQty) || tokenQty <= 0) continue;

      const buyer =
        ncTransfers.find((t) => t?.toUserAccount)?.toUserAccount ||
        e?.feePayer ||
        ncTransfers[0]?.toUserAccount ||
        ncTransfers[0]?.fromUserAccount ||
        "unknown";

      const txLink = `https://solscan.io/tx/${sig}`;
      const tweetText =
        `🐾 NC BUY\n` +
        `Amount: ${tokenQty.toLocaleString()} NC\n` +
        `Wallet: ${shortAddr(buyer)}\n` +
        `TX: ${txLink}`;

      console.log("ABOUT TO TWEET:\n", tweetText);

      // Always set the overlay alert even if tweeting fails
      setAlert(`Ninja Cat Buy! (${tokenQty.toLocaleString()} NC)`);

      // Queue the tweet to avoid burst failures / rate limit pain
      await (tweetQueue = tweetQueue
        .then(async () => {
          try {
            const resp = await tweetWithImage(tweetText);
            console.log("TWEET SENT OK:", resp.data?.id);
          } catch (err) {
            console.log("TWEET FAIL message:", err?.message);
            console.log("TWEET FAIL data:", err?.data);
            console.log("TWEET FAIL full:", err);
          }
        })
        .catch((e2) => {
          console.log("tweetQueue error:", e2?.message || e2);
        }));
    }

    return res.status(200).send("ok");
  } catch (err) {
    console.log("Webhook error message:", err?.message);
    console.log("Webhook error data:", err?.data);
    console.log("Webhook error full:", err);
    return res.status(500).send("error");
  }
});

// 19 ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
