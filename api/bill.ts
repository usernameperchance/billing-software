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
    console.error("Bill sheet not found");
    return;
  }
  let currentCols = billSheet.properties?.gridProperties?.columnCount || 0;
  const needsHeaders: string[] = [];
  if (currentCols < 14) {
    await gsapi.spreadsheets.batchUpdate({
      spreadsheetId: STORE_SHEET_ID,
      requestBody: {
        requests: [{
          updateSheetProperties: {
            properties: {
              sheetId: billSheet.properties?.sheetId,
              gridProperties: { columnCount: 14 }
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
    if (headers.length < 14) {
      if (!headers[12]) needsHeaders.push("Last Updated");
      if (!headers[13]) needsHeaders.push("Status");
      for (let i = 0; i < needsHeaders.length; i++) {
        await gsapi.spreadsheets.values.update({
          spreadsheetId: STORE_SHEET_ID,
          range: `Bill!${String.fromCharCode(65 + 12 + i)}1`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[needsHeaders[i]]] }
        });
      }
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
          requests: [{ addSheet: { properties: { title: "Loft Fallback Log" } } }]
        }
      });
      await gsapi.spreadsheets.values.update({
        spreadsheetId: STORE_SHEET_ID,
        range: "Loft Fallback Log!A1:F1",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [["Timestamp", "Bill No", "Item", "Shade", "Qty From Loft", "Date"]] }
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

interface StockValidationResult {
  item: string;
  shade: string;
  qty: number;
  storeRowIndex: number;
  storeStock: number;
  loftRowIndex: number;
  loftIndividuals: number;
  loftPackets: number;
  packetSize: number;
  isValid: boolean;
  errorMessage?: string;
}

async function validateAllItemsStock(
  gsapi: any,
  items: any[]
): Promise<StockValidationResult[]> {
  const validations: StockValidationResult[] = [];

  for (let idx = 0; idx < items.length; idx++) {
    const entry = items[idx];
    if (entry.misc) {
      validations.push({
        item: entry.item,
        shade: entry.shade,
        qty: entry.qty,
        storeRowIndex: -1,
        storeStock: 0,
        loftRowIndex: -1,
        loftIndividuals: 0,
        loftPackets: 0,
        packetSize: 0,
        isValid: true,
      });
      continue;
    }

    const { item, shade, qty } = entry;
    let storeRowIndex = -1;
    let storeStock = 0;
    let loftRowIndex = -1;
    let loftIndividuals = 0;
    let loftPackets = 0;
    let packetSize = 5;

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
        loftRowIndex = -1;
      }

      const storeAvailable = storeRowIndex !== -1 ? storeStock : 0;
      const loftAvailable = loftRowIndex !== -1 ? loftIndividuals + loftPackets * packetSize : 0;
      const totalAvailable = storeAvailable + loftAvailable;

      if (totalAvailable < qty) {
        validations.push({
          item,
          shade,
          qty,
          storeRowIndex,
          storeStock,
          loftRowIndex,
          loftIndividuals,
          loftPackets,
          packetSize,
          isValid: false,
          errorMessage: `Insufficient stock for ${item} Shade / Type: ${shade}. Required: ${qty}, Available: ${totalAvailable}`,
        });
      } else {
        validations.push({
          item,
          shade,
          qty,
          storeRowIndex,
          storeStock,
          loftRowIndex,
          loftIndividuals,
          loftPackets,
          packetSize,
          isValid: true,
        });
      }
    } catch (err: any) {
      validations.push({
        item,
        shade,
        qty,
        storeRowIndex: -1,
        storeStock: 0,
        loftRowIndex: -1,
        loftIndividuals: 0,
        loftPackets: 0,
        packetSize: 0,
        isValid: false,
        errorMessage: `Error checking stock for ${item}: ${err.message}`,
      });
    }
  }

  return validations;
}

interface StockDeductionOp {
  item: string;
  shade: string;
  storeRowIndex: number;
  storeStock: number;
  loftRowIndex: number;
  loftIndividuals: number;
  loftPackets: number;
  packetSize: number;
  qty: number;
  timestamp: string;
}

async function deductAllItemsStock(
  gsapi: any,
  operations: StockDeductionOp[]
): Promise<Map<string, any>> {
  const appliedOperations = new Map<string, any>();

  for (const op of operations) {
    const { item, shade, storeRowIndex, storeStock, loftRowIndex, loftIndividuals, loftPackets, packetSize, qty, timestamp } = op;

    try {
      let remaining = qty;
      let usedFromStore = 0;
      let usedFromLoft = 0;

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

        appliedOperations.set(`${item}|${shade}|store`, {
          item,
          shade,
          storeRowIndex,
          oldStoreStock: storeStock,
          newStoreStock,
        });
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

        appliedOperations.set(`${item}|${shade}|loft`, {
          item,
          shade,
          loftRowIndex,
          oldIndividuals: loftIndividuals,
          oldPackets: loftPackets,
          newIndividuals,
          newPackets,
        });
      }

      if (usedFromLoft > 0) {
        appliedOperations.set(`${item}|${shade}|loftLog`, {
          item,
          shade,
          usedFromLoft,
        });
      }
    } catch (err) {
      throw new Error(`Failed to deduct stock for ${item} ${shade}: ${(err as any).message}`);
    }
  }

  return appliedOperations;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    if (req.method === "GET") {
      const action = req.query.action as string;
      
      if (action === "getBill") {
        const billNo = Number(req.query.billNo);
        if (!billNo || billNo <= 0) {
          return res.status(400).json({ error: "Invalid bill number" });
        }
        
        const billSheet = await gsapi.spreadsheets.values.get({
          spreadsheetId: STORE_SHEET_ID,
          range: "Bill!A:N",
        });
        const allRows = billSheet.data.values || [];
        // filter active rows for this bill number
        const activeRows = allRows.filter((row: any) => {
          const effectiveBillNo = Number(row[0]);
          const status = row[13]?.toString().toUpperCase();
          return effectiveBillNo === billNo && row[1] && (!status || status === "ACTIVE");
        });
        
        if (activeRows.length === 0) {
          return res.status(404).json({ error: "Bill not found" });
        }
        
        const firstRow = activeRows[0];
        const customerId = firstRow[11];
        const date = firstRow[6];
        const time = firstRow[7];
        const courierCharges = Number(firstRow[9]) || 0;
        const finalTotal = Number(firstRow[10]) || 0;
        
        let customerName = "Unknown";
        let customerPhone = "";
        if (customerId) {
          const custSheet = await gsapi.spreadsheets.values.get({
            spreadsheetId: STORE_SHEET_ID,
            range: "Customers!A:C",
          });
          const custRows = custSheet.data.values || [];
          const custRow = custRows.find((r: any) => r[0] === customerId);
          if (custRow) {
            customerName = custRow[1] || "Unknown";
            customerPhone = custRow[2] || "";
          }
        }
        
        const items = activeRows.map((row: any) => ({
          item: row[1],
          shade: row[2],
          qty: Number(row[3]) || 0,
          price: Number(row[4]) || 0,
          total: Number(row[5]) || 0,
          profit: Number(row[8]) || 0,
          cost: 0,
        }));
        
        return res.status(200).json({
          bill: {
            billNo,
            items,
            customerName,
            customerPhone,
            customerId,
            date,
            time,
            finalTotal,
            courierCharges,
          },
        });
      }
      
      const billSheet = await gsapi.spreadsheets.values.get({
        spreadsheetId: STORE_SHEET_ID,
        range: "Bill!A:A",
      });
      const allValues = billSheet.data.values?.flat().filter(v => v) || [];
      const billNumbers = allValues.map(Number).filter(n => !isNaN(n) && n > 0);
      const lastBillNo = billNumbers.length > 0 ? Math.max(...billNumbers) : 0;
      return res.status(200).json({ billNo: lastBillNo });
    }

    if (req.method === "POST") {
      const { action } = req.query;
      
      if (action === "edit") {
        const {
          originalBillNo,
          items,
          courierCharges,
          finalTotal,
          customer,
          earnRate,
          redeemRate,
          originalDate,
          originalTime,
        } = req.body;

        if (!originalBillNo || !items || !Array.isArray(items)) {
          return res.status(400).json({ error: "Invalid edit request" });
        }

        const { date, time } = getISTDateTime();
        const timestamp = `${date} ${time}`;

        const billSheet = await gsapi.spreadsheets.values.get({
          spreadsheetId: STORE_SHEET_ID,
          range: "Bill!A:N",
        });
        const allRows = billSheet.data.values || [];
        const originalRowsWithPos = allRows.reduce((acc, row, idx) => {
          const billNo = Number(row[0]);
          const status = row[13]?.toString().toUpperCase();
          if (billNo === originalBillNo && row[1] && (!status || status === "ACTIVE")) {
            acc.push({ row, rowNumber: idx + 1 });
          }
          return acc;
        }, [] as { row: any[], rowNumber: number }[]);

        if (originalRowsWithPos.length === 0) {
          return res.status(404).json({ error: "Original bill not found" });
        }

        // mark old rows as EDITED
        for (const { rowNumber } of originalRowsWithPos) {
          await gsapi.spreadsheets.values.update({
            spreadsheetId: STORE_SHEET_ID,
            range: `Bill!N${rowNumber}`,
            valueInputOption: "USER_ENTERED",
            requestBody: { values: [["EDITED"]] },
          });
        }

        // restore store stock and loft stock from old rows
        for (const { row } of originalRowsWithPos) {
          const itemName = row[1];
          const shadeName = row[2];
          const qty = Number(row[3]) || 0;
          if (!itemName || !shadeName || qty === 0) continue;

          // restore store
          const storeRes = await gsapi.spreadsheets.values.get({
            spreadsheetId: STORE_SHEET_ID,
            range: `${escapeSheetName(itemName)}!B2:C`,
          });
          const storeRows = storeRes.data.values || [];
          const storeIdx = storeRows.findIndex(r => r[0]?.toString().trim().toLowerCase() === shadeName.toLowerCase());
          if (storeIdx !== -1) {
            const currentStock = Number(storeRows[storeIdx][1]) || 0;
            await gsapi.spreadsheets.values.update({
              spreadsheetId: STORE_SHEET_ID,
              range: `${escapeSheetName(itemName)}!C${storeIdx + 2}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[currentStock + qty]] },
            });
          }

          // restore loft (individuals + packets)
          const loftRes = await gsapi.spreadsheets.values.get({
            spreadsheetId: LOFT_SHEET_ID,
            range: `${escapeSheetName(itemName)}!A2:L`,
          });
          const loftRows = loftRes.data.values || [];
          const loftIdx = loftRows.findIndex(r => r[0]?.toString().trim().toLowerCase() === shadeName.toLowerCase());
          if (loftIdx !== -1) {
            const currentIndiv = Number(loftRows[loftIdx][4]) || 0;
            const currentPackets = Number(loftRows[loftIdx][5]) || 0;
            await gsapi.spreadsheets.values.update({
              spreadsheetId: LOFT_SHEET_ID,
              range: `${escapeSheetName(itemName)}!E${loftIdx + 2}:F${loftIdx + 2}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[currentIndiv + qty, currentPackets]] },
            });
          }
        }

        // reverse customer spend/bills/points
        const firstOrig = originalRowsWithPos[0].row;
        const origCustomerId = firstOrig[11];
        if (origCustomerId) {
          const custRes = await gsapi.spreadsheets.values.get({
            spreadsheetId: STORE_SHEET_ID,
            range: "Customers!A:I",
          });
          const custRows = custRes.data.values || [];
          const custIdx = custRows.findIndex(r => r[0] === origCustomerId);
          if (custIdx !== -1) {
            const existing = custRows[custIdx];
            const oldSpend = Number(existing[6]) || 0;
            const oldBills = Number(existing[7]) || 0;
            const oldPoints = Number(existing[8]) || 0;
            const origFinalTotal = Number(firstOrig[10]) || 0;
            await gsapi.spreadsheets.values.update({
              spreadsheetId: STORE_SHEET_ID,
              range: `Customers!G${custIdx + 2}:I${custIdx + 2}`,
              valueInputOption: "USER_ENTERED",
              requestBody: {
                values: [[oldSpend - origFinalTotal, oldBills - 1, oldPoints]],
              },
            });
          }
        }

        // validate new items
        const validations = await validateAllItemsStock(gsapi, items);
        const failed = validations.find(v => !v.isValid);
        if (failed) {
          return res.status(400).json({ error: failed.errorMessage });
        }

        // deduct new stock
        const ops = validations
          .filter(v => !items.find(i => i.item === v.item && i.shade === v.shade)?.misc)
          .map(v => ({
            item: v.item,
            shade: v.shade,
            storeRowIndex: v.storeRowIndex,
            storeStock: v.storeStock,
            loftRowIndex: v.loftRowIndex,
            loftIndividuals: v.loftIndividuals,
            loftPackets: v.loftPackets,
            packetSize: v.packetSize,
            qty: v.qty,
            timestamp,
          }));
        await deductAllItemsStock(gsapi, ops);

        // customer upsert
        let newCustomerId = "";
        try {
          const custRes = await gsapi.spreadsheets.values.get({
            spreadsheetId: STORE_SHEET_ID,
            range: "Customers!A:I",
          });
          const custRows = custRes.data.values || [];
          const phoneRaw = customer.phone.toString().replace(/[^0-9]/g, "");

          let existingIdx = -1;
          for (let i = 0; i < custRows.length; i++) {
            const p1 = (custRows[i][2]?.toString() || "").replace(/[^0-9]/g, "");
            const p2 = (custRows[i][3]?.toString() || "").replace(/[^0-9]/g, "");
            if (p1 === phoneRaw || p2 === phoneRaw) {
              existingIdx = i;
              break;
            }
          }

          const pointsEarned = Math.floor((finalTotal / 100) * earnRate);

          if (existingIdx === -1) {
            newCustomerId = generateCustomerId(custRows.filter((row: any) => row[0]?.toString().startsWith("LMS-")));
            await gsapi.spreadsheets.values.append({
              spreadsheetId: STORE_SHEET_ID,
              range: "Customers!A:I",
              valueInputOption: "USER_ENTERED",
              requestBody: {
                values: [[
                  newCustomerId,
                  customer.name || "",
                  phoneRaw,
                  "",
                  originalDate,
                  originalDate,
                  finalTotal,
                  1,
                  pointsEarned,
                ]],
              },
            });
          } else {
            newCustomerId = custRows[existingIdx][0];
            const existing = custRows[existingIdx];
            const currentSpend = Number(existing[6]) || 0;
            const currentBills = Number(existing[7]) || 0;
            const currentPoints = Number(existing[8]) || 0;
            const newPoints = currentPoints + pointsEarned;
            const updateRow = existingIdx + 2;
            if (customer.name && customer.name !== existing[1]) {
              await gsapi.spreadsheets.values.update({
                spreadsheetId: STORE_SHEET_ID,
                range: `Customers!B${updateRow}`,
                valueInputOption: "USER_ENTERED",
                requestBody: { values: [[customer.name]] },
              });
            }
            await gsapi.spreadsheets.values.update({
              spreadsheetId: STORE_SHEET_ID,
              range: `Customers!F${updateRow}:I${updateRow}`,
              valueInputOption: "USER_ENTERED",
              requestBody: {
                values: [[originalDate, currentSpend + finalTotal, currentBills + 1, newPoints]],
              },
            });
          }
        } catch (err) {
          console.error("Customer upsert failed in edit:", err);
          newCustomerId = `TEMP-${customer.phone.replace(/[^0-9]/g, "")}`;
        }

        await ensureBillSheetColumns(gsapi);

        const newBillValues = items.map((entry: any) => [
          originalBillNo,
          entry.item,
          entry.shade,
          entry.qty,
          entry.price,
          entry.total,
          originalDate,
          originalTime,
          entry.profit,
          courierCharges,
          finalTotal,
          newCustomerId,
          timestamp,
          "ACTIVE",
        ]);

        await gsapi.spreadsheets.values.append({
          spreadsheetId: STORE_SHEET_ID,
          range: "Bill!A:N",
          valueInputOption: "USER_ENTERED",
          requestBody: { values: newBillValues },
        });

        return res.status(200).json({ success: true, billNo: originalBillNo });
      }

      // normal POST new bill
      const {
        items,
        finalTotal = 0,
        courierCharges = 0,
        customer,
        earnRate = 0,
      } = req.body;

      if (!items || !Array.isArray(items)) {
        return res.status(400).json({ error: "Invalid items" });
      }

      if (items.length === 0) {
        return res.status(400).json({ error: "Bill must contain at least one item" });
      }

      if (!customer?.phone || customer.phone.replace(/[^0-9]/g, "").length < 10) {
        return res.status(400).json({ error: "Customer phone number is required (10 digits)" });
      }

      // courier validation
      const isCourier = customer.type === "courier" || (customer.courier === true);
      if (isCourier && courierCharges <= 0) {
        return res.status(400).json({ error: "Courier charges must be greater than 0 for courier orders" });
      }

      const { date, time } = getISTDateTime();
      const timestamp = `${date} ${time}`;

      const billSheet = await gsapi.spreadsheets.values.get({
        spreadsheetId: STORE_SHEET_ID,
        range: "Bill!A:A",
      });
      const allValues = billSheet.data.values?.flat().filter(v => v) || [];
      const billNumbers = allValues.map(Number).filter(n => !isNaN(n) && n > 0);
      const lastBillNo = billNumbers.length > 0 ? Math.max(...billNumbers) : 0;
      const billNo = lastBillNo + 1;

      await ensureBillSheetColumns(gsapi);

      const validations = await validateAllItemsStock(gsapi, items);
      const failedValidation = validations.find(v => !v.isValid);
      if (failedValidation) {
        return res.status(400).json({ error: failedValidation.errorMessage });
      }

      const deductionOps = validations
        .filter(v => !items[items.findIndex(i => i.item === v.item && i.shade === v.shade)]?.misc)
        .map(v => ({
          item: v.item,
          shade: v.shade,
          storeRowIndex: v.storeRowIndex,
          storeStock: v.storeStock,
          loftRowIndex: v.loftRowIndex,
          loftIndividuals: v.loftIndividuals,
          loftPackets: v.loftPackets,
          packetSize: v.packetSize,
          qty: v.qty,
          timestamp,
        }));

      let appliedOps: Map<string, any> = new Map();
      try {
        appliedOps = await deductAllItemsStock(gsapi, deductionOps);
      } catch (deductErr) {
        console.error("Stock deduction failed, rolling back:", deductErr);
        for (const [key, op] of appliedOps) {
          if (key.includes("store")) {
            await restoreStoreStock(gsapi, op.item, op.storeRowIndex + 2, op.oldStoreStock).catch(console.error);
          }
          if (key.includes("loft")) {
            await restoreLoftStock(gsapi, op.item, op.loftRowIndex + 2, op.oldIndividuals, op.oldPackets).catch(console.error);
          }
        }
        return res.status(500).json({ error: "Failed to deduct stock: " + ((deductErr as any).message || "Unknown error") });
      }

      for (const [key, op] of appliedOps) {
        if (key.includes("loftLog")) {
          await logLoftFallback(gsapi, billNo, op.item, op.shade, op.usedFromLoft, timestamp).catch(console.error);
        }
      }

      // customer upsert
      let customerId = "";
      try {
        const custRes = await gsapi.spreadsheets.values.get({
          spreadsheetId: STORE_SHEET_ID,
          range: "Customers!A:I",
        });
        const custRows = custRes.data.values || [];
        const phoneRaw = customer.phone.toString().replace(/[^0-9]/g, "");

        let existingIndex = -1;
        for (let i = 0; i < custRows.length; i++) {
          const p1 = (custRows[i][2]?.toString() || "").replace(/[^0-9]/g, "");
          const p2 = (custRows[i][3]?.toString() || "").replace(/[^0-9]/g, "");
          if (p1 === phoneRaw || p2 === phoneRaw) {
            existingIndex = i;
            break;
          }
        }

        const pointsEarned = Math.floor((finalTotal / 100) * earnRate);

        if (existingIndex === -1) {
          customerId = generateCustomerId(custRows.filter((row: any) => row[0]?.toString().startsWith("LMS-")));
          await gsapi.spreadsheets.values.append({
            spreadsheetId: STORE_SHEET_ID,
            range: "Customers!A:I",
            valueInputOption: "USER_ENTERED",
            requestBody: {
              values: [[
                customerId,
                customer.name || "",
                phoneRaw,
                "",
                date,
                date,
                finalTotal,
                1,
                pointsEarned,
              ]],
            },
          });
        } else {
          customerId = custRows[existingIndex][0];
          const existing = custRows[existingIndex];
          const currentSpend = Number(existing[6]) || 0;
          const currentBills = Number(existing[7]) || 0;
          const currentPoints = Number(existing[8]) || 0;
          const newPoints = currentPoints + pointsEarned;
          const updateRow = existingIndex + 2;
          if (customer.name && customer.name !== existing[1]) {
            await gsapi.spreadsheets.values.update({
              spreadsheetId: STORE_SHEET_ID,
              range: `Customers!B${updateRow}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[customer.name]] },
            });
          }
          await gsapi.spreadsheets.values.update({
            spreadsheetId: STORE_SHEET_ID,
            range: `Customers!F${updateRow}:I${updateRow}`,
            valueInputOption: "USER_ENTERED",
            requestBody: {
              values: [[date, currentSpend + finalTotal, currentBills + 1, newPoints]],
            },
          });
        }
      } catch (err) {
        console.error("Customer upsert failed:", err);
        customerId = `TEMP-${customer.phone.replace(/[^0-9]/g, "")}`;
      }

      // calculate backend derived profit for each item
      const profitSheet = await gsapi.spreadsheets.values.get({
        spreadsheetId: STORE_SHEET_ID,
        range: "Profit!A2:C",
      });
      const profitRows = profitSheet.data.values || [];
      const costMap = new Map<string, number>();
      for (const row of profitRows) {
        const profitItem = row[0]?.toString().trim().toLowerCase();
        const profitShade = row[1]?.toString().trim().toLowerCase();
        const cost = Number(row[2]) || 0;
        if (profitItem) {
          const key = `${profitItem}|${profitShade || ""}`;
          costMap.set(key, cost);
        }
      }

      const enhancedItems = items.map((entry: any) => {
        const itemKey = `${entry.item.toLowerCase()}|${entry.shade?.toLowerCase() || ""}`;
        let costPrice = costMap.get(itemKey) || 0;
        if (costPrice === 0) {
          const fallbackKey = `${entry.item.toLowerCase()}|`;
          costPrice = costMap.get(fallbackKey) || 0;
        }
        const qtyNum = Number(entry.qty) || 0;
        const priceNum = Number(entry.price) || 0;
        const total = qtyNum * priceNum;
        const profit = total - (costPrice * qtyNum);
        return {
          ...entry,
          total,
          profit,
          cost: costPrice,
        };
      });

      const billValues = enhancedItems.map((entry: any) => [
        billNo,
        entry.item,
        entry.shade,
        entry.qty,
        entry.price,
        entry.total,
        date,
        time,
        entry.profit,
        courierCharges,
        finalTotal,
        customerId,
        timestamp,
        "ACTIVE",
      ]);

      await gsapi.spreadsheets.values.append({
        spreadsheetId: STORE_SHEET_ID,
        range: "Bill!A:N",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: billValues },
      });

      return res.status(200).json({ success: true, billNo, customerId });
    }

    res.status(405).json({ error: "Method not allowed" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to process bill" });
  }
}