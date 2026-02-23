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
  const [lockedItem, setLockedItem] = useState<string | null>(null);
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

    setShade("");
    setPrice(0);

    fetch(`/api/getShades?item=${encodeURIComponent(item)}`)
      .then((res) => res.json())
      .then((data) => setShades(data.shades || []))
      .catch(console.error);
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

    if (lockedItem && item !== lockedItem) {
      alert("finish billing this item first");
      return;
    }

    const total = qty * price;
    setItems([...items, { item, shade, qty, price, total }]);

    if (!lockedItem) setLockedItem(item);

    setShade("");
    setQty(1);
    setPrice(0);
  };

  const grandTotal = items.reduce((sum, i) => sum + i.total, 0);

  const saveBill = async () => {
    if (items.length === 0) return;

    const now = new Date();
    const date = now.toLocaleDateString("en-IN");
    const time = now.toLocaleTimeString("en-IN");

    try {
      const billNo = Math.floor(Math.random() * 100000);
      await fetch("/api/bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billNo, items, date, time }),
      });
      alert("Bill saved ✅");
      setItems([]);
      setLockedItem(null);
      setItem("");
    } catch (err) {
      console.error(err);
      alert("Failed to save bills");
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Billing Counter</h1>

      <div style={styles.card}>
        <div style={styles.row}>
          {/* AUTOFILL INPUT */}
          <input
            list="items-list"
            value={item}
            disabled={!!lockedItem}
            onChange={(e) => setItem(e.target.value)}
            placeholder="type item..."
            style={styles.smallInput}
          />
          <datalist id="items-list">
            {allItems.map((i) => (
              <option key={i} value={i} />
            ))}
          </datalist>

          <select value={shade} onChange={(e) => setShade(e.target.value)} style={styles.smallInput}>
            <option value="">Select shade/type</option>
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

      <div id="bill-area">
        <div style={styles.tableCard}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Shade/Type</th>
                <th>Quantity</th>
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
      </div>

      <button style={styles.printBtn} onClick={() => window.print()}>Print Bill</button>
      <button style={styles.printBtn} onClick={saveBill}>Save to Sheets</button>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    maxWidth: 900,
    margin: "40px auto",
    fontFamily: "Montserrat, Arial, sans-serif",
    background: "#f4f6f8",
    padding: 20,
    borderRadius: 14,
  },
  title: {
    textAlign: "center",
    marginBottom: 25,
    fontWeight: 600,
    letterSpacing: 0.5,
  },
  card: {
    background: "#ffffff",
    padding: 18,
    borderRadius: 12,
    marginBottom: 25,
    boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
  },
  row: {
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
  },
  smallInput: {
    flex: 1,
    padding: "12px 14px",
    fontSize: 15,
    borderRadius: 8,
    border: "1px solid #e0e0e0",
    outline: "none",
  },
  button: {
    padding: "12px 22px",
    fontSize: 15,
    borderRadius: 8,
    border: "none",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
  },
  tableCard: {
    background: "#ffffff",
    borderRadius: 12,
    padding: 20,
    boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 15,
  },
  totalBox: {
    marginTop: 25,
    fontSize: 22,
    fontWeight: 600,
    textAlign: "right",
  },
  printBtn: {
    marginTop: 20,
    marginLeft: 10,
    padding: "12px 22px",
    fontSize: 15,
    borderRadius: 8,
    border: "none",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
  },
};