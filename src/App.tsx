import { useState } from "react";

type Item = {
  brand: string;
  shade: string;
  qty: number;
  price: number;
  total: number;
};

export default function App() {
  const [brand, setBrand] = useState<string>("");
  const [shade, setShade] = useState<string>("");
  const [qty, setQty] = useState<number>(1);
  const [price, setPrice] = useState<number>(0);
  const [items, setItems] = useState<Item[]>([]);

  // dummy brand/shade list for now, later fetch from registry tab
  const brands = ["Triosoft", "Cotton Comfy", "Magnus"];
  const shades = ["Blue", "Red", "Green"];

  const addItem = () => {
    if (!brand || !shade || !price) return;
    const total = qty * price;

    const newItem: Item = { brand, shade, qty, price, total };
    setItems([...items, newItem]);

    setShade("");
    setQty(1);
    setPrice(0);
  };

  const grandTotal = items.reduce((sum, i) => sum + i.total, 0);

  const saveBill = async () => {
    if (items.length === 0) return;
    try {
      await fetch("/api/bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(items),
      });
      alert("Bill saved to sheets ✅");
      setItems([]);
    } catch (err) {
      console.error(err);
      alert("Failed to save bill 💀");
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>billing counter</h1>

      <div style={styles.card}>
        <div style={styles.row}>
          <select
            style={styles.smallInput}
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          >
            <option value="">select brand</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>

          <select
            style={styles.smallInput}
            value={shade}
            onChange={(e) => setShade(e.target.value)}
          >
            <option value="">select shade</option>
            {shades.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <input
            style={styles.smallInput}
            type="number"
            min="1"
            placeholder="qty"
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
          />
          <input
            style={styles.smallInput}
            type="number"
            placeholder="price"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
          />
          <button style={styles.button} onClick={addItem}>
            add
          </button>
        </div>
      </div>

      <div style={styles.tableCard}>
        <table style={styles.table}>
          <thead>
            <tr>
              <th>brand</th>
              <th>shade</th>
              <th>qty</th>
              <th>price</th>
              <th>total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td>{item.brand}</td>
                <td>{item.shade}</td>
                <td>{item.qty}</td>
                <td>₹{item.price}</td>
                <td>₹{item.total}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {items.length === 0 && (
          <p style={{ textAlign: "center", marginTop: 20 }}>
            no items added yet
          </p>
        )}
      </div>

      <div style={styles.totalBox}>grand total: ₹{grandTotal}</div>

      <button style={styles.printBtn} onClick={() => window.print()}>
        print bill
      </button>
      <button style={styles.printBtn} onClick={saveBill}>
        save to sheets
      </button>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    maxWidth: "900px",
    margin: "40px auto",
    fontFamily: "Arial, sans-serif",
  },
  title: { textAlign: "center", marginBottom: "20px" },
  card: { background: "#f5f5f5", padding: "15px", borderRadius: "10px", marginBottom: "20px" },
  row: { display: "flex", gap: "10px", flexWrap: "wrap" },
  input: { flex: 2, padding: "10px", fontSize: "16px" },
  smallInput: { flex: 1, padding: "10px", fontSize: "16px" },
  button: { padding: "10px 20px", fontSize: "16px", cursor: "pointer" },
  tableCard: {
    background: "#fff",
    borderRadius: "10px",
    padding: "15px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
  },
  table: { width: "100%", borderCollapse: "collapse" },
  totalBox: { marginTop: "20px", fontSize: "22px", fontWeight: "bold", textAlign: "right" },
  printBtn: { marginTop: "20px", padding: "12px 20px", fontSize: "16px", cursor: "pointer", float: "right" },
};