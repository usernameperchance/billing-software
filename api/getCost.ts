// /api/getCost.ts
import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: {
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
  },
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = process.env.SHEET_ID!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { item, shade } = req.query;
    if (!item) return res.status(400).json({ error: "Missing item" });

    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    const response = await gsapi.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `Profit!A2:C`, // A=Item, B=Shade(optional), C=CPS
    });

    const rows = response.data.values || [];

    // first try exact item+shade match
    let row = rows.find(
      r =>
        r[0]?.toString().trim().toLowerCase() === item.toString().trim().toLowerCase() &&
        r[1]?.toString().trim().toLowerCase() === (shade || "").toString().trim().toLowerCase()
    );

    // fallback: item only (for yarns same cps)
    if (!row) {
      row = rows.find(
        r =>
          r[0]?.toString().trim().toLowerCase() === item.toString().trim().toLowerCase()
      );
    }

    const cost = row && row[2] ? Number(row[2]) : 0;

    res.status(200).json({ cost });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch cost" });
  }
}