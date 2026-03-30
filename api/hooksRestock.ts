import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const STORE_SHEET_ID = process.env.SHEET_ID!;
const LOFT_SHEET_ID = process.env.LOFT_SHEET_ID!;

// Get packet size from Loft Settings
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

// Get MOQ from Registry
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
  try {
    const { item } = req.query;
    if (!item) return res.status(400).json({ error: "Missing item parameter" });

    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    const moq = await getMOQ(gsapi, String(item));
    const packetSize = await getPacketSize(gsapi, String(item));

    // Read Store sheet item tab
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
        plan.transfers.push({
          from: "Bhiwandi",
          qty: fromBhiwandi,
        });
        remaining -= fromBhiwandi;
      }

      // Step 2: Loft fallback
      if (remaining > 0) {
        const loftTotal = loftIndiv + (loftPackets * packetSize);
        if (loftTotal > 0) {
          const fromLoft = Math.min(remaining, loftTotal);
          
          // Calculate breakdown
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
            breakdown: {
              individuals: useIndiv,
              packets: usePackets,
              leftover: leftoverIndiv,
            },
          });
          remaining -= fromLoft;
        }
      }

      // Step 3: Still short? Log for Bhiwandi request
      if (remaining > 0) {
        shortages.push({
          shade,
          needed: Math.ceil(remaining / packetSize), // convert to packets
        });
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

    // Build message
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

  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to calculate restock" });
  }
}