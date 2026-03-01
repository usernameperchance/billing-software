// api/getShades.ts
import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = process.env.SHEET_ID!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { item } = req.query;
    if (!item) return res.status(400).json({ error: "Missing item" });

    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    const response = await gsapi.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${item}'!A2:A`,
    });

    // 🟢 FIX: removed unused `shades` variable, compute once and use directly
    const shades = response.data.values?.flatMap(v => v) || [];
    res.status(200).json({ shades });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch shades" });
  }
}
