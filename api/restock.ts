// api/restock.ts
import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const STORE_SHEET_ID = process.env.SHEET_ID!;
const LOFT_SHEET_ID = process.env.LOFT_SHEET_ID!;
const RESTOCK_PHONE = "9820467786";

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

async function ensureRestockRequestsSheet(gsapi: any) {
  const sheetMeta = await gsapi.spreadsheets.get({
    spreadsheetId: STORE_SHEET_ID,
    fields: "sheets.properties.title",
  });
  const exists = sheetMeta.data.sheets?.some((s: any) => s.properties?.title === "Restock Requests");
  if (!exists) {
    await gsapi.spreadsheets.batchUpdate({
      spreadsheetId: STORE_SHEET_ID,
      requestBody: {
        requests: [{ addSheet: { properties: { title: "Restock Requests" } } }]
      }
    });
    await gsapi.spreadsheets.values.update({
      spreadsheetId: STORE_SHEET_ID,
      range: "Restock Requests!A1:D1",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [["Item", "Shade", "Requested Date", "Status"]] }
    });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { type } = req.query;

  if (!type || typeof type !== "string") {
    return res.status(400).json({ error: "Missing type parameter" });
  }

  try {
    switch (type) {
      case "store":
        return await handleStoreRestock(req, res);
      case "hooks":
        return await handleHooksRestock(req, res);
      default:
        return res.status(400).json({ error: `Unknown type: ${type}` });
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to generate restock" });
  }
}

async function handleStoreRestock(req: VercelRequest, res: VercelResponse) {
  const { item } = req.query;
  const isAll = item === "all";

  if (!item || typeof item !== "string") {
    return res.status(400).json({ error: "Missing item parameter. Use 'all' for full list or specify an item name." });
  }

  const client = await auth.getClient();
  const gsapi = google.sheets({ version: "v4", auth: client as any });
  const today = getTodayIST();
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  await ensureRestockRequestsSheet(gsapi);

  const reqRes = await gsapi.spreadsheets.values.get({
    spreadsheetId: STORE_SHEET_ID,
    range: "Restock Requests!A2:D",
  });
  const requestedRows = reqRes.data.values || [];
  const recentRequests = new Set<string>();
  for (const r of requestedRows) {
    const reqDate = new Date(r[2]);
    if (reqDate >= oneWeekAgo && r[3]?.toLowerCase() === "pending") {
      recentRequests.add(`${r[0]}|${r[1]}`);
    }
  }

  const sheetMeta = await gsapi.spreadsheets.get({
    spreadsheetId: STORE_SHEET_ID,
    fields: "sheets.properties.title",
  });
  const skipTabs = [
    "bill", "registry", "profit", "discount", "discounts", "customers",
    "pointslog", "pointsconfig", "restock requests", "loft fallback log"
  ];
  const allItemTabs = (sheetMeta.data.sheets || [])
    .map(s => s.properties?.title || "")
    .filter(name => name && !skipTabs.includes(name.toLowerCase()));

  let itemsToProcess: string[] = [];
  if (isAll) {
    itemsToProcess = allItemTabs;
  } else {
    const matchedItem = allItemTabs.find(tab => tab.toLowerCase() === item.toLowerCase());
    if (!matchedItem) {
      return res.status(404).json({ error: `Item sheet '${item}' not found.` });
    }
    itemsToProcess = [matchedItem];
  }

  const restockLines: string[] = [];
  const newRequests: any[] = [];
  let totalShades = 0;

  for (const tab of itemsToProcess) {
    try {
      // New column layout: B=shade, C=stock
      const stockRes = await gsapi.spreadsheets.values.get({
        spreadsheetId: STORE_SHEET_ID,
        range: `'${tab.replace(/'/g, "''")}'!B2:C`,
      });
      const rows = stockRes.data.values || [];
      let tabLines: string[] = [];
      for (const r of rows) {
        const shade = r[0]?.toString().trim();
        const stockCell = r[1];
        if (!shade) continue;
        if (stockCell === undefined || stockCell === null || stockCell === "") continue;
        const stock = Number(stockCell);
        if (isNaN(stock)) continue;
        if (stock >= LOW_STOCK_THRESHOLD) continue;

        const key = `${tab}|${shade}`;
        if (recentRequests.has(key)) continue;

        tabLines.push(`  ${shade} → stock: ${stock}`);
        newRequests.push([tab, shade, today, "Pending"]);
        totalShades++;
      }
      if (tabLines.length) {
        restockLines.push(`*${tab.toUpperCase()}*`);
        restockLines.push(...tabLines);
        restockLines.push("");
      }
    } catch (err) {
      console.error(`Error reading sheet ${tab}:`, err);
    }
  }

  if (totalShades === 0) {
    let summary = isAll
      ? "No items below threshold or all already requested this week."
      : `No restock needed for ${item} (all shades above threshold or already requested).`;
    return res.status(200).json({ message: null, summary });
  }

  if (newRequests.length > 0) {
    await gsapi.spreadsheets.values.append({
      spreadsheetId: STORE_SHEET_ID,
      range: "Restock Requests!A:D",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: newRequests },
    });
  }

  const header = isAll
    ? `📋 *FULL HOOKS RESTOCK — ${today}*\n⚠️ Items below ${LOW_STOCK_THRESHOLD} (not yet requested this week):\n\n`
    : `📋 *HOOKS RESTOCK — ${today}*\nItem: *${itemsToProcess[0].toUpperCase()}*\n⚠️ Shades below ${LOW_STOCK_THRESHOLD} (not yet requested this week):\n\n`;
  const footer = `\n📦 Total shades to restock: ${totalShades}`;
  const message = header + restockLines.join("\n") + footer;
  const waLink = `https://wa.me/${RESTOCK_PHONE}?text=${encodeURIComponent(message)}`;

  return res.status(200).json({ message, waLink, summary: `${totalShades} shade(s) need restock${isAll ? " across all items" : ` for ${itemsToProcess[0]}`}` });
}

async function handleHooksRestock(req: VercelRequest, res: VercelResponse) {
  const { item } = req.query;
  if (!item || typeof item !== "string") {
    return res.status(400).json({ error: "Missing item parameter" });
  }

  const client = await auth.getClient();
  const gsapi = google.sheets({ version: "v4", auth: client as any });

  const moq = await getMOQ(gsapi, item);
  const packetSize = await getPacketSize(gsapi, item);

  // Store sheet new columns: B=shade, C=stock, F=loftIndiv, G=loftPackets, H=bhiwandi
  const storeRes = await gsapi.spreadsheets.values.get({
    spreadsheetId: STORE_SHEET_ID,
    range: `'${item.replace(/'/g, "''")}'!B2:H`,
  });
  const storeRows = storeRes.data.values || [];
  const transfers: any[] = [];
  const shortages: any[] = [];

  for (const row of storeRows) {
    const shade = row[0]?.toString().trim();
    if (!shade) continue;

    const hooksStock = Number(row[1]) || 0;
    const loftIndiv = Number(row[4]) || 0;
    const loftPackets = Number(row[5]) || 0;
    const bhiwandi = Number(row[6]) || 0;

    const shortage = moq - hooksStock;
    if (shortage <= 0) continue;

    let remaining = shortage;
    let plan: any = { shade, hooksStock, moq, transfers: [] };

    if (bhiwandi > 0) {
      const fromBhiwandi = Math.min(remaining, bhiwandi);
      plan.transfers.push({ from: "Bhiwandi", qty: fromBhiwandi });
      remaining -= fromBhiwandi;
    }

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
    return res.status(200).json({ message: "All items sufficiently stocked", transfers: [], shortages: [] });
  }

  const lines: string[] = [`📋 *HOOKS RESTOCK PLAN — ${item}*\n`];
  for (const t of transfers) {
    lines.push(`*${t.shade}*`);
    lines.push(`  Current: ${t.hooksStock} | Target: ${t.moq}`);
    for (const tr of t.transfers) {
      if (tr.from === "Bhiwandi") {
        lines.push(`  ✅ Transfer ${tr.qty} from Bhiwandi`);
      } else {
        const b = tr.breakdown;
        const desc = b.packets > 0 ? `${b.individuals} indiv + ${b.packets} pkt (leftover: ${b.leftover})` : `${b.individuals} indiv`;
        lines.push(`  ✅ Transfer ${tr.qty} from Loft (${desc})`);
      }
    }
    lines.push("");
  }
  if (shortages.length > 0) {
    lines.push("⚠️ *Still Short (request from Bhiwandi):*");
    for (const s of shortages) lines.push(`  ${s.shade} — ${s.needed} pkt`);
  }

  return res.status(200).json({ message: lines.join("\n"), transfers, shortages, item, packetSize });
}