import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = process.env.SHEET_ID!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    const response = await gsapi.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Discounts!A2:B",
    });

    const slabs = (response.data.values || [])
      .filter(row => row[0] && row[1])
      .map(row => ({
        minTotal: Number(row[0]),
        maxTotal: row[1] ? Number(row[1]) : Infinity,
        pct: Number(row[2]),
      }))
      .sort((a, b) => a.minTotal - b.minTotal);

    res.status(200).json({ slabs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch discounts" });
  }
}