import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

const SPREADSHEET_ID = process.env.SHEET_ID!;
const RESTOCK_PHONE = "+919820467786";
const LOW_STOCK_THRESHOLD = 2;

function getTodayIST(): string {
  return new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    const today = getTodayIST();

    // ── Step 1: Get all sheet tab names ──
    const sheetMeta = await gsapi.spreadsheets.get({
      spreadsheetId: SPREADSHEET_ID,
      fields: "sheets.properties.title",
    });

    const skipTabs = [
      "bill", "registry", "profit", "discount", "discounts",
      "customers", "pointslog", "pointsconfig",
    ];

    const itemTabs = (sheetMeta.data.sheets || [])
      .map(s => s.properties?.title || "")
      .filter(name => name && !skipTabs.includes(name.toLowerCase()));

    // ── Step 2: Get today's sales from Bill sheet (for context) ──
    const soldToday: Record<string, Record<string, number>> = {};

    try {
      const billRes = await gsapi.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
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
    } catch {
      // Bill sheet read failed — continue without sold data
    }

    // ── Step 3: Scan every item tab for low stock ──
    const restockLines: string[] = [];
    let totalItems = 0;

    for (const tab of itemTabs) {
      try {
        const stockRes = await gsapi.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `'${tab}'!A2:B`, // A=Shade, B=Stock
        });

        const rows = stockRes.data.values || [];
        const lowShades: string[] = [];

        for (const r of rows) {
          const shade = r[0]?.toString().trim();
          const stockVal = r[1];

          // Skip completely empty rows (no shade name)
          if (!shade) continue;

          // Skip shades where stock cell is empty/null (not ordered / unavailable)
          if (stockVal === undefined || stockVal === null || stockVal === "") continue;

          const stock = Number(stockVal);

          // Skip if stock is at or above threshold
          if (stock >= LOW_STOCK_THRESHOLD) continue;

          // This shade needs restocking
          const soldQty = soldToday[tab]?.[shade];
          const soldNote = soldQty ? ` (sold ${soldQty} today)` : "";

          lowShades.push(`  ${shade} → stock: ${stock}${soldNote}`);
          totalItems++;
        }

        if (lowShades.length > 0) {
          restockLines.push(`*${tab.toUpperCase()}*`);
          restockLines.push(...lowShades);
          restockLines.push(""); // blank line between articles
        }
      } catch {
        // Tab read failed — skip silently
      }
    }

    // ── Step 4: Build response ──
    if (totalItems === 0) {
      return res.status(200).json({
        message: null,
        phone: RESTOCK_PHONE,
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
      phone: RESTOCK_PHONE,
      summary: `${totalItems} items below ${LOW_STOCK_THRESHOLD} across ${restockLines.filter(l => l.startsWith("*")).length} articles`,
    });

  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to generate restock list" });
  }
}