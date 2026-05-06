// api/core.ts
import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = process.env.SHEET_ID!;
const LOFT_SHEET_ID = process.env.LOFT_SHEET_ID!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { action } = req.query;
  
  if (!action || typeof action !== "string") {
    return res.status(400).json({ error: "Missing action parameter" });
  }

  try {
    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    switch (action) {
      case "getItems":
        return await handleGetItems(gsapi, res);
      case "getShades":
        return await handleGetShades(gsapi, req, res);
      case "getPrice":
        return await handleGetPrice(gsapi, req, res);
      case "getCost":
        return await handleGetCost(gsapi, req, res);
      case "getCustomer":
        return await handleGetCustomer(gsapi, req, res);
      case "searchCustomersByName":
        return await handleSearchCustomersByName(gsapi, req, res);
      case "searchCustomersById":
        return await handleSearchCustomersById(gsapi, req, res);
      case "getDiscounts":
        return await handleGetDiscounts(gsapi, res);
      case "getPointsConfig":
        return await handleGetPointsConfig(gsapi, res);
      default:
        return res.status(400).json({ error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to process request" });
  }
}

async function handleGetItems(gsapi: any, res: VercelResponse) {
  const response = await gsapi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Registry!B2:B",
  });
  const items = response.data.values?.flatMap((v: any) => v) || [];
  return res.status(200).json({ items });
}

async function handleGetShades(gsapi: any, req: VercelRequest, res: VercelResponse) {
  const { item } = req.query;
  if (!item || typeof item !== "string") {
    return res.status(400).json({ error: "Missing item parameter" });
  }

  // Shade column is now B (after barcode in A)
  const response = await gsapi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${item.replace(/'/g, "''")}'!B2:B`,
  });
  const shades = response.data.values?.flatMap((v: any) => v) || [];
  return res.status(200).json({ shades });
}

async function handleGetPrice(gsapi: any, req: VercelRequest, res: VercelResponse) {
  const { item, shade } = req.query;
  if (!item || !shade || typeof item !== "string" || typeof shade !== "string") {
    return res.status(400).json({ error: "Missing item or shade parameter" });
  }

  const response = await gsapi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${item.replace(/'/g, "''")}'!B2:D`,
  });

  const rows = response.data.values || [];
  const target = shade.toString().trim().toLowerCase();

  let matchedRow = rows.find((r: any) =>
    r[0]?.toString().trim().toLowerCase() === target
  );
  if (!matchedRow) {
    matchedRow = rows.find((r: any) =>
      r[0]?.toString().trim().toLowerCase().startsWith(target)
    );
  }
  if (!matchedRow) {
    matchedRow = rows.find((r: any) => {
      const rowShade = r[0]?.toString().trim().toLowerCase();
      return target.startsWith(rowShade);
    });
  }
  if (!matchedRow) {
    matchedRow = rows.find((r: any) =>
      r[0]?.toString().trim().toLowerCase().includes(target) ||
      target.includes(r[0]?.toString().trim().toLowerCase())
    );
  }

  const stock = matchedRow && matchedRow[1] ? Number(matchedRow[1]) : 0;
  const price = matchedRow && matchedRow[2] ? Number(matchedRow[2]) : 0;
  return res.status(200).json({ price, qty: stock });
}

async function handleGetCost(gsapi: any, req: VercelRequest, res: VercelResponse) {
  const { item, shade } = req.query;
  if (!item || typeof item !== "string") {
    return res.status(400).json({ error: "Missing item parameter" });
  }

  const response = await gsapi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Profit!A2:C",
  });

  const rows = response.data.values || [];
  const itemStr = item.toString().trim().toLowerCase();
  const shadeStr = shade ? shade.toString().trim().toLowerCase() : "";
  
  let matchedRow = rows.find((r: any) => {
    const rowItem = r[0]?.toString().trim().toLowerCase();
    const rowShade = r[1]?.toString().trim().toLowerCase();
    return rowItem === itemStr && rowShade === shadeStr;
  });
  if (!matchedRow) {
    matchedRow = rows.find((r: any) => {
      const rowItem = r[0]?.toString().trim().toLowerCase();
      return rowItem === itemStr;
    });
  }

  const cost = matchedRow && matchedRow[2] ? Number(matchedRow[2]) : 0;
  return res.status(200).json({ cost });
}

async function handleGetCustomer(gsapi: any, req: VercelRequest, res: VercelResponse) {
  const { phone } = req.query;
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ error: "Missing phone parameter" });
  }

  const response = await gsapi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Customers!A2:H",
  });

  const rows = response.data.values || [];
  const phoneNormalized = phone.toString().replace(/[^0-9]/g, "");
  
  const matchedRow = rows.find((r: any) => {
    const rowPhone = r[2]?.toString().replace(/[^0-9]/g, "");
    return rowPhone === phoneNormalized;
  });

  if (!matchedRow) {
    return res.status(200).json({ customer: null });
  }

  return res.status(200).json({
    customer: {
      customerId: matchedRow[0] || "",
      name: matchedRow[1] || "",
      phone: matchedRow[2] || "",
      phone2: matchedRow[3] || "",
      points: Number(matchedRow[8] || 0),
      totalSpend: Number(matchedRow[6] || 0),
      totalBills: Number(matchedRow[7] || 0),
    },
  });
}

async function handleSearchCustomersByName(gsapi: any, req: VercelRequest, res: VercelResponse) {
  const { name } = req.query;
  if (!name || typeof name !== "string") {
    return res.status(400).json({ error: "Missing name parameter" });
  }

  const response = await gsapi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Customers!A2:I",
  });

  const rows = response.data.values || [];
  const searchTerm = name.toLowerCase().trim();

  const matches = rows
    .filter((r: any) => r[1]?.toString().toLowerCase().includes(searchTerm))
    .map((r: any) => ({
      customerId: r[0] || "",
      name: r[1] || "",
      phone: r[2] || "",
      phone2: r[3] || "",
      points: Number(r[8] || 0),
      totalSpend: Number(r[6] || 0),
      totalBills: Number(r[7] || 0),
    }));

  return res.status(200).json({ customers: matches });
}

async function handleSearchCustomersById(gsapi: any, req: VercelRequest, res: VercelResponse) {
  const { customerId } = req.query;
  if (!customerId || typeof customerId !== "string") {
    return res.status(400).json({ error: "Missing customerId parameter" });
  }

  const response = await gsapi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Customers!A2:I",
  });

  const rows = response.data.values || [];
  const searchId = customerId.toUpperCase().trim();

  // find exact match by Customer ID
  const matchedRow = rows.find((r: any) => r[0]?.toString().toUpperCase() === searchId);

  if (!matchedRow) {
    return res.status(200).json({ customer: null });
  }

  return res.status(200).json({
    customer: {
      customerId: matchedRow[0] || "",
      name: matchedRow[1] || "",
      phone: matchedRow[2] || "",
      phone2: matchedRow[3] || "",
      points: Number(matchedRow[8] || 0),
      totalSpend: Number(matchedRow[6] || 0),
      totalBills: Number(matchedRow[7] || 0),
    },
  });
}

async function handleGetDiscounts(gsapi: any, res: VercelResponse) {
  const response = await gsapi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "Discounts!A2:C",
  });

  const slabs = (response.data.values || [])
    .filter((row: any) => row[0] && row[2])
    .map((row: any) => ({
      minTotal: Number(row[0]),
      maxTotal: row[1] ? Number(row[1]) : Infinity,
      pct: Number(row[2]),
    }))
    .sort((a: any, b: any) => a.minTotal - b.minTotal);

  return res.status(200).json({ slabs });
}

async function handleGetPointsConfig(gsapi: any, res: VercelResponse) {
  const response = await gsapi.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: "PointsConfig!A2:C2",
  });

  const row = response.data.values?.[0];
  if (!row || !row[0]) {
    return res.status(200).json({ config: null });
  }

  return res.status(200).json({
    config: {
      earnRate: Number(row[0] || 0),
      redeemRate: Number(row[1] || 0),
      minRedeem: Number(row[2] || 0),
    },
  });
}