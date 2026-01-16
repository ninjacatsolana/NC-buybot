const express = require("express");
const { TwitterApi } = require("twitter-api-v2");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "2mb" }));

// ---------- Twitter ----------
const twitter = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

// ---------- Ninja Cat config ----------
const NC_MINT = "7wH5YKNnhcjyqUUXZwsdQWK26JVj9ejfNwDFfR1VCyod";

// ---------- State ----------
const seen = new Set();
let lastAlert = null;

// ---------- Helpers ----------
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

  return twitter.v2.tweet({
    text,
    media: { media_ids: [mediaId] },
  });
}

function setAlert(msg) {
  lastAlert = { msg: msg || "Ninja Cat Buy!", ts: Date.now() };
  console.log("ALERT SET:", lastAlert);
}

// ---------- Basic routes ----------
app.get("/ping", (req, res) => res.status(200).send("ok"));
app.get("/health", (req, res) => res.status(200).send("ok"));
app.get("/", (req, res) => res.status(200).send("NC buybot is alive"));

// Helpful for browser testing (Helius is POST)
app.get("/helius", (req, res) => {
  res.status(200).send("Helius endpoint is POST only.");
});

// ---------- Test tweet ----------
app.get("/test-tweet", async (req, res) => {
  try {
    const msg = `🐾 NC Buybot test ${new Date().toISOString()}`;
    const resp = await tweetWithImage(msg);
    console.log("TWEET SENT OK:", resp.data?.id);
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

    for (const e of events) {
      console.log("Event type:", e?.type);

      const sig = e?.signature;
      if (!sig || seen.has(sig)) continue;
      seen.add(sig);

      if (e?.type === "NFT_SALE") continue;

      const transfers = Array.isArray(e?.tokenTransfers) ? e.tokenTransfers : [];
      const ncTransfers = transfers.filter((t) => t?.mint === NC_MINT);

      // If this event doesn't include NC transfers, skip it
      if (ncTransfers.length === 0) continue;

      // Pick a wallet to display (must be defined BEFORE we use it)
      const trader =
        e?.feePayer ||
        ncTransfers?.[0]?.toUserAccount ||
        ncTransfers?.[0]?.fromUserAccount ||
        transfers?.[0]?.toUserAccount ||
        transfers?.[0]?.fromUserAccount ||
        "unknown";

      // Sum tokens moved (simple + reliable)
      let tokenQty = 0;
      for (const t of ncTransfers) tokenQty += Number(t?.tokenAmount || 0);
      tokenQty = Math.abs(tokenQty);

      if (!Number.isFinite(tokenQty) || tokenQty <= 0) continue;

      const txLink = `https://solscan.io/tx/${sig}`;
      const tweet =
        `🐾 NC BUY\n` +
        `Amount: ${tokenQty.toLocaleString()} NC\n` +
        `Wallet: ${shortAddr(trader)}\n` +
        `TX: ${txLink}`;

      console.log("ABOUT TO TWEET:\n", tweet);

      const resp = await tweetWithImage(tweet);
      console.log("TWEET SENT OK:", resp.data?.id);

      // Trigger your overlay alert
      setAlert("Ninja Cat Buy!");

      console.log("DONE sig:", sig);
    }

    return res.status(200).send("ok");
  } catch (err) {
    console.log("Webhook error message:", err?.message);
    console.log("Webhook error data:", err?.data);
    console.log("Webhook error full:", err);
    return res.status(500).send("error");
  }
});

// ---------- Overlay + public ----------
app.use("/public", express.static(path.join(__dirname, "public")));

app.get("/overlay", (req, res) => {
  res.redirect("/public/overlay.html");
});

// Manually trigger alert in browser:
app.get("/fire-alert", (req, res) => {
  setAlert(req.query.msg || "Ninja Cat Buy!");
  res.status(200).send("ok");
});

// Overlay polls this:
app.get("/poll-alert", (req, res) => {
  res.json(lastAlert);
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
