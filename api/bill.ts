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
    const {billNo, items, date, time} = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: "Invalid items" });

    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any});

    // append bill to "bill" tab
    const billValues = items.map((i: any) => [billNo, i.item, i.shade, i.qty, i.price, i.total, date, time]);
await gsapi.spreadsheets.values.append({
  spreadsheetId: SPREADSHEET_ID,
  range: "Bill!A:H",
  valueInputOption: "USER_ENTERED",
  requestBody: { values: billValues },
});

    // update stock in respective item tabs
    for (const i of items) {
      const { item, shade, qty } = i;

      // fetch current stock
      const stockRes = await gsapi.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${item}!A2:B`,
      });

      const rows = stockRes.data.values || [];
      const rowIndex = rows.findIndex(r => r[0] === shade);
      if (rowIndex !== -1) {
        const currentStock = Number(rows[rowIndex][1]);
        const newStock = currentStock - qty;

        // update stock
        await gsapi.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${item}!B${rowIndex + 2}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[newStock]] },
        });

        // update alert if stock < 2
        if (newStock < 2) {
          await gsapi.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${item}!E${rowIndex + 2}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [["Restock soon ⚠️"]] },
          });
        } else {
          // clear alert if stock ok
          await gsapi.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${item}!E${rowIndex + 2}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[""]] },
          });
        }

        // update last updated column
        await gsapi.spreadsheets.values.update({
          spreadsheetId: SPREADSHEET_ID,
          range: `${item}!D${rowIndex + 2}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[new Date().toLocaleString("en-IN")]] },
        });
      }
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save bill" });
  }
}