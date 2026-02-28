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

function getISTDateTime() {
  const now = new Date();
  const date = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const time = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
  return { date, time };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    // 🟠 FIX: GET handler added — returns the latest bill number + date/time
    if (req.method === "GET") {
      const billSheet = await gsapi.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "Bill!A:H",
      });

      const rows = billSheet.data.values || [];
      // skip header row, get the last row
      const lastRow = rows.length > 1 ? rows[rows.length - 1] : null;

      if (!lastRow) {
        return res.status(200).json({ billNo: null, date: null, time: null });
      }

      return res.status(200).json({
        billNo: Number(lastRow[0]),
        date: lastRow[6] || null,
        time: lastRow[7] || null,
      });
    }

    // POST — save bill
    if (req.method === "POST") {
      // 🟢 FIX: removed unused clientDate / clientTime destructuring
      const { items } = req.body;
      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: "Invalid items" });
      }

      const billSheet = await gsapi.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "Bill!A:A",
      });

      const lastBillNo =
        billSheet.data.values?.flat().filter(v => v).map(Number).pop() || 0;
      const billNo = lastBillNo + 1; // 🟢 FIX: billNo always comes from server, not frontend

      const { date, time } = getISTDateTime();

      const billValues = items.map((i: any) => [
        billNo,
        i.item,
        i.shade,
        i.qty,
        i.price,
        i.total,
        date,
        time,
        i.profit,
      ]);

      await gsapi.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: "Bill!A:I",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: billValues },
      });

      // update stock in respective item tabs
      for (const i of items) {
        const { item, shade, qty } = i;

        const stockRes = await gsapi.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `'${item}'!A2:B`,
        });

        const rows = stockRes.data.values || [];
        const rowIndex = rows.findIndex(r => r[0] === shade);

        if (rowIndex !== -1) {
          const currentStock = Number(rows[rowIndex][1]);
          const newStock = currentStock - qty;

          await gsapi.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${item}'!B${rowIndex + 2}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[newStock]] },
          });

          await gsapi.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${item}'!E${rowIndex + 2}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[newStock < 2 ? "Restock soon ⚠️" : ""]] },
          });

          await gsapi.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${item}'!D${rowIndex + 2}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [[`${date} ${time}`]] },
          });
        }
      }

      return res.status(200).json({ success: true, billNo });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process bill" });
  }
}