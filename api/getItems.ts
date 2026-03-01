// api/getItems.ts
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
    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any});

    // registry tab items in column B
    const response = await gsapi.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Registry!B2:B",
    });

    const items = response.data.values?.flatMap(v => v) || [];
    res.status(200).json({ items }); // ✅ wrap in { items: [...] }
  } catch (err: any) {
  console.error(err);
  res.status(500).json({ error: err.message || "Failed to fetch items" });
}
}