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
const trader = e.feePayer;
if (!trader) continue;

const ncTransfers = transfers.filter(t => t.mint === NC_MINT);

let ncIn = 0;
let ncOut = 0;

for (const t of ncTransfers) {
  const amt = Number(t.tokenAmount || 0);
  if (!amt) continue;

  if (t.toUserAccount === trader) ncIn += amt;
  if (t.fromUserAccount === trader) ncOut += amt;
}

const ncDelta = ncIn - ncOut;

// 🔎 DEBUG – ADD THIS BLOCK
console.log("sig:", sig);
console.log("trader:", trader);
console.log("transfers total:", transfers?.length || 0);
console.log("ncTransfers length:", ncTransfers.length);

if (ncTransfers[0]) {
  console.log("sample nc transfer keys:", Object.keys(ncTransfers[0]));
  console.log("sample nc transfer:", ncTransfers[0]);
}

console.log("ncIn:", ncIn, "ncOut:", ncOut, "ncDelta:", ncDelta);

// 🚫 SKIP IF NO NET CHANGE
if (ncDelta === 0) continue;


const side = ncDelta > 0 ? "BUY" : "SELL";
const tokenQty = Math.abs(ncDelta);

const solSpent = null;

const txLink = `https://solscan.io/tx/${sig}`;

const tweet =
  `🐾 NC ${side}\n` +
  (solSpent ? `SOL ${side === "BUY" ? "Spent" : "Received"}: ${Math.abs(solSpent).toFixed(4)}\n` : "") +
  `Amount: ${tokenQty.toLocaleString()} NC\n` +
  `Wallet: ${shortAddr(trader)}\n` +
  `TX: ${txLink}`;


await twitter_v2.tweet(tweet);
console.log(`Tweeted ${side}:`, sig);
;
 
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












