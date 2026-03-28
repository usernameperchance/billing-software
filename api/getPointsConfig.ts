import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const SPREADSHEET_ID = process.env.SHEET_ID!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });

    const response = await gsapi.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "PointsConfig!A2:C2", // single config row: EarnRate | RedeemRate | MinRedeem
    });

    const row = response.data.values?.[0];
    if (!row) return res.status(200).json({ config: null }); // dormant if empty

    return res.status(200).json({
      config: {
        earnRate: Number(row[0] || 0),   // points per amt spent
        redeemRate: Number(row[1] || 0), // rupee value per point
        minRedeem: Number(row[2] || 0),  // minimum points to redeem
      },
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to fetch points config" });
  }
}