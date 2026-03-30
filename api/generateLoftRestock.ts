import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const LOFT_SHEET_ID = process.env.LOFT_SHEET_ID!;
const RESTOCK_PHONE = "+919820467786";

function getTodayIST(): string {
  return new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
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
        phone: RESTOCK_PHONE,
        summary: "No pending Bhiwandi transfers",
      });
    }

    const lines: string[] = [];
    for (const [article, items] of Object.entries(articleMap)) {
      lines.push(`*${article.toUpperCase()}*`);
      lines.push(...items);
      lines.push("");
    }

    const header = `📦 *BHIWANDI TRANSFER REQUEST — ${today}*\n\n`;
    const footer = `\n✅ Total items: ${totalItems}`;
    const message = header + lines.join("\n") + footer;

    const waLink = `https://wa.me/${RESTOCK_PHONE}?text=${encodeURIComponent(message)}`;

    return res.status(200).json({
      message,
      waLink,
      phone: RESTOCK_PHONE,
      summary: `${totalItems} items across ${Object.keys(articleMap).length} articles`,
    });

  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to generate loft restock list" });
  }
}