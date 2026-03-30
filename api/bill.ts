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

function generateCustomerId(rows: any[][]): string {
  const ids = rows
    .map(r => r[0]?.toString())
    .filter(id => id?.startsWith("LMS-"))
    .map(id => Number(id.replace("LMS-", "")))
    .filter(n => !isNaN(n));
  const next = ids.length > 0 ? Math.max(...ids) + 1 : 1;
  return `LMS-${String(next).padStart(4, "0")}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    // GET — return latest bill number
    if (req.method === "GET") {
      const billSheet = await gsapi.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "Bill!A:A",
      });
      const allValues = billSheet.data.values?.flat().filter(v => v) || [];
      const lastBillNo = allValues.map(Number).filter(n => !isNaN(n) && n > 0).pop() || 0;
      return res.status(200).json({ billNo: lastBillNo });
    }

    // POST — save bill
    if (req.method === "POST") {
      const {
        items,
        discountAmt = 0,
        discountPct = 0,
        finalTotal,
        pointsRedeemed = 0,
        customer,
        earnRate = 0,
        redeemRate = 0,
      } = req.body;

      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: "Invalid items" });
      }

      const { date, time } = getISTDateTime();

      // ── Bill number ──
      const billSheet = await gsapi.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: "Bill!A:A",
      });
      const allValues = billSheet.data.values?.flat().filter(v => v) || [];
      const lastBillNo = allValues.map(Number).filter(n => !isNaN(n) && n > 0).pop() || 0;
      const billNo = lastBillNo + 1;

      // ── Write bill rows ──
      const billValues = items.map((i: any) => [
        billNo, i.item, i.shade, i.qty, i.price, i.total, date, time, i.profit,
      ]);

      await gsapi.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: "Bill!A:I",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: billValues },
      });

      // ── Discount / points summary rows ──
      const effectiveDiscount = pointsRedeemed > 0 ? pointsRedeemed : discountAmt;
      if (effectiveDiscount > 0) {
        const label = pointsRedeemed > 0 ? `Points Redeemed` : `Discount`;
        const detail = pointsRedeemed > 0
          ? `${pointsRedeemed / redeemRate} pts`
          : `${discountPct}%`;
        await gsapi.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: "Bill!A:J",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [
              [billNo, "", "", "", label, `-₹${effectiveDiscount}`, date, time, "", detail],
              [billNo, "", "", "", "Final Total", finalTotal ?? "", date, time, ""],
            ],
          },
        });
      }

      // ── Stock updates — skip misc items and missing tabs ──
      await Promise.all(items.map(async (i: any) => {
        const { item, shade, qty } = i;

        // Skip misc items (shade "MISC" or items not in registry)
        if (shade === "MISC") return;

        try {
          const stockRes = await gsapi.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `'${item}'!A2:B`,
          });
          const rows = stockRes.data.values || [];
          const rowIndex = rows.findIndex(
            r => r[0]?.toString().trim().toLowerCase() === shade?.toString().trim().toLowerCase()
          );
          if (rowIndex === -1) {
            console.error(`Stock update skipped: shade "${shade}" not found in tab "${item}"`);
            return;
          }
          const newStock = Number(rows[rowIndex][1]) - qty;
          await Promise.all([
            gsapi.spreadsheets.values.update({
              spreadsheetId: SPREADSHEET_ID,
              range: `'${item}'!B${rowIndex + 2}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[newStock]] },
            }),
            gsapi.spreadsheets.values.update({
              spreadsheetId: SPREADSHEET_ID,
              range: `'${item}'!D${rowIndex + 2}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[`${date} ${time}`]] },
            }),
          ]);
        } catch (stockErr) {
          // Tab doesn't exist (misc item typed with real-looking name) — skip silently
          console.error(`Stock update failed for "${item}" / "${shade}":`, stockErr);
        }
      }));

      // ── Customer upsert — wrapped so it can't kill the response ──
      if (customer?.phone) {
        try {
          const custRes = await gsapi.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: "Customers!A2:H",
          });
          const custRows = custRes.data.values || [];
          const rowIndex = custRows.findIndex(
            r => r[2]?.toString().trim() === customer.phone.toString().trim()
          );

          const pointsEarned = pointsRedeemed > 0
            ? 0
            : Math.floor((finalTotal / 100) * earnRate);

          if (rowIndex === -1) {
            const newId = generateCustomerId(custRows);
            await gsapi.spreadsheets.values.append({
              spreadsheetId: SPREADSHEET_ID,
              range: "Customers!A:H",
              valueInputOption: "USER_ENTERED",
              requestBody: {
                values: [[
                  newId,
                  customer.name || "",
                  customer.phone,
                  date,
                  date,
                  finalTotal,
                  1,
                  pointsEarned,
                ]],
              },
            });
          } else {
            const existing = custRows[rowIndex];
            const currentPoints = Number(existing[7] || 0);
            const newPoints = pointsRedeemed > 0
              ? currentPoints - pointsRedeemed / redeemRate
              : currentPoints + pointsEarned;

            const sheetRow = rowIndex + 2;
            await gsapi.spreadsheets.values.update({
              spreadsheetId: SPREADSHEET_ID,
              range: `Customers!E${sheetRow}:H${sheetRow}`,
              valueInputOption: "USER_ENTERED",
              requestBody: {
                values: [[
                  date,
                  Number(existing[5] || 0) + finalTotal,
                  Number(existing[6] || 0) + 1,
                  Math.max(0, newPoints),
                ]],
              },
            });
          }
        } catch (custErr) {
          console.error("Customer upsert failed (bill still saved):", custErr);
        }
      }

      return res.status(200).json({ success: true, billNo });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to process bill" });
  }
}