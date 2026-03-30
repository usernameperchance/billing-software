import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const STORE_SHEET_ID = process.env.SHEET_ID!;
const LOFT_SHEET_ID = process.env.LOFT_SHEET_ID!;
const RESTOCK_PHONE = "919820467786"; // Replace
const LOW_STOCK_THRESHOLD = 2;

function getTodayIST(): string {
  return new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { type } = req.query; // "store" or "loft"
    
    if (type === "store") {
      return await handleStoreRestock(res);
    } else if (type === "loft") {
      return await handleLoftRestock(res);
    } else {
      return res.status(400).json({ error: "Missing type parameter (store/loft)" });
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to generate restock" });
  }
}

// ══════════════════════════════════════════
// STORE RESTOCK (Threshold-based)
// ══════════════════════════════════════════
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

  return res.status(200).json({
    message,
    waLink,
    summary: `${totalItems} items below ${LOW_STOCK_THRESHOLD}`,
  });
}

// ══════════════════════════════════════════
// LOFT RESTOCK (Pending Transfers)
// ══════════════════════════════════════════
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

  return res.status(200).json({
    message,
    waLink,
    summary: `${totalItems} items across ${Object.keys(articleMap).length} articles`,
  });
}