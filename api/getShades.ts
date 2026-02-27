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
    const { item } = req.query;
    if (!item) return res.status(400).json({ error: "Missing item" });

    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    const response = await gsapi.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${item}'!A2:A`, // shades/variants in column A of item tab
    });

    const shades = response.data.values?.flat() || [];
    res.status(200).json({ shades: response.data.values?.flatMap(v => v) || [] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch shades" });
  }
}