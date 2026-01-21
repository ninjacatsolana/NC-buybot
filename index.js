const express = require("express");
const { TwitterApi } = require("twitter-api-v2");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "2mb" }));

// Twitter client
const twitter = new TwitterApi({
  appKey: process.env.X_API_KEY,
  appSecret: process.env.X_API_SECRET,
  accessToken: process.env.X_ACCESS_TOKEN,
  accessSecret: process.env.X_ACCESS_SECRET,
});

// Ninja Cat config
const NC_MINT = "7wH5YKNnhcjyqUUXZwsdQWK26JVj9ejfNwDFfR1VCyod";

// Helpers
const fs = require("fs");
const path = require("path");
const seen = new Set();

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

// Health
app.get("/health", (req, res) => {
  res.status(200).send("ok");
});

// Simple overlay URL for Streamlabs browser source
app.get("/overlay", (req, res) => {
  res.redirect("/public/overlay.html");
});
app.use("/public", express.static(path.join(__dirname, "public")));

// Buy alert endpoints for overlay polling
let lastAlert = null;

app.get("/fire-alert", (req, res) => {
  lastAlert = { msg: req.query.msg || "Ninja Cat Buy!", ts: Date.now() };
  res.status(200).send("ok");
});

app.get("/poll-alert", (req, res) => {
  res.json(lastAlert);
});

// Test tweet
app.get("/test-tweet", async (req, res) => {
  try {
    const msg = `🐾 NC Buybot test ${new Date().toISOString()}`;
    const resp = await tweetWithImage(msg);
    res.status(200).send(`Tweet sent ${resp.data?.id || ""}`);
  } catch (err) {
    console.log("TEST TWEET ERROR:", err?.message, err?.data || "");
    res.status(500).send("Tweet failed");
  }
});

// Helius webhook
app.post("/helius", async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    console.log("Helius webhook hit:", events.length);

    for (const e of events) {
      const sig = e?.signature;
      if (!sig || seen.has(sig)) continue;
      seen.add(sig);

      if (e?.type === "NFT_SALE") continue;

      const transfers = Array.isArray(e?.tokenTransfers) ? e.tokenTransfers : [];
      const ncTransfers = transfers.filter((t) => t?.mint === NC_MINT);
      if (!ncTransfers.length) continue;

      // Pick the receiving wallet for NC in this tx
      const trader = e.feePayer;
      if (!trader) continue;

      // Net NC in to trader
      let ncIn = 0;
      let ncOut = 0;

      for (const t of ncTransfers) {
        const amt = Number(t?.tokenAmount || 0);
        if (!amt) continue;
        if (t.toUserAccount === trader) ncIn += amt;
        if (t.fromUserAccount === trader) ncOut += amt;
      }

      const ncDelta = ncIn - ncOut;

      if (ncDelta <= 0) {
  console.log("Skipping SELL or no change:", sig, "ncDelta:", ncDelta, "trader:", trader);
  continue;
}


      const tokenQty = Math.abs(ncDelta);
      const txLink = `https://solscan.io/tx/${sig}`;

      const tweet =
        `🐾 NC BUY\n` +
        `Amount: ${tokenQty.toLocaleString()} NC\n` +
        `Wallet: ${shortAddr(trader)}\n` +
        `TX: ${txLink}`;

      await tweetWithImage(tweet);

      // Trigger overlay alert
      require("https")
        .get(
          "https://nc-buybot-production-2946.up.railway.app/fire-alert?msg=Ninja+Cat+Buy"
        )
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

