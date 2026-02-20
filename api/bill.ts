import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const items = req.body;
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ message: "No items received" });

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.SHEET_ID;

    const billNo = Math.floor(Math.random() * 1000000);
    const now = new Date();
    const date = now.toLocaleDateString();
    const time = now.toLocaleTimeString();

    const rows = items.map((i: any) => [
      billNo,
      i.item,
      i.shade,
      i.qty,
      i.price,
      i.total,
      date,
      time,
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "bill!A:H", // columns: Bill No | Item | Shade / Variant | Qty | Price | Total | Date | Time
      valueInputOption: "USER_ENTERED",
      requestBody: { values: rows },
    });

    res.status(200).json({ message: "Bill saved successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to save bill" });
  }
}