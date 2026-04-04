// api/bill.ts
import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const STORE_SHEET_ID = process.env.SHEET_ID!;
const LOFT_SHEET_ID = process.env.LOFT_SHEET_ID!;

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

async function getPacketSize(gsapi: any, article: string): Promise<number> {
  try {
    const res = await gsapi.spreadsheets.values.get({
      spreadsheetId: LOFT_SHEET_ID,
      range: "Settings!A2:B",
    });
    const rows = res.data.values || [];
    const art = String(article).toLowerCase();
    for (const r of rows) {
      const keyword = String(r[0] || "").toLowerCase();
      if (keyword && art.includes(keyword)) return Number(r[1]) || 5;
    }
  } catch {}
  return 5;
}

async function ensureBillSheetColumns(gsapi: any) {
  // Ensure Bill sheet has at least 11 columns and a header for Customer ID
  const sheetMeta = await gsapi.spreadsheets.get({
    spreadsheetId: STORE_SHEET_ID,
    fields: "sheets.properties(title,gridProperties,sheetId)",
  });
  const billSheet = (sheetMeta.data.sheets || []).find((s: any) => s.properties?.title === "Bill");
  const currentCols = billSheet.properties?.gridProperties?.columnCount || 0;
  if (currentCols < 11) {
    await gsapi.spreadsheets.batchUpdate({
      spreadsheetId: STORE_SHEET_ID,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: {
              sheetId: billSheet.properties?.sheetId,
              gridProperties: { columnCount: 11 }
            },
            fields: "gridProperties.columnCount"
          }
        }]
      }
    });
    // Add "Customer ID" header in K1 if not present
    const headerRow = await gsapi.spreadsheets.values.get({
      spreadsheetId: STORE_SHEET_ID,
      range: "Bill!1:1",
    });
    const headers = headerRow.data.values?.[0] || [];
    if (headers.length < 11 || headers[10] !== "Customer ID") {
      await gsapi.spreadsheets.values.update({
        spreadsheetId: STORE_SHEET_ID,
        range: "Bill!K1",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["Customer ID"]] }
      });
    }
  }
}

async function logLoftFallback(
  gsapi: any,
  billNo: number,
  item: string,
  shade: string,
  qtyFromLoft: number,
  timestamp: string
) {
  try {
    const sheetMeta = await gsapi.spreadsheets.get({
      spreadsheetId: STORE_SHEET_ID,
      fields: "sheets.properties.title",
    });
    const sheetExists = (sheetMeta.data.sheets || []).some((s: any) => s.properties?.title === "Loft Fallback Log");
    if (!sheetExists) {
      await gsapi.spreadsheets.batchUpdate({
        spreadsheetId: STORE_SHEET_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: "Loft Fallback Log" } } }],
        },
      });
      await gsapi.spreadsheets.values.update({
        spreadsheetId: STORE_SHEET_ID,
        range: "Loft Fallback Log!A1:F1",
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [["Timestamp", "Bill No", "Item", "Shade", "Qty from Loft", "Bill Date"]],
        },
      });
    }
    await gsapi.spreadsheets.values.append({
      spreadsheetId: STORE_SHEET_ID,
      range: "Loft Fallback Log!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[timestamp, billNo, item, shade, qtyFromLoft, new Date().toLocaleDateString("en-IN")]],
      },
    });
  } catch (err) {
    console.error("Failed to log loft fallback:", err);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    if (req.method === "GET") {
      const billSheet = await gsapi.spreadsheets.values.get({
        spreadsheetId: STORE_SHEET_ID,
        range: "Bill!A:A",
      });
      const allValues = billSheet.data.values?.flat().filter(v => v) || [];
      const lastBillNo = allValues.map(Number).filter(n => !isNaN(n) && n > 0).pop() || 0;
      return res.status(200).json({ billNo: lastBillNo });
    }

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

      // Enforce customer phone
      if (!customer?.phone || customer.phone.replace(/[^0-9]/g, "").length < 10) {
        return res.status(400).json({ error: "Customer phone number is required (10 digits)" });
      }

      const { date, time } = getISTDateTime();
      const timestamp = `${date} ${time}`;

      // Get next bill number
      const billSheet = await gsapi.spreadsheets.values.get({
        spreadsheetId: STORE_SHEET_ID,
        range: "Bill!A:A",
      });
      const allValues = billSheet.data.values?.flat().filter(v => v) || [];
      const lastBillNo = allValues.map(Number).filter(n => !isNaN(n) && n > 0).pop() || 0;
      const billNo = lastBillNo + 1;

      // Ensure Bill sheet has column K
      await ensureBillSheetColumns(gsapi);

      // --- Customer upsert (get or create customerId) ---
      let customerId = "";
      try {
        const custRes = await gsapi.spreadsheets.values.get({
          spreadsheetId: STORE_SHEET_ID,
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
          customerId = generateCustomerId(custRows);
          await gsapi.spreadsheets.values.append({
            spreadsheetId: STORE_SHEET_ID,
            range: "Customers!A:H",
            valueInputOption: "USER_ENTERED",
            requestBody: {
              values: [[
                customerId,
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
          customerId = custRows[rowIndex][0];
          const existing = custRows[rowIndex];
          const currentPoints = Number(existing[7] || 0);
          const newPoints = pointsRedeemed > 0
            ? currentPoints - pointsRedeemed / redeemRate
            : currentPoints + pointsEarned;

          const sheetRow = rowIndex + 2;
          await gsapi.spreadsheets.values.update({
            spreadsheetId: STORE_SHEET_ID,
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
      } catch (err) {
        console.error("Customer upsert failed:", err);
        // Fallback: use phone as temporary ID
        customerId = `TEMP-${customer.phone.replace(/[^0-9]/g, "")}`;
      }

      // --- Write bill rows with 11 columns (A:K) ---
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
        finalTotal,      // column J
        customerId,      // column K
      ]);

      await gsapi.spreadsheets.values.append({
        spreadsheetId: STORE_SHEET_ID,
        range: "Bill!A:K",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: billValues },
      });

      // --- Discount / points summary rows (also include customerId) ---
      const effectiveDiscount = pointsRedeemed > 0 ? pointsRedeemed : discountAmt;
      if (effectiveDiscount > 0) {
        const label = pointsRedeemed > 0 ? "Points Redeemed" : "Discount";
        const detail = pointsRedeemed > 0
          ? `${pointsRedeemed / redeemRate} pts`
          : `${discountPct}%`;
        await gsapi.spreadsheets.values.append({
          spreadsheetId: STORE_SHEET_ID,
          range: "Bill!A:K",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [
              [billNo, "", "", "", label, `-₹${effectiveDiscount}`, date, time, "", detail, customerId],
              [billNo, "", "", "", "Final Total", finalTotal ?? "", date, time, "", "", customerId],
            ],
          },
        });
      }

      // --- STOCK DEDUCTION (Store first, then Loft) ---
      for (const i of items) {
        const { item, shade, qty } = i;
        let remaining = qty;
        let loftUsed = 0;

        // Step 1: Subtract from Store
        try {
          const storeRes = await gsapi.spreadsheets.values.get({
            spreadsheetId: STORE_SHEET_ID,
            range: `'${item}'!A2:B`,
          });
          const storeRows = storeRes.data.values || [];
          const storeRowIndex = storeRows.findIndex(
            r => r[0]?.toString().trim().toLowerCase() === shade?.toString().trim().toLowerCase()
          );

          if (storeRowIndex !== -1) {
            const storeStock = Number(storeRows[storeRowIndex][1]) || 0;
            const usedFromStore = Math.min(remaining, storeStock);
            const newStoreStock = storeStock - usedFromStore;
            remaining -= usedFromStore;

            await gsapi.spreadsheets.values.update({
              spreadsheetId: STORE_SHEET_ID,
              range: `'${item}'!B${storeRowIndex + 2}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[newStoreStock]] },
            });
            await gsapi.spreadsheets.values.update({
              spreadsheetId: STORE_SHEET_ID,
              range: `'${item}'!D${storeRowIndex + 2}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[timestamp]] },
            });
          }
        } catch (storeErr) {
          console.error(`Store stock update failed for ${item}/${shade}:`, storeErr);
        }

        // Step 2: Loft fallback
        if (remaining > 0) {
          loftUsed = remaining;
          try {
            const loftRes = await gsapi.spreadsheets.values.get({
              spreadsheetId: LOFT_SHEET_ID,
              range: `'${item}'!A2:L`,
            });
            const loftRows = loftRes.data.values || [];
            const loftRowIndex = loftRows.findIndex(
              r => r[0]?.toString().trim().toLowerCase() === shade?.toString().trim().toLowerCase()
            );

            if (loftRowIndex !== -1) {
              let individuals = Number(loftRows[loftRowIndex][4]) || 0;
              let packets = Number(loftRows[loftRowIndex][5]) || 0;
              const packetSize = await getPacketSize(gsapi, item);

              // Use individuals first
              const usedIndiv = Math.min(remaining, individuals);
              individuals -= usedIndiv;
              remaining -= usedIndiv;

              // Open packets if needed
              if (remaining > 0 && packets > 0) {
                const packetsNeeded = Math.ceil(remaining / packetSize);
                const packetsToOpen = Math.min(packetsNeeded, packets);
                const ballsFromPackets = packetsToOpen * packetSize;
                packets -= packetsToOpen;
                individuals += ballsFromPackets - remaining;
                remaining = 0;
              }

              // Update Loft stock
              await gsapi.spreadsheets.values.update({
                spreadsheetId: LOFT_SHEET_ID,
                range: `'${item}'!E${loftRowIndex + 2}:F${loftRowIndex + 2}`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [[individuals, packets]] },
              });
            }
          } catch (loftErr) {
            console.error(`Loft stock update failed for ${item}/${shade}:`, loftErr);
          }
        }

        if (loftUsed > 0) {
          await logLoftFallback(gsapi, billNo, item, shade, loftUsed, timestamp);
        }
      }

      return res.status(200).json({ success: true, billNo, customerId });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to process bill" });
  }
}