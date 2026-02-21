import { google } from "googleapis";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  try {
    const items = req.body; // [{ product, shade, qty, price }]
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ message: "No items received" });

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });
    const spreadsheetId = process.env.SHEET_ID;

    // 1️⃣ Read registry for Item → Tab mapping
    const registryRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: "Registry!A:B", // Item | TabName
    });
    const registryRows = registryRes.data.values || [];
    const itemMap: Record<string, string> = {};
    registryRows.forEach(([item, tab]) => { if(item && tab) itemMap[item] = tab; });

    // 2️⃣ IST date/time for Last Updated & bill
    const offset = 5.5 * 60; // IST offset in minutes
    const now = new Date();
    const local = new Date(now.getTime() + offset * 60 * 1000);
    const date = local.toISOString().slice(0, 10);
    const time = local.toTimeString().slice(0, 8);

    // 3️⃣ Process each item
    for (const item of items) {
      const { product, shade, qty, price } = item;
      const tabName = itemMap[product];
      if (!tabName) continue; // skip if item not in registry

      // read the tab for that item
      const tabRes = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${tabName}!A:E`, // Shade / Variant | Stock Qty | Price | Last Updated | Alerts
      });
      const tabValues = tabRes.data.values || [];

      const updatedTab = tabValues.map((row) => {
        if (row[0] === shade) {
          const currentQty = Number(row[1] || 0);
          const newQty = currentQty - qty;
          row[1] = newQty.toString();      // update stock
          row[3] = date;                    // Last Updated
          if (newQty < 2) row[4] = "⚠️ low stock"; // alert
        }
        return row;
      });

      // write back updated tab
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${tabName}!A:E`,
        valueInputOption: "USER_ENTERED",
        requestBody: { values: updatedTab },
      });
    }

    // 4️⃣ Append bill to `bill` tab
    const billNo = Math.floor(Math.random() * 1000000);
    const billRows = items.map((i: any) => [
      billNo,
      i.product,
      i.shade,
      i.qty,
      i.price,
      i.qty * i.price,
      date,
      time,
    ]);

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "Bill!A:H",
      valueInputOption: "USER_ENTERED",
      requestBody: { values: billRows },
    });

    res.status(200).json({ message: "Bill saved and stock updated" });
  } catch (err: any) {
    console.error("Google Sheets error:", err.message);
    res.status(500).json({ message: "Failed to save bill", error: err.message });
  }
}