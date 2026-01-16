console.log("BOOTING NC BUYBOT", new Date().toISOString());

const express = require("express");
const { TwitterApi } = require("twitter-api-v2");
require("dotenv").config();

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/ping", (req, res) => res.status(200).send("ok"));
app.get("/health", (req, res) => res.status(200).send("ok"));
app.get("/helius", (req, res) => {
  res.status(200).send("Helius endpoint is POST only. If you see this, the path is correct.");
});

app.get("/", (req, res) => {
  res.status(200).send("NC buybot is alive");
});




app.get("/meter/test", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const n = Number(req.query.usd || 25);
  addBuyToMeter(n);
  res.json({ ok: true, added: n, sessionUsd, goalUsd });
});


getSolUsd().catch(() => {});
setInterval(() => getSolUsd().catch(() => {}), 60_000);


// Meter read endpoint for the overlay
app.get("/meter", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  res.json({ sessionUsd, goalUsd });
});

// Optional reset endpoint for new stream
app.post("/meter/reset", (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  sessionUsd = 0;
  res.json({ ok: true, sessionUsd, goalUsd });
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
function pickSolSpent(e, trader) {
  const nts = Array.isArray(e?.nativeTransfers) ? e.nativeTransfers : [];
  let lamports = 0;

  for (const t of nts) {
    if (t?.fromUserAccount === trader) {
      lamports += Number(t?.amount || 0);
    }
  }

  if (lamports <= 0) return null;
  return lamports / 1_000_000_000;
}




  


function shortAddr(a) {
  if (!a || typeof a !== "string") return "unknown";
  return a.slice(0, 4) + "…" + a.slice(-4);
}

function lamportsToSol(lamports) {
  return lamports / 1_000_000_000;
}

function pickSolSpent(e, trader) {
  // 1) Best: nativeTransfers (SOL moved)
  const nts = Array.isArray(e?.nativeTransfers) ? e.nativeTransfers : [];
  let sumLamports = 0;

  for (const t of nts) {
    if (t?.fromUserAccount === trader) {
      sumLamports += Number(t?.amount || 0);
    }
  }

  if (sumLamports > 0) return sumLamports / 1_000_000_000;

  // 2) Fallback: nativeBalanceChanges
  const changes = Array.isArray(e?.nativeBalanceChanges)
    ? e.nativeBalanceChanges
    : [];

  let best = null;

  for (const c of changes) {
    const lamports = Number(c?.amount || 0);
    if (lamports < 0 && (best === null || lamports < best)) {
      best = lamports;
    }
  }

  if (best === null) return null;
  return Math.abs(best) / 1_000_000_000;
}

// ---------- Health ----------
app.get("/health", (req, res) => {
  res.status(200).send("ok");
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
  console.log("[HELIUS HIT]", new Date().toISOString());
console.log("[HELIUS BODY TYPE]", Array.isArray(req.body) ? "array" : typeof req.body);
console.log("[HELIUS EVENTS]", Array.isArray(req.body) ? req.body.length : 0);
  
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
const trader =
  e.feePayer ||
  e.tokenTransfers?.[0]?.toUserAccount ||
  e.tokenTransfers?.[0]?.fromUserAccount;

    if (!trader) {
      console.log("No trader found, skipping. sig:", sig);
      continue;
     // Only continue for TRANSFER events
if (e.type !== "TRANSFER") continue;

// NC transfers only
const ncTransfers = transfers.filter(t => t.mint === NC_MINT);
if (!ncTransfers.length) continue;

// BUY logic, pool -> user
let buyAmount = 0;
for (const t of ncTransfers) {
  const amt = Number(t.tokenAmount || 0);
  if (!amt) continue;

  const fromUser = t.fromUserAccount;
  const toUser = t.toUserAccount;

  if (fromUser === NC_POOL && toUser && toUser !== NC_POOL) {
    buyAmount += amt;
  }
}

if (buyAmount <= 0) continue;

// At this point it is a BUY, trigger your existing actions here
// IMPORTANT, do NOT add meter code here right now
console.log("BUY DETECTED:", { sig, trader, buyAmount });

// TODO, keep your existing X post and alert trigger lines here, whatever you had working before
 
    }

    // keep going, do NOT end the route here

    // ... ALL your buy logic stays here ...

  } // end for (const e of events)

  return res.status(200).send("ok");
} catch (err) {
  console.error("Helius error:", err);
  return res.status(500).send("error");
}
});





const ncTransfers = transfers.filter(t => t.mint === NC_MINT);

let buyAmount = 0;
let sellAmount = 0;

for (const t of ncTransfers) {
  const amt = Number(t.tokenAmount || 0);
  if (!amt) continue;

  const fromUser = t.fromUserAccount;
  const toUser = t.toUserAccount;

  // BUY: pool -> user
 if (fromUser === NC_POOL && toUser && toUser !== NC_POOL) {
  buyAmount += amt;
}


  // SELL: user -> pool
  if (toUser === NC_POOL && fromUser && fromUser !== NC_POOL) {
    sellAmount += amt;
  }
}

const ncDelta = buyAmount - sellAmount;

console.log("[NC FLOW]", { buyAmount, sellAmount, ncDelta });




// 🔎 DEBUG – ADD THIS BLOCK
console.log("sig:", sig);
console.log("trader:", trader);
console.log("transfers total:", transfers?.length || 0);
console.log("ncTransfers length:", ncTransfers.length);

if (ncTransfers[0]) {
  console.log("sample nc transfer keys:", Object.keys(ncTransfers[0]));
  console.log("sample nc transfer:", ncTransfers[0]);
}



// Use the NEW ncDelta from buyAmount/sellAmount
if (ncDelta <= 0) {
  console.log("Skipping non-buy tx:", sig, "ncDelta:", ncDelta);
  continue;
}
const side = "BUY";

if (buyUsd > 0) {
  addBuyToMeter(buyUsd);
  console.log("[METER ADD OK]", { sessionUsd_after: sessionUsd });
} else {
  console.log("[METER SKIP]", { reason: "buyUsd <= 0" });
}



const tokenQty = Math.abs(ncDelta);



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


// -------- Start --------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});






































































