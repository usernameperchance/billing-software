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
    if (!item || !shade) return res.status(400).json({ error: "Missing item or shade" });

    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    const response = await gsapi.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${item}!A2:C`, // assuming: A=Shade, B=Stock, C=Price
    });

    const rows = response.data.values || [];
    const row = rows.find(r => r[0]?.toString().trim().toLowerCase() === shade.toString().trim().toLowerCase());
    const price = row && row[2] ? Number(row[2]) : 0;
    const qty = row && row[1] ? Number(row[1]) : 0;

    res.status(200).json({ price, qty });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch price" });
  }
}