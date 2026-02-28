import { useState, useEffect } from "react";

type BillItem = {
  item: string;
  shade: string;
  qty: number;
  cost: number;
  price: number;
  total: number;
  profit: number;
};

export default function App() {
  const [items, setItems] = useState<BillItem[]>([]);
  const [allItems, setAllItems] = useState<string[]>([]);
  const [shades, setShades] = useState<string[]>([]);
  const [item, setItem] = useState("");
  const [shade, setShade] = useState("");
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(0);
  const [cost, setCost] = useState(0);
  const [warnedKey, setWarnedKey] = useState<string | null>(null);
  const [billMeta, setBillMeta] = useState<{ billNo: number; date: string; time: string } | null>(null);
  // 🟡 FIX: loading state to prevent double-submit
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/bill")
      .then(res => res.json())
      .then(data => setBillMeta(data))
      .catch(() => {});
  }, []);

  // fetch items
  useEffect(() => {
    fetch("/api/getItems")
      .then((res) => res.json())
      .then((data) => setAllItems(data.items || []))
      .catch(console.error);
  }, []);

  // fetch shades when item fully matches
  useEffect(() => {
    if (!item || !allItems.includes(item)) {
      setShades([]);
      setShade("");
      setPrice(0);
      return;
    }

    fetch(`/api/getShades?item=${encodeURIComponent(item)}`)
      .then((res) => res.json())
      .then((data) => setShades(data.shades || []))
      .catch(console.error);
  }, [item, allItems]);

  useEffect(() => {
    if (!item || !shade) return;

    fetch(`/api/getCost?item=${encodeURIComponent(item)}&shade=${encodeURIComponent(shade)}`)
      .then(res => res.json())
      .then(data => {
        setCost(data.cost || 0);
      })
      .catch(() => setCost(0));
  }, [item, shade]);

  // fetch price + stock
  // 🟠 FIX: added warnedKey to dependency array to avoid stale closure
  useEffect(() => {
    if (!item || !shade || !shades.includes(shade)) return;
    fetch(
      `/api/getPrice?item=${encodeURIComponent(item)}&shade=${encodeURIComponent(shade)}`
    )
      .then((res) => res.json())
      .then((data) => {
        setPrice(data.price || 0);

        const stockQty = Number(data.qty ?? -1);

        if (stockQty >= 0 && stockQty < 2 && warnedKey !== `${item}-${shade}`) {
          window.alert("low stock for this shade. check the stock sheet for details.");
          setWarnedKey(`${item}-${shade}`);
        }
      })
      .catch(() => {
        setPrice(0);
      });
  }, [item, shade, warnedKey]);

  // autofill suggestions
  const itemSuggestion =
    item && allItems.find((i) => i.toLowerCase().startsWith(item.toLowerCase()));

  const shadeSuggestion =
    shade && shades.find((s) => s.toLowerCase().startsWith(shade.toLowerCase()));

  const handleItemKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === "Tab") && itemSuggestion) {
      e.preventDefault();
      setItem(itemSuggestion);
    }
  };

  const handleShadeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === "Tab") && shadeSuggestion) {
      e.preventDefault();
      setShade(shadeSuggestion);
    }
  };

  const addItem = () => {
    if (!item || !shade || !price) return;

    const total = qty * price;
    const profit = (price - cost) * qty;
    setItems([...items, { item, shade, qty, cost, price, total, profit }]);

    setShade("");
    setQty(1); // 🟡 FIX: reset qty after adding
    setPrice(0);
  };

  const grandTotal = items.reduce((sum, i) => sum + i.total, 0);
  const grandProfit = items.reduce((sum, i) => sum + i.profit, 0);

  const saveBill = async () => {
    if (items.length === 0 || saving) return; // 🟡 FIX: guard against double-submit

    setSaving(true);
    try {
      const res = await fetch("/api/bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed");

      // 🟠 FIX: refresh billMeta from server after saving so bill number updates
      const metaRes = await fetch("/api/bill");
      const meta = await metaRes.json();
      setBillMeta(meta);

      alert("Bill saved");
      setItems([]);
      setItem("");
      setShade("");
    } catch (err) {
      console.error(err);
      alert("Failed to save bill");
    } finally {
      setSaving(false);
    }
  };

  const updateQty = (index: number, newQty: number) => {
    if (newQty < 1) return;
    const updated = [...items];
    updated[index].qty = newQty;
    updated[index].total = newQty * updated[index].price;
    updated[index].profit = (updated[index].price - updated[index].cost) * newQty;
    setItems(updated);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  return (
    // 🔴 FIX: outer container now properly wraps ALL content
    <div style={styles.container}>
      <h1 style={styles.title}>Billing Counter</h1>

      <div style={styles.card}>
        <div style={styles.row}>
          {/* ITEM AUTOFILL */}
          <div style={styles.autofillWrapper}>
            <input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              onKeyDown={handleItemKeyDown}
              placeholder="Item..."
              style={styles.smallInput}
            />
            {itemSuggestion && item !== itemSuggestion && (
              <span style={styles.suggestion}>{itemSuggestion}</span>
            )}
          </div>

          {/* SHADE AUTOFILL */}
          <div style={styles.autofillWrapper}>
            <input
              value={shade}
              onChange={(e) => setShade(e.target.value)}
              onKeyDown={handleShadeKeyDown}
              placeholder="Shade/Variant..."
              style={styles.smallInput}
            />
            {shadeSuggestion && shade !== shadeSuggestion && (
              <span style={styles.suggestion}>{shadeSuggestion}</span>
            )}
          </div>

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
            onKeyDown={(e) => {
              if (e.key === "Enter") addItem();
            }}
            placeholder="Price"
            style={styles.smallInput}
          />
          <button style={styles.button} onClick={addItem}>
            Add
          </button>
        </div>
      </div>

      {/* 🔴 FIX: className="print-area" added so CSS print rules actually apply */}
      <div id="print-bill" className="print-area">
        <img src="/logo.png" alt="Logo" style={{ width: 120, marginBottom: 10 }} />
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20 }}>
          <div>Bill No: {billMeta?.billNo || "N/A"}</div>
          <div>{billMeta ? `${billMeta.date} ${billMeta.time}` : "Date/Time: N/A"}</div>
        </div>

        <div style={styles.tableCard}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Shade/Type</th>
                <th>Quantity</th>
                <th>Price</th>
                <th>Total</th>
                <th className="no-print"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((i, idx) => (
                <tr key={idx}>
                  <td>{i.item}</td>
                  <td>{i.shade}</td>
                  <td>
                    <button className="no-print" onClick={() => updateQty(idx, i.qty - 1)}>-</button>
                    {i.qty}
                    <button className="no-print" onClick={() => updateQty(idx, i.qty + 1)}>+</button>
                  </td>
                  <td>₹{i.price}</td>
                  <td>₹{i.total}</td>
                  <td>
                    <button className="no-print" onClick={() => removeItem(idx)}>❌</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={styles.totalBox}>Grand total: ₹{grandTotal}</div>
        <div className="no-print" style={styles.totalBox}>Net profit: ₹{grandProfit}</div>
      </div>

      <button className="no-print" style={styles.printBtn} onClick={() => window.print()}>
        Print Bill
      </button>
      {/* 🟡 FIX: button disabled while saving */}
      <button
        className="no-print"
        style={{ ...styles.printBtn, opacity: saving ? 0.6 : 1 }}
        onClick={saveBill}
        disabled={saving}
      >
        {saving ? "Saving..." : "Save to Sheets"}
      </button>
    </div> // closes container
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
  title: { textAlign: "center", marginBottom: 25, fontWeight: 600 },
  card: {
    background: "#ffffff",
    padding: 18,
    borderRadius: 12,
    marginBottom: 25,
    boxShadow: "0 6px 18px rgba(0,0,0,0.06)",
  },
  row: { display: "flex", gap: 12, flexWrap: "wrap" },
  smallInput: {
    flex: 1,
    padding: "12px 14px",
    fontSize: 15,
    borderRadius: 8,
    border: "1px solid #e0e0e0",
    outline: "none",
    position: "relative",
    background: "transparent",
    fontFamily: "inherit",
  },
  autofillWrapper: {
    position: "relative",
    flex: 1,
  },
  suggestion: {
    position: "absolute",
    left: 14,
    top: 12,
    color: "#aaa",
    pointerEvents: "none",
    fontSize: "inherit",
    fontFamily: "inherit",
    lineHeight: "inherit",
    opacity: 0.5,
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
  table: { width: "100%", borderCollapse: "collapse", fontSize: 15 },
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