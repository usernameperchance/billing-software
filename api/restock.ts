// api/restock.ts
import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const STORE_SHEET_ID = process.env.SHEET_ID!;
const LOFT_SHEET_ID = process.env.LOFT_SHEET_ID!;
const GODOWN_SHEET_ID = process.env.GODOWN_SHEET_ID!;
const RESTOCK_PHONE = "919820467786"; // Keep as is

const LOW_STOCK_THRESHOLD = 2;

function getTodayIST(): string {
  return new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

async function getPacketSize(gsapi: any, article: string): Promise<number> {
  try {
    const res = await gsapi.spreadsheets.values.get({
      spreadsheetId: LOFT_SHEET_ID,
      range: "Settings!A2:B",
    });
    const rows = res.data.values || [];
    const art = String(article).toLowerCase();
    for (const r of rows) {
      const keyword = String(r[0] || "").toLowerCase();
      if (keyword && art.includes(keyword)) return Number(r[1]) || 5;
    }
  } catch {}
  return 5;
}

async function getMOQ(gsapi: any, item: string): Promise<number> {
  try {
    const res = await gsapi.spreadsheets.values.get({
      spreadsheetId: STORE_SHEET_ID,
      range: "Registry!A2:C",
    });
    const rows = res.data.values || [];
    for (const r of rows) {
      if (String(r[0] || "").trim().toLowerCase() === item.toLowerCase()) {
        return Number(r[2]) || 10;
      }
    }
  } catch {}
  return 10;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { type } = req.query;

  if (!type || typeof type !== "string") {
    return res.status(400).json({ error: "Missing type parameter (store/loft/hooks/bhiwandi)" });
  }

  try {
    switch (type) {
      case "store":
        return await handleStoreRestock(res);
      case "loft":
        return await handleLoftRestock(res);
      case "hooks":
        return await handleHooksRestock(req, res);
      case "bhiwandi":
        return await handleBhiwandiRequests(res);
      default:
        return res.status(400).json({ error: `Unknown type: ${type}` });
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to generate restock" });
  }
}

// ============= STORE RESTOCK =============
async function handleStoreRestock(res: VercelResponse) {
  const client = await auth.getClient();
  const gsapi = google.sheets({ version: "v4", auth: client as any });
  const today = getTodayIST();

  const sheetMeta = await gsapi.spreadsheets.get({
    spreadsheetId: STORE_SHEET_ID,
    fields: "sheets.properties.title",
  });

  const skipTabs = [
    "bill", "registry", "profit", "discount", "discounts",
    "customers", "pointslog", "pointsconfig",
  ];

  const itemTabs = (sheetMeta.data.sheets || [])
    .map(s => s.properties?.title || "")
    .filter(name => name && !skipTabs.includes(name.toLowerCase()));

  const soldToday: Record<string, Record<string, number>> = {};

  try {
    const billRes = await gsapi.spreadsheets.values.get({
      spreadsheetId: STORE_SHEET_ID,
      range: "Bill!A2:H",
    });

    for (const row of (billRes.data.values || [])) {
      const billDate = row[6]?.toString().trim();
      const item = row[1]?.toString().trim();
      const shade = row[2]?.toString().trim();
      const qty = Number(row[3]) || 0;

      if (!item || !shade || shade === "MISC" || qty <= 0) continue;
      if (billDate !== today) continue;

      if (!soldToday[item]) soldToday[item] = {};
      soldToday[item][shade] = (soldToday[item][shade] || 0) + qty;
    }
  } catch {}

  const restockLines: string[] = [];
  let totalItems = 0;

  for (const tab of itemTabs) {
    try {
      const stockRes = await gsapi.spreadsheets.values.get({
        spreadsheetId: STORE_SHEET_ID,
        range: `'${tab}'!A2:B`,
      });

      const rows = stockRes.data.values || [];
      const lowShades: string[] = [];

      for (const r of rows) {
        const shade = r[0]?.toString().trim();
        const stockVal = r[1];

        if (!shade) continue;
        if (stockVal === undefined || stockVal === null || stockVal === "") continue;

        const stock = Number(stockVal);
        if (stock >= LOW_STOCK_THRESHOLD) continue;

        const soldQty = soldToday[tab]?.[shade];
        const soldNote = soldQty ? ` (sold ${soldQty} today)` : "";

        lowShades.push(`  ${shade} → stock: ${stock}${soldNote}`);
        totalItems++;
      }

      if (lowShades.length > 0) {
        restockLines.push(`*${tab.toUpperCase()}*`);
        restockLines.push(...lowShades);
        restockLines.push("");
      }
    } catch {}
  }

  if (totalItems === 0) {
    return res.status(200).json({
      message: null,
      summary: "All stock levels are healthy — nothing below threshold",
    });
  }

  const header = `📋 *STORE RESTOCK — ${today}*\n⚠️ Items below ${LOW_STOCK_THRESHOLD} units:\n\n`;
  const footer = `\n📦 Total items to restock: ${totalItems}`;
  const message = header + restockLines.join("\n") + footer;
  const waLink = `https://wa.me/${RESTOCK_PHONE}?text=${encodeURIComponent(message)}`;

  return res.status(200).json({ message, waLink, summary: `${totalItems} items below ${LOW_STOCK_THRESHOLD}` });
}

// ============= LOFT RESTOCK (Pending Transfers) =============
async function handleLoftRestock(res: VercelResponse) {
  const client = await auth.getClient();
  const gsapi = google.sheets({ version: "v4", auth: client as any });
  const today = getTodayIST();

  const pendingRes = await gsapi.spreadsheets.values.get({
    spreadsheetId: LOFT_SHEET_ID,
    range: "Pending Transfers!A2:F",
  });

  const rows = pendingRes.data.values || [];
  const articleMap: Record<string, string[]> = {};
  let totalItems = 0;

  for (const r of rows) {
    const status = String(r[5] || "").toLowerCase();
    if (status !== "pending") continue;

    const article = r[1]?.toString().trim();
    const shade = r[2]?.toString().trim();
    const qty = Number(r[4]) || 0;

    if (!article || !shade || qty <= 0) continue;

    if (!articleMap[article]) articleMap[article] = [];
    articleMap[article].push(`  ${shade} — ${qty} pkt`);
    totalItems++;
  }

  if (totalItems === 0) {
    return res.status(200).json({
      message: null,
      summary: "No pending Bhiwandi transfers",
    });
  }

  const lines: string[] = [];
  for (const [article, items] of Object.entries(articleMap)) {
    lines.push(`*${article.toUpperCase()}*`);
    lines.push(...items);
    lines.push("");
  }

  const header = `📦 *LOFT → BHIWANDI — ${today}*\n\n`;
  const footer = `\n✅ Total items: ${totalItems}`;
  const message = header + lines.join("\n") + footer;
  const waLink = `https://wa.me/${RESTOCK_PHONE}?text=${encodeURIComponent(message)}`;

  return res.status(200).json({ message, waLink, summary: `${totalItems} items across ${Object.keys(articleMap).length} articles` });
}

// ============= HOOKS RESTOCK =============
async function handleHooksRestock(req: VercelRequest, res: VercelResponse) {
  const { item } = req.query;
  if (!item) return res.status(400).json({ error: "Missing item parameter" });

  const client = await auth.getClient();
  const gsapi = google.sheets({ version: "v4", auth: client as any });

  const moq = await getMOQ(gsapi, String(item));
  const packetSize = await getPacketSize(gsapi, String(item));

  const storeRes = await gsapi.spreadsheets.values.get({
    spreadsheetId: STORE_SHEET_ID,
    range: `'${item}'!A2:H`,
  });

  const storeRows = storeRes.data.values || [];
  const transfers: any[] = [];
  const shortages: any[] = [];

  for (const row of storeRows) {
    const shade = row[0]?.toString().trim();
    if (!shade) continue;

    const hooksStock = Number(row[1]) || 0;
    const loftIndiv = Number(row[5]) || 0;
    const loftPackets = Number(row[6]) || 0;
    const bhiwandi = Number(row[7]) || 0;

    const shortage = moq - hooksStock;
    if (shortage <= 0) continue;

    let remaining = shortage;
    let plan: any = { shade, hooksStock, moq, transfers: [] };

    // Step 1: Bhiwandi first
    if (bhiwandi > 0) {
      const fromBhiwandi = Math.min(remaining, bhiwandi);
      plan.transfers.push({ from: "Bhiwandi", qty: fromBhiwandi });
      remaining -= fromBhiwandi;
    }

    // Step 2: Loft fallback
    if (remaining > 0) {
      const loftTotal = loftIndiv + (loftPackets * packetSize);
      if (loftTotal > 0) {
        const fromLoft = Math.min(remaining, loftTotal);
        
        let useIndiv = Math.min(fromLoft, loftIndiv);
        let remainingFromLoft = fromLoft - useIndiv;
        let usePackets = 0;
        let leftoverIndiv = 0;

        if (remainingFromLoft > 0) {
          usePackets = Math.ceil(remainingFromLoft / packetSize);
          const ballsFromPackets = usePackets * packetSize;
          leftoverIndiv = ballsFromPackets - remainingFromLoft;
        }

        plan.transfers.push({
          from: "Loft",
          qty: fromLoft,
          breakdown: { individuals: useIndiv, packets: usePackets, leftover: leftoverIndiv },
        });
        remaining -= fromLoft;
      }
    }

    if (remaining > 0) {
      shortages.push({ shade, needed: Math.ceil(remaining / packetSize) });
    }

    if (plan.transfers.length > 0) {
      transfers.push(plan);
    }
  }

  if (transfers.length === 0) {
    return res.status(200).json({
      message: "All items sufficiently stocked",
      transfers: [],
      shortages: [],
    });
  }

  const lines: string[] = [`📋 *HOOKS RESTOCK — ${item}*\n`];
  
  for (const t of transfers) {
    lines.push(`*${t.shade}*`);
    lines.push(`  Current: ${t.hooksStock} | Target: ${t.moq}`);
    
    for (const tr of t.transfers) {
      if (tr.from === "Bhiwandi") {
        lines.push(`  ✅ Transfer ${tr.qty} from Bhiwandi`);
      } else {
        const b = tr.breakdown;
        const desc = b.packets > 0
          ? `${b.individuals} indiv + ${b.packets} pkt (leftover: ${b.leftover})`
          : `${b.individuals} indiv`;
        lines.push(`  ✅ Transfer ${tr.qty} from Loft (${desc})`);
      }
    }
    lines.push("");
  }

  if (shortages.length > 0) {
    lines.push("⚠️ *Still Short (request from Bhiwandi):*");
    for (const s of shortages) {
      lines.push(`  ${s.shade} — ${s.needed} pkt`);
    }
  }

  return res.status(200).json({
    message: lines.join("\n"),
    transfers,
    shortages,
    item: String(item),
    packetSize,
  });
}

// ============= BHIWANDI REQUESTS =============
async function handleBhiwandiRequests(res: VercelResponse) {
  const client = await auth.getClient();
  const gsapi = google.sheets({ version: "v4", auth: client as any });
  const today = getTodayIST();

  const storeStock: Record<string, Record<string, number>> = {};
  const sheetMeta = await gsapi.spreadsheets.get({
    spreadsheetId: STORE_SHEET_ID,
    fields: "sheets.properties.title",
  });

  const skipTabs = [
    "bill", "registry", "profit", "discount", "discounts",
    "customers", "pointslog", "pointsconfig",
  ];

  const itemTabs = (sheetMeta.data.sheets || [])
    .map(s => s.properties?.title || "")
    .filter(name => name && !skipTabs.includes(name.toLowerCase()));

  for (const tab of itemTabs) {
    try {
      const stockRes = await gsapi.spreadsheets.values.get({
        spreadsheetId: STORE_SHEET_ID,
        range: `'${tab}'!A2:B`,
      });
      const rows = stockRes.data.values || [];
      for (const r of rows) {
        const shade = r[0]?.toString().trim();
        const stock = Number(r[1]) || 0;
        if (shade && stock < LOW_STOCK_THRESHOLD) {
          if (!storeStock[tab]) storeStock[tab] = {};
          storeStock[tab][shade] = stock;
        }
      }
    } catch {}
  }

  const pendingTransfers: Record<string, Record<string, number>> = {};
  try {
    const pendingRes = await gsapi.spreadsheets.values.get({
      spreadsheetId: LOFT_SHEET_ID,
      range: "Pending Transfers!A2:F",
    });
    const rows = pendingRes.data.values || [];
    for (const r of rows) {
      const status = String(r[5] || "").toLowerCase();
      if (status === "pending") {
        const article = r[1]?.toString().trim();
        const shade = r[2]?.toString().trim();
        const qty = Number(r[4]) || 0;
        if (article && shade && qty > 0) {
          if (!pendingTransfers[article]) pendingTransfers[article] = {};
          pendingTransfers[article][shade] = (pendingTransfers[article][shade] || 0) + qty;
        }
      }
    }
  } catch {}

  const lines: string[] = [`🏭 *BHIWANDI REQUESTS — ${today}*\n`];
  let totalRequests = 0;

  for (const [article, shades] of Object.entries(storeStock)) {
    lines.push(`*${article.toUpperCase()}*`);
    for (const [shade, stock] of Object.entries(shades)) {
      const pending = pendingTransfers[article]?.[shade] || 0;
      const needed = Math.max(0, LOW_STOCK_THRESHOLD - stock);
      if (needed > 0) {
        lines.push(`  ${shade} — need: ${needed} pcs (pending: ${pending})`);
        totalRequests++;
      }
    }
    lines.push("");
  }

  if (totalRequests === 0) {
    return res.status(200).json({
      message: null,
      summary: "No pending requests for Bhiwandi",
    });
  }

  const footer = `\n✅ Total requests: ${totalRequests}`;
  const message = lines.join("\n") + footer;
  const waLink = `https://wa.me/${RESTOCK_PHONE}?text=${encodeURIComponent(message)}`;

  return res.status(200).json({ message, waLink, summary: `${totalRequests} items to request` });
}