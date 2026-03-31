// api/confirmHooksTransfer.ts
import { google } from "googleapis";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT!),
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const STORE_SHEET_ID = process.env.SHEET_ID!;
const LOFT_SHEET_ID = process.env.LOFT_SHEET_ID!;
const GODOWN_SHEET_ID = process.env.GODOWN_SHEET_ID!;

function getISTDateTime() {
  const now = new Date();
  const date = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" });
  const time = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" });
  return { date, time };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { item, transfers, shortages } = req.body;
    if (!item || !transfers) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const client = await auth.getClient();
    const gsapi = google.sheets({ version: "v4", auth: client as any });
    const { date, time } = getISTDateTime();

    // Process each shade's transfers
    for (const plan of transfers) {
      const { shade, transfers: shadeTransfers } = plan;

      // Get current stocks
      const storeRes = await gsapi.spreadsheets.values.get({
        spreadsheetId: STORE_SHEET_ID,
        range: `'${item}'!A2:B`,
      });
      const storeRows = storeRes.data.values || [];
      const storeRowIndex = storeRows.findIndex(
        r => r[0]?.toString().trim().toLowerCase() === shade.toLowerCase()
      );

      if (storeRowIndex === -1) continue;

      let hooksStock = Number(storeRows[storeRowIndex][1]) || 0;

      // Apply transfers
      for (const tr of shadeTransfers) {
        if (tr.from === "Bhiwandi") {
          // Update Hooks
          hooksStock += tr.qty;

          // Update Godown
          const godownRes = await gsapi.spreadsheets.values.get({
            spreadsheetId: GODOWN_SHEET_ID,
            range: `'${item}'!A2:C`,
          });
          const godownRows = godownRes.data.values || [];
          const godownRowIndex = godownRows.findIndex(
            r => r[0]?.toString().trim().toLowerCase() === shade.toLowerCase()
          );

          if (godownRowIndex !== -1) {
            const currentGodown = Number(godownRows[godownRowIndex][2]) || 0;
            await gsapi.spreadsheets.values.update({
              spreadsheetId: GODOWN_SHEET_ID,
              range: `'${item}'!C${godownRowIndex + 2}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[currentGodown - tr.qty]] },
            });
          }
        } else if (tr.from === "Loft") {
          // Update Hooks
          hooksStock += tr.qty;

          // Update Loft
          const loftRes = await gsapi.spreadsheets.values.get({
            spreadsheetId: LOFT_SHEET_ID,
            range: `'${item}'!A2:F`,
          });
          const loftRows = loftRes.data.values || [];
          const loftRowIndex = loftRows.findIndex(
            r => r[0]?.toString().trim().toLowerCase() === shade.toLowerCase()
          );

          if (loftRowIndex !== -1) {
            let loftIndiv = Number(loftRows[loftRowIndex][4]) || 0;
            let loftPackets = Number(loftRows[loftRowIndex][5]) || 0;

            const b = tr.breakdown;
            loftIndiv -= b.individuals;
            loftPackets -= b.packets;
            loftIndiv += b.leftover;

            await gsapi.spreadsheets.values.update({
              spreadsheetId: LOFT_SHEET_ID,
              range: `'${item}'!E${loftRowIndex + 2}:F${loftRowIndex + 2}`,
              valueInputOption: "USER_ENTERED",
              requestBody: { values: [[loftIndiv, loftPackets]] },
            });
          }
        }
      }

      // Update Store hooks stock + timestamp
      await gsapi.spreadsheets.values.update({
        spreadsheetId: STORE_SHEET_ID,
        range: `'${item}'!B${storeRowIndex + 2}:D${storeRowIndex + 2}`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: [[hooksStock, "", `${date} ${time}`]] },
      });
    }

    // Add shortages to Pending Transfers
    if (shortages && shortages.length > 0) {
      const rows = shortages.map((s: any) => [
        new Date(),
        item,
        s.shade,
        s.shade, // colour = shade for now
        s.needed,
        "Pending",
      ]);

      await gsapi.spreadsheets.values.append({
        spreadsheetId: LOFT_SHEET_ID,
        range: "Pending Transfers!A:F",
        valueInputOption: "USER_ENTERED",
        requestBody: { values: rows },
      });
    }

    return res.status(200).json({ success: true });

  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Failed to confirm transfer" });
  }
}