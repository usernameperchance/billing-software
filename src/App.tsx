import { useState, useEffect } from "react";

type BillItem = {
  item: string;
  shade: string;
  qty: number;
  price: number;
  total: number;
};

export default function App() {
  const [items, setItems] = useState<BillItem[]>([]);
  const [allItems, setAllItems] = useState<string[]>([]);
  const [shades, setShades] = useState<string[]>([]);

  const [item, setItem] = useState("");
  const [shade, setShade] = useState("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);

  // fetch all items on mount
  useEffect(() => {
    fetch("/api/getItems")
      .then((res) => res.json())
      .then((data) => setAllItems(data.items || []))
      .catch(console.error);
  }, []);

  // fetch shades when item changes
  useEffect(() => {
    if (!item) {
      setShades([]);
      setShade("");
      setPrice(0);
      return;
    }

    fetch(`/api/getShades?item=${encodeURIComponent(item)}`)
      .then((res) => res.json())
      .then((data) => setShades(data.shades || []))
      .catch(console.error);

    setShade(""); // reset shade
    setPrice(0);  // reset price
  }, [item]);

  // fetch price when both item and shade are selected
  useEffect(() => {
    if (!item || !shade) return;

    fetch(`/api/getPrice?item=${encodeURIComponent(item)}&shade=${encodeURIComponent(shade)}`)
      .then((res) => res.json())
      .then((data) => setPrice(data.price || 0))
      .catch(() => setPrice(0));
  }, [item, shade]);

  const addItem = () => {
    if (!item || !shade || !price) return;

    const total = qty * price;
    setItems([...items, { item, shade, qty, price, total }]);
    setItem("");
    setShade("");
    setQty(1);
    setPrice(0);
    setShades([]);
  };

  const grandTotal = items.reduce((sum, i) => sum + i.total, 0);

  const saveBill = async () => {
    if (items.length === 0) return;

    // IST date/time
    const offset = 5.5 * 60; // IST
    const now = new Date();
    const local = new Date(now.getTime() + offset * 60 * 1000);
    const date = local.toISOString().split("T")[0];
    const time = local.toTimeString().split(" ")[0];

    try {
      await fetch("/api/bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, date, time }),
      });
      alert("Bill saved ✅");
      setItems([]);
    } catch (err) {
      console.error(err);
      alert("Failed to save bill 💀");
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Billing Counter</h1>

      <div style={styles.card}>
        <div style={styles.row}>
          <select value={item} onChange={(e) => setItem(e.target.value)} style={styles.smallInput}>
            <option value="">Select item</option>
            {allItems.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>

          <select value={shade} onChange={(e) => setShade(e.target.value)} style={styles.smallInput}>
            <option value="">Select shade</option>
            {shades.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          <input
            type="number"
            min="1"
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            placeholder="qty"
            style={styles.smallInput}
          />
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            placeholder="price"
            style={styles.smallInput}
          />
          <button style={styles.button} onClick={addItem}>Add</button>
        </div>
      </div>

      <div style={styles.tableCard}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th>Item</th>
              <th>Shade</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i, idx) => (
              <tr key={idx}>
                <td>{i.item}</td>
                <td>{i.shade}</td>
                <td>{i.qty}</td>
                <td>₹{i.price}</td>
                <td>₹{i.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <p style={{ textAlign: "center", marginTop: 20 }}>No items added yet</p>}
      </div>

      <div style={styles.totalBox}>Grand total: ₹{grandTotal}</div>

      <button style={styles.printBtn} onClick={() => window.print()}>Print Bill</button>
      <button style={styles.printBtn} onClick={saveBill}>Save to Sheets</button>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: { maxWidth: 900, margin: "40px auto", fontFamily: "Arial, sans-serif" },
  title: { textAlign: "center", marginBottom: 20 },
  card: { background: "#f5f5f5", padding: 15, borderRadius: 10, marginBottom: 20 },
  row: { display: "flex", gap: 10, flexWrap: "wrap" },
  smallInput: { flex: 1, padding: 10, fontSize: 16 },
  button: { padding: "10px 20px", fontSize: 16, cursor: "pointer" },
  tableCard: { background: "#fff", borderRadius: 10, padding: 15, boxShadow: "0 2px 8px rgba(0,0,0,0.05)" },
  table: { width: "100%", borderCollapse: "collapse" },
  totalBox: { marginTop: 20, fontSize: 22, fontWeight: "bold", textAlign: "right" },
  printBtn: { marginTop: 20, padding: "12px 20px", fontSize: 16, cursor: "pointer", float: "right" },
};