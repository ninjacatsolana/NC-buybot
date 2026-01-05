const express = require("express");
const { TwitterApi } = require("twitter-api-v2");
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
const NC_POOL = "F9MJEtLDppZA9d6Su2HomT1Bay3DjZaKSP8SamcrYDP4";

// ---------- Helpers ----------
const seen = new Set();

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

// ---------- Test tweet ----------
app.get("/test-tweet", async (req, res) => {
  try {
    const msg = `🐾 NC Buybot test ${new Date().toISOString()}`;
    await twitter.v2.tweet(msg);
    res.status(200).send("Tweet sent ✅");
  } catch (err) {
    console.log("Test tweet error:", err);
    res.status(500).send("Tweet failed ❌");
  }
});

// ---------- Helius webhook ----------
app.post("/helius", async (req, res) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body];
    console.log("Helius webhook hit:", events.length);

    for (const e of events) {
      const sig = e?.signature;
      if (!sig || seen.has(sig)) continue;
      seen.add(sig);

      // Ignore NFT events
      if (String(e?.type || "").includes("NFT")) continue;

      // Check token transfers
      const transfers = Array.isArray(e?.tokenTransfers)
        ? e.tokenTransfers
        : [];

      const ncTransfers = transfers.filter(t => t?.mint === NC_MINT);

      let best = null;
      for (const t of ncTransfers) {
        const amt = Number(t?.tokenAmount || 0);
        if (amt > 0 && (!best || amt > best.amt)) {
          best = { amt, buyer: t?.toUserAccount };
        }
      }

      if (!best) continue;

      const solSpent = pickSolSpent(e);
      const txLink = `https://solscan.io/tx/${sig}`;

      const tweet =
        `🐾 NC BUY\n` +
        (solSpent ? `Spent: ${solSpent.toFixed(4)} SOL\n` : ``) +
        `Amount: ${best.amt.toLocaleString()} NC\n` +
        `Buyer: ${shortAddr(best.buyer)}\n` +
        `TX: ${txLink}`;

      await twitter.v2.tweet(tweet);
      console.log("Tweeted buy:", sig);
    }

    res.status(200).send("ok");
  } catch (err) {
    console.log("Webhook error:", err);
    res.status(500).send("error");
  }
});

// ---------- Start ----------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});


