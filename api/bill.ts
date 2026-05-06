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

// STEP 1: Validate stock availability WITHOUT deducting
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

  for (const entry of items) {
    if (entry.misc) {
      // Skip misc items - no stock tracking
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
      // Fetch store stock
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

      // Try to fetch loft stock
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
        // Loft sheet missing – proceed without it
        loftRowIndex = -1;
      }

      // Calculate total available stock
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

// STEP 2: Deduct stock for all items (only called if validation passed)
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
  const appliedOperations = new Map<string, any>(); // For rollback tracking

  for (const op of operations) {
    const { item, shade, storeRowIndex, storeStock, loftRowIndex, loftIndividuals, loftPackets, packetSize, qty, timestamp } = op;

    try {
      let remaining = qty;
      let usedFromStore = 0;
      let usedFromLoft = 0;

      // Deduct from store first
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

      // Deduct from loft if needed
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
        // Will log after bill is saved
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
        courierCharges = 0,
        pointsRedeemed = 0,
        customer,
        earnRate = 0,
        redeemRate = 0,
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

      // ============================================
      // STEP 1: VALIDATE ALL ITEMS HAVE SUFFICIENT STOCK (NO MODIFICATIONS)
      // ============================================
      const validations = await validateAllItemsStock(gsapi, items);
      
      // Check for any validation failures
      const failedValidation = validations.find(v => !v.isValid);
      if (failedValidation) {
        return res.status(400).json({ error: failedValidation.errorMessage });
      }

      // ============================================
      // STEP 2: ALL ITEMS VALIDATED - NOW DEDUCT STOCK
      // ============================================
      const deductionOps: StockDeductionOp[] = validations
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
        // Rollback all stock deductions
        console.error("Stock deduction failed, rolling back:", deductErr);
        for (const [key, op] of appliedOps) {
          if (key.includes("store")) {
            try {
              await restoreStoreStock(gsapi, op.item, op.storeRowIndex + 2, op.oldStoreStock);
            } catch (rollbackErr) {
              console.error(`Failed to rollback store stock for ${op.item}/${op.shade}:`, rollbackErr);
            }
          }
          if (key.includes("loft")) {
            try {
              await restoreLoftStock(gsapi, op.item, op.loftRowIndex + 2, op.oldIndividuals, op.oldPackets);
            } catch (rollbackErr) {
              console.error(`Failed to rollback loft stock for ${op.item}/${op.shade}:`, rollbackErr);
            }
          }
        }
        return res.status(500).json({ error: "Failed to deduct stock: " + ((deductErr as any).message || "Unknown error") });
      }

      // Log loft fallbacks
      for (const [key, op] of appliedOps) {
        if (key.includes("loftLog")) {
          try {
            await logLoftFallback(gsapi, billNo, op.item, op.shade, op.usedFromLoft, timestamp);
          } catch (logErr) {
            console.error(`Failed to log loft fallback for ${op.item}/${op.shade}:`, logErr);
          }
        }
      }

// Customer upsert (fixed: no new rows for existing customers)
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
    const rowPhone1 = (custRows[i][2]?.toString() || "").replace(/[^0-9]/g, "");
    const rowPhone2 = (custRows[i][3]?.toString() || "").replace(/[^0-9]/g, "");
    
    // Match either Phone 1 or Phone 2
    if (rowPhone1 === phoneRaw || rowPhone2 === phoneRaw) {
      existingIndex = i;
      break;
    }
  }

  // Always earn points on the final total, regardless of redemption
  const pointsEarned = Math.floor((finalTotal / 100) * earnRate);

  if (existingIndex === -1) {
    // New customer: append to bottom
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
          "",  // Phone 2 (empty for new customers)
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
    // Existing customer: update the same row (no append)
    customerId = custRows[existingIndex][0];
    const existing = custRows[existingIndex];
    const currentSpend = Number(existing[6]) || 0;
    const currentBills = Number(existing[7]) || 0;
    const currentPoints = Number(existing[8]) || 0;
    // Deduct redeemed points AND add newly earned points
    const pointsRedeemedAmount = pointsRedeemed > 0 ? (redeemRate > 0 ? pointsRedeemed / redeemRate : 0) : 0;
    const newPoints = currentPoints - pointsRedeemedAmount + pointsEarned;

    const updateRow = existingIndex + 1; // +1 because custRows[0] is header (row 1), so custRows[i] is row (i+1)

    // Update name if provided and different
    if (customer.name && customer.name !== existing[1]) {
      await gsapi.spreadsheets.values.update({
        spreadsheetId: STORE_SHEET_ID,
        range: `Customers!B${updateRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[customer.name]] },
      });
    }

    // Handle phone updates (Phone 1 and Phone 2)
    const existingPhone1 = (existing[2]?.toString() || "").replace(/[^0-9]/g, "");
    const existingPhone2 = (existing[3]?.toString() || "").replace(/[^0-9]/g, "");
    
    // If provided phone doesn't match Phone 1, update Phone 2
    if (phoneRaw && phoneRaw !== existingPhone1 && phoneRaw !== existingPhone2) {
      await gsapi.spreadsheets.values.update({
        spreadsheetId: STORE_SHEET_ID,
        range: `Customers!D${updateRow}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[phoneRaw]] },
      });
    }

    // Update lastVisit (F), spend (G), bills (H), points (I)
    await gsapi.spreadsheets.values.update({
      spreadsheetId: STORE_SHEET_ID,
      range: `Customers!F${updateRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[date]] },
    });

    // Update spend, bills, and points
    await gsapi.spreadsheets.values.update({
      spreadsheetId: STORE_SHEET_ID,
      range: `Customers!G${updateRow}:I${updateRow}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[
          currentSpend + finalTotal,
          currentBills + 1,
          Math.max(0, newPoints),
        ]],
      },
    });
    console.log(`Existing customer updated at row ${updateRow} (ID: ${customerId}), new spend: ${currentSpend + finalTotal}`);
  }
} catch (err) {
  console.error("Customer upsert failed:", err);
  customerId = `TEMP-${customer.phone.replace(/[^0-9]/g, "")}`;
}

      // Write bill rows (A:L) with cost field included for profit verification
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
        entry.cost,        // NEW: Cost field for inventory valuation and profit verification
        finalTotal,
        customerId,
      ]);

      await gsapi.spreadsheets.values.append({
        spreadsheetId: STORE_SHEET_ID,
        range: "Bill!A:L",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: billValues },
      });

      const effectiveDiscount = pointsRedeemed > 0 ? pointsRedeemed : discountAmt;
      if (effectiveDiscount > 0) {
        const label = pointsRedeemed > 0 ? "Points Redeemed" : "Discount";
        const valuesToAppend = [
          [billNo, label, "", "", "", "", date, time, "", "", "", customerId],
        ];
        if (courierCharges > 0) {
          valuesToAppend.push([billNo, "Courier Charges", "", "", "", "", date, time, "", courierCharges, "", customerId]);
        }
        valuesToAppend.push([billNo, "Final Total", "", "", "", "", date, time, "", "", finalTotal ?? "", customerId]);
        
        await gsapi.spreadsheets.values.append({
          spreadsheetId: STORE_SHEET_ID,
          range: "Bill!A:L",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: valuesToAppend,
          },
        });
      } else if (courierCharges > 0) {
        await gsapi.spreadsheets.values.append({
          spreadsheetId: STORE_SHEET_ID,
          range: "Bill!A:L",
          valueInputOption: "USER_ENTERED",
          requestBody: {
            values: [
              [billNo, "Courier Charges", "", "", "", "", date, time, "", courierCharges, "", customerId],
              [billNo, "Final Total", "", "", "", "", date, time, "", "", finalTotal ?? "", customerId],
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