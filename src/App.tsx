import React, { useState } from "react";

export default function App() {
  const [product, setProduct] = useState("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState("");
  const [items, setItems] = useState([]);

  const addItem = () => {
    if (!product || !price) return;
    const total = qty * price;

    setItems([...items, { product, qty, price, total }]);
    setProduct("");
    setQty(1);
    setPrice("");
  };

  const grandTotal = items.reduce((sum, i) => sum + i.total, 0);

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>billing counter</h1>

      <div style={styles.card}>
        <div style={styles.row}>
          <input
            style={styles.input}
            placeholder="product name"
            value={product}
            onChange={(e) => setProduct(e.target.value)}
          />
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
              <th>item</th>
              <th>qty</th>
              <th>price</th>
              <th>total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={i}>
                <td>{item.product}</td>
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

      <div style={styles.totalBox}>
        grand total: ₹{grandTotal}
      </div>

      <button style={styles.printBtn} onClick={() => window.print()}>
        print bill
      </button>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: "900px",
    margin: "40px auto",
    fontFamily: "Arial, sans-serif",
  },
  title: {
    textAlign: "center",
    marginBottom: "20px",
  },
  card: {
    background: "#f5f5f5",
    padding: "15px",
    borderRadius: "10px",
    marginBottom: "20px",
  },
  row: {
    display: "flex",
    gap: "10px",
    flexWrap: "wrap",
  },
  input: {
    flex: 2,
    padding: "10px",
    fontSize: "16px",
  },
  smallInput: {
    flex: 1,
    padding: "10px",
    fontSize: "16px",
  },
  button: {
    padding: "10px 20px",
    fontSize: "16px",
    cursor: "pointer",
  },
  tableCard: {
    background: "#fff",
    borderRadius: "10px",
    padding: "15px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
  },
  totalBox: {
    marginTop: "20px",
    fontSize: "22px",
    fontWeight: "bold",
    textAlign: "right",
  },
  printBtn: {
    marginTop: "20px",
    padding: "12px 20px",
    fontSize: "16px",
    cursor: "pointer",
    float: "right",
  },
};