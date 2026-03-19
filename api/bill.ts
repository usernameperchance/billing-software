//api/bill.ts
import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
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

    // GET - return latest bill number so frontend can show next bill no
    if (req.method === "GET") {
      const billSheet = await gsapi.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "Bill!A:A",
      });

      const allValues = billSheet.data.values?.flat().filter(v => v) || [];
      const lastBillNo = allValues.map(Number).filter(n => !isNaN(n) && n > 0).pop() || 0;

      return res.status(200).json({ billNo: lastBillNo });
    }

    // POST - save bill
    if (req.method === "POST") {
      const { items, discountAmt = 0, discountPct = 0, finalTotal } = req.body;

      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: "Invalid items" });
      }

      const billSheet = await gsapi.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "Bill!A:A",
      });

      const allValues = billSheet.data.values?.flat().filter(v => v) || [];
      const lastBillNo = allValues.map(Number).filter(n => !isNaN(n) && n > 0).pop() || 0;
      const billNo = lastBillNo + 1;

      const { date, time } = getISTDateTime();

      // one row per item
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

      // append discount + final total as summary rows at end of bill
      if (discountAmt > 0) {
        await gsapi.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: "Bill!A:J",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [
              [billNo, "", "", "", "Discount", `-₹${discountAmt}`, date, time, "", `${discountPct}%`],
              [billNo, "", "", "", "Final Total", finalTotal ?? "", date, time, ""],
            ],
          },
        });
      }

      // update stock in respective item tabs
      for (const i of items) {
        const { item, shade, qty } = i;

        const stockRes = await gsapi.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `'${item}'!A2:B`,
        });

        const rows = stockRes.data.values || [];

        // FIX: case-insensitive + trimmed match so whitespace/casing differences don't silently skip
        const rowIndex = rows.findIndex(
          r => r[0]?.toString().trim().toLowerCase() === shade?.toString().trim().toLowerCase()
        );

        if (rowIndex === -1) {
          // FIX: log when shade not found so it shows up in Vercel function logs
          console.error(`Stock update skipped: shade "${shade}" not found in tab "${item}"`);
          continue;
        }

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
          range: `'${item}'!D${rowIndex + 2}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[`${date} ${time}`]] },
        });
      }

      return res.status(200).json({ success: true, billNo });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to process bill" });
  }
}
