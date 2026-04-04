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

// Get packet size from Loft Settings
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

// Get Store MOQ from Registry
async function getStoreMOQ(gsapi: any, item: string): Promise<number> {
  try {
    const res = await gsapi.spreadsheets.values.get({
      spreadsheetId: STORE_SHEET_ID,
      range: "Registry!A2:C",
    });
    const rows = res.data.values || [];
    for (const r of rows) {
      if (String(r[0] || "").trim().toLowerCase() === item.toLowerCase()) {
        return Number(r[2]) || 0;
      }
    }
  } catch {}
  return 0;
}

// Get Loft MOQ from item tab column L
async function getLoftMOQ(gsapi: any, article: string, shade: string): Promise<number> {
  try {
    const res = await gsapi.spreadsheets.values.get({
      spreadsheetId: LOFT_SHEET_ID,
      range: `'${article}'!A2:L`,
    });
    const rows = res.data.values || [];
    for (const r of rows) {
      if (String(r[0] || "").trim().toLowerCase() === shade.toLowerCase()) {
        return Number(r[11]) || 3; // Column L = index 11
      }
    }
  } catch {}
  return 3;
}

// Add to Pending Transfers
async function addPendingTransfer(
  gsapi: any,
  article: string,
  shade: string,
  item: string,
  qty: number
) {
  try {
    const res = await gsapi.spreadsheets.values.get({
      spreadsheetId: LOFT_SHEET_ID,
      range: "Pending Transfers!A2:F",
    });
    const rows = res.data.values || [];
    
    // Check if already exists
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][1] === article && rows[i][2] === shade) {
        // Update existing
        await gsapi.spreadsheets.values.update({
          spreadsheetId: LOFT_SHEET_ID,
          range: `Pending Transfers!E${i + 2}:F${i + 2}`,
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [[Math.max(Number(rows[i][4]) || 0, qty), "Pending"]],
          },
        });
        return;
      }
    }

    // Add new
    await gsapi.spreadsheets.values.append({
      spreadsheetId: LOFT_SHEET_ID,
      range: "Pending Transfers!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[new Date(), article, shade, item, qty, "Pending"]],
      },
    });
  } catch (err) {
    console.error("Failed to add pending transfer:", err);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    // GET — return latest bill number
    if (req.method === "GET") {
      const billSheet = await gsapi.spreadsheets.values.get({
        spreadsheetId: STORE_SHEET_ID,
        range: "Bill!A:A",
      });
      const allValues = billSheet.data.values?.flat().filter(v => v) || [];
      const lastBillNo = allValues.map(Number).filter(n => !isNaN(n) && n > 0).pop() || 0;
      return res.status(200).json({ billNo: lastBillNo });
    }

    // POST — save bill with cross-sheet stock logic
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
        spreadsheetId: STORE_SHEET_ID,
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
        spreadsheetId: STORE_SHEET_ID,
        range: "Bill!A:K",
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
          spreadsheetId: STORE_SHEET_ID,
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

      // ── CROSS-SHEET STOCK SUBTRACTION ──
      await Promise.all(items.map(async (i: any) => {
        const { item, shade, qty } = i;
        let remaining = qty;

        // STEP 1: Subtract from Store Stock (Sheet 1)
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

            await Promise.all([
              gsapi.spreadsheets.values.update({
                spreadsheetId: STORE_SHEET_ID,
                range: `'${item}'!B${storeRowIndex + 2}`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [[newStoreStock]] },
              }),
              gsapi.spreadsheets.values.update({
                spreadsheetId: STORE_SHEET_ID,
                range: `'${item}'!D${storeRowIndex + 2}`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [[`${date} ${time}`]] },
              }),
            ]);

            // Check if store stock fell below MOQ
            const storeMOQ = await getStoreMOQ(gsapi, item);
            if (storeMOQ > 0 && newStoreStock < storeMOQ) {
              console.log(`Store stock for ${item}/${shade} below MOQ (${newStoreStock} < ${storeMOQ})`);
              // Could trigger alert here if needed
            }
          }
        } catch (storeErr) {
          console.error(`Store stock update failed for ${item}/${shade}:`, storeErr);
        }

        // STEP 2: If remaining > 0, subtract from Loft (Sheet 2)
        if (remaining > 0) {
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
              let individuals = Number(loftRows[loftRowIndex][4]) || 0; // Col E
              let packets = Number(loftRows[loftRowIndex][5]) || 0;     // Col F
              const bhiwandi = Number(loftRows[loftRowIndex][9]) || 0;  // Col J
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

              // Update loft stock
              await gsapi.spreadsheets.values.update({
                spreadsheetId: LOFT_SHEET_ID,
                range: `'${item}'!E${loftRowIndex + 2}:F${loftRowIndex + 2}`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [[individuals, packets]] },
              });

              // Check if loft packets fell below MOQ
              const loftMOQ = await getLoftMOQ(gsapi, item, shade);
              if (packets < loftMOQ) {
                const shortage = loftMOQ - packets;
                const transferable = Math.min(shortage, bhiwandi);
                if (transferable > 0) {
                  await addPendingTransfer(gsapi, item, shade, shade, transferable);
                  console.log(`Added ${transferable} packets to Pending Transfers for ${item}/${shade}`);
                }
              }
            }
          } catch (loftErr) {
            console.error(`Loft stock update failed for ${item}/${shade}:`, loftErr);
          }
        }
      }));

      // ── Customer upsert ──
      if (customer?.phone) {
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
            const newId = generateCustomerId(custRows);
            await gsapi.spreadsheets.values.append({
              spreadsheetId: STORE_SHEET_ID,
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