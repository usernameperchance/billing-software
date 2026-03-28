import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = process.env.SHEET_ID!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ error: "Missing phone" });

    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    const response = await gsapi.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "Customers!A2:H",
    });

    const rows = response.data.values || [];
    // columns: A=CustomerID, B=Name, C=Phone, D=FirstVisit, E=LastVisit, F=TotalSpend, G=TotalBills, H=Points
    const row = rows.find(r => r[2]?.toString().trim() === phone.toString().trim());

    if (!row) return res.status(200).json({ customer: null });

    return res.status(200).json({
      customer: {
        customerId: row[0] || "",
        name: row[1] || "",
        phone: row[2] || "",
        firstVisit: row[3] || "",
        lastVisit: row[4] || "",
        totalSpend: Number(row[5] || 0),
        totalBills: Number(row[6] || 0),
        points: Number(row[7] || 0),
      },
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to fetch customer" });
  }
}