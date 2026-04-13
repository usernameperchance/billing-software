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

function escapeSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
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
  const sheetMeta = await gsapi.spreadsheets.get({
    spreadsheetId: STORE_SHEET_ID,
    fields: "sheets.properties(title,gridProperties,sheetId)",
  });
  const billSheet = (sheetMeta.data.sheets || []).find((s: any) => s.properties?.title === "Bill");
  if (!billSheet) {
    console.error("Bill sheet not found – cannot ensure columns");
    return;
  }
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

async function restoreStoreStock(gsapi: any, item: string, rowNumber: number, stock: number) {
  await gsapi.spreadsheets.values.update({
    spreadsheetId: STORE_SHEET_ID,
    range: `${escapeSheetName(item)}!C${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[stock]] },
  });
}

async function restoreLoftStock(gsapi: any, item: string, rowNumber: number, individuals: number, packets: number) {
  await gsapi.spreadsheets.values.update({
    spreadsheetId: LOFT_SHEET_ID,
    range: `${escapeSheetName(item)}!E${rowNumber}:F${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: [[individuals, packets]] },
  });
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
        finalTotal = 0,
        pointsRedeemed = 0,
        customer,
        earnRate = 0,
        redeemRate = 0,
      } = req.body;

      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: "Invalid items" });
      }

      if (!customer?.phone || customer.phone.replace(/[^0-9]/g, "").length < 10) {
        return res.status(400).json({ error: "Customer phone number is required (10 digits)" });
      }

      const { date, time } = getISTDateTime();
      const timestamp = `${date} ${time}`;

      const billSheet = await gsapi.spreadsheets.values.get({
        spreadsheetId: STORE_SHEET_ID,
        range: "Bill!A:A",
      });
      const allValues = billSheet.data.values?.flat().filter(v => v) || [];
      const lastBillNo = allValues.map(Number).filter(n => !isNaN(n) && n > 0).pop() || 0;
      const billNo = lastBillNo + 1;

      await ensureBillSheetColumns(gsapi);

      // Process each item (stock deduction)
      for (const entry of items) {
        if (entry.misc) continue; // skip stock deduction for misc items

        const { item, shade, qty } = entry;
        let storeRowIndex = -1;
        let storeStock = 0;
        let storeApplied = false;
        let loftRowIndex = -1;
        let loftIndividuals = 0;
        let loftPackets = 0;
        let packetSize = 5;
        let loftApplied = false;
        let usedFromStore = 0;
        let usedFromLoft = 0;

        try {
          const storeRes = await gsapi.spreadsheets.values.get({
            spreadsheetId: STORE_SHEET_ID,
            range: `${escapeSheetName(item)}!B2:C`,
          });
          const storeRows = storeRes.data.values || [];
          storeRowIndex = storeRows.findIndex(
            (row: any) => row[0]?.toString().trim().toLowerCase() === shade?.toString().trim().toLowerCase()
          );
          if (storeRowIndex !== -1) {
            storeStock = Number(storeRows[storeRowIndex][1]) || 0;
          }

          try {
            const loftRes = await gsapi.spreadsheets.values.get({
              spreadsheetId: LOFT_SHEET_ID,
              range: `${escapeSheetName(item)}!A2:L`,
            });
            const loftRows = loftRes.data.values || [];
            loftRowIndex = loftRows.findIndex(
              (row: any) => row[0]?.toString().trim().toLowerCase() === shade?.toString().trim().toLowerCase()
            );
            if (loftRowIndex !== -1) {
              loftIndividuals = Number(loftRows[loftRowIndex][4]) || 0;
              loftPackets = Number(loftRows[loftRowIndex][5]) || 0;
              packetSize = await getPacketSize(gsapi, item);
            }
          } catch (loftErr) {
            // Loft sheet missing – proceed without fallback
            loftRowIndex = -1;
          }

          const storeAvailable = storeRowIndex !== -1 ? storeStock : 0;
          const loftAvailable = loftRowIndex !== -1 ? loftIndividuals + loftPackets * packetSize : 0;
          if (storeAvailable + loftAvailable < qty) {
            throw new Error(`Insufficient stock for ${item} Shade / Type: ${shade}`);
          }

          let remaining = qty;

          if (storeRowIndex !== -1) {
            usedFromStore = Math.min(remaining, storeStock);
            const newStoreStock = storeStock - usedFromStore;
            remaining -= usedFromStore;

            await gsapi.spreadsheets.values.update({
              spreadsheetId: STORE_SHEET_ID,
              range: `${escapeSheetName(item)}!C${storeRowIndex + 2}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[newStoreStock]] },
            });
            await gsapi.spreadsheets.values.update({
              spreadsheetId: STORE_SHEET_ID,
              range: `${escapeSheetName(item)}!E${storeRowIndex + 2}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[timestamp]] },
            });
            storeApplied = usedFromStore > 0;
          }

          if (remaining > 0 && loftRowIndex !== -1) {
            const usedIndiv = Math.min(remaining, loftIndividuals);
            let newIndividuals = loftIndividuals - usedIndiv;
            let newPackets = loftPackets;
            remaining -= usedIndiv;

            if (remaining > 0) {
              const packetsNeeded = Math.ceil(remaining / packetSize);
              const packetsToOpen = Math.min(packetsNeeded, loftPackets);
              const ballsFromPackets = packetsToOpen * packetSize;
              newPackets = loftPackets - packetsToOpen;
              newIndividuals += ballsFromPackets - remaining;
              remaining = 0;
            }

            usedFromLoft = qty - usedFromStore;
            await gsapi.spreadsheets.values.update({
              spreadsheetId: LOFT_SHEET_ID,
              range: `${escapeSheetName(item)}!E${loftRowIndex + 2}:F${loftRowIndex + 2}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[newIndividuals, newPackets]] },
            });
            loftApplied = usedFromLoft > 0;
          }

          if (remaining > 0) {
            throw new Error(`Insufficient stock for ${item} Shade / Type: ${shade}`);
          }

          if (usedFromLoft > 0) {
            await logLoftFallback(gsapi, billNo, item, shade, usedFromLoft, timestamp);
          }
        } catch (stockErr) {
          if (storeApplied && storeRowIndex !== -1) {
            try {
              await restoreStoreStock(gsapi, item, storeRowIndex + 2, storeStock);
            } catch (restoreErr) {
              console.error(`Failed to restore store stock for ${item}/${shade}:`, restoreErr);
            }
          }
          if (loftApplied && loftRowIndex !== -1) {
            try {
              await restoreLoftStock(gsapi, item, loftRowIndex + 2, loftIndividuals, loftPackets);
            } catch (restoreErr) {
              console.error(`Failed to restore loft stock for ${item}/${shade}:`, restoreErr);
            }
          }
          throw stockErr;
        }
      }

// Customer upsert
let customerId = "";
try {
  const custRes = await gsapi.spreadsheets.values.get({
    spreadsheetId: STORE_SHEET_ID,
    range: "Customers!A:H",
  });
  const custRows = custRes.data.values || [];
  const phoneRaw = customer.phone.toString().replace(/[^0-9]/g, "");

  let existingIndex = -1;
  for (let i = 0; i < custRows.length; i++) {
    const rowPhoneRaw = custRows[i][2]?.toString().replace(/[^0-9]/g, "") || "";
    if (rowPhoneRaw === phoneRaw) {
      existingIndex = i;
      break;
    }
  }

  const pointsEarned = pointsRedeemed > 0 ? 0 : Math.floor((finalTotal / 100) * earnRate);

  if (existingIndex === -1) {
    // New customer: append to bottom (no gaps, no blank rows)
    customerId = generateCustomerId(custRows.filter((row: any) => row[0]?.toString().startsWith("LMS-")));
    await gsapi.spreadsheets.values.append({
      spreadsheetId: STORE_SHEET_ID,
      range: "Customers!A:H",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          customerId,
          customer.name || "",
          phoneRaw,
          date,
          date,
          finalTotal,
          1,
          pointsEarned,
        ]],
      },
    });
    console.log(`New customer appended with ID ${customerId}`);
  } else {
    // Existing customer: update in place
    customerId = custRows[existingIndex][0];
    const existing = custRows[existingIndex];
    const currentSpend = Number(existing[5]) || 0;
    const currentBills = Number(existing[6]) || 0;
    const currentPoints = Number(existing[7]) || 0;
    const newPoints = pointsRedeemed > 0
      ? currentPoints - (redeemRate > 0 ? pointsRedeemed / redeemRate : 0)
      : currentPoints + pointsEarned;

    const updateRow = existingIndex + 2;

    // Update name if provided and different
    if (customer.name && customer.name !== existing[1]) {
      await gsapi.spreadsheets.values.update({
        spreadsheetId: STORE_SHEET_ID,
        range: `Customers!B${updateRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[customer.name]] },
      });
    }

    // Update phone if changed (normalized)
    if (phoneRaw !== existing[2]?.toString().replace(/[^0-9]/g, "")) {
      await gsapi.spreadsheets.values.update({
        spreadsheetId: STORE_SHEET_ID,
        range: `Customers!C${updateRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[phoneRaw]] },
      });
    }

    // Update lastVisit, spend, bills, points
    await gsapi.spreadsheets.values.update({
      spreadsheetId: STORE_SHEET_ID,
      range: `Customers!E${updateRow}:H${updateRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          date,
          currentSpend + finalTotal,
          currentBills + 1,
          Math.max(0, newPoints),
        ]],
      },
    });
    console.log(`Existing customer updated at row ${updateRow}, new spend: ${currentSpend + finalTotal}`);
  }
} catch (err) {
  console.error("Customer upsert failed:", err);
  customerId = `TEMP-${customer.phone.replace(/[^0-9]/g, "")}`;
}

      // Write bill rows (A:K)
      const billValues = items.map((entry: any) => [
        billNo,
        entry.item,
        entry.shade,
        entry.qty,
        entry.price,
        entry.total,
        date,
        time,
        entry.profit,
        finalTotal,
        customerId,
      ]);

      await gsapi.spreadsheets.values.append({
        spreadsheetId: STORE_SHEET_ID,
        range: "Bill!A:K",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: billValues },
      });

      const effectiveDiscount = pointsRedeemed > 0 ? pointsRedeemed : discountAmt;
      if (effectiveDiscount > 0) {
        const label = pointsRedeemed > 0 ? "Points Redeemed" : "Discount";
        const detail = pointsRedeemed > 0
          ? `${redeemRate > 0 ? pointsRedeemed / redeemRate : 0} pts`
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

      return res.status(200).json({ success: true, billNo, customerId });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to process bill" });
  }
}