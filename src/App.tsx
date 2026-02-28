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

type Slab = { minTotal: number; pct: number };

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
  const [nextBillNo, setNextBillNo] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [slabs, setSlabs] = useState<Slab[]>([]);

  // locked to session start, not re-render time
  const [billDate] = useState(() =>
    new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })
  );
  const [billTime] = useState(() =>
    new Date().toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
  );

  const fetchNextBillNo = () => {
    fetch("/api/bill")
      .then(res => res.json())
      .then(data => setNextBillNo((data.billNo || 0) + 1))
      .catch(() => setNextBillNo(1));
  };

  useEffect(() => { fetchNextBillNo(); }, []);

  useEffect(() => {
    fetch("/api/getItems")
      .then((res) => res.json())
      .then((data) => setAllItems(data.items || []))
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetch("/api/getDiscounts")
      .then(res => res.json())
      .then(data => setSlabs(data.slabs || []))
      .catch(() => {});
  }, []);

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
      .then(data => setCost(data.cost || 0))
      .catch(() => setCost(0));
  }, [item, shade]);

  useEffect(() => {
    if (!item || !shade || !shades.includes(shade)) return;
    fetch(`/api/getPrice?item=${encodeURIComponent(item)}&shade=${encodeURIComponent(shade)}`)
      .then((res) => res.json())
      .then((data) => {
        setPrice(data.price || 0);
        const stockQty = Number(data.qty ?? -1);
        if (stockQty >= 0 && stockQty < 2 && warnedKey !== `${item}-${shade}`) {
          window.alert("low stock for this shade. check the stock sheet for details.");
          setWarnedKey(`${item}-${shade}`);
        }
      })
      .catch(() => setPrice(0));
  }, [item, shade, warnedKey]);

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
    setQty(1);
    setPrice(0);
  };

  const grandTotal = items.reduce((sum, i) => sum + i.total, 0);
  const grandProfit = items.reduce((sum, i) => sum + i.profit, 0);

  const getApplicableSlab = (total: number) => {
    return [...slabs]
      .sort((a, b) => b.minTotal - a.minTotal)
      .find(s => total >= s.minTotal) || null;
  };

  const applicableSlab = getApplicableSlab(grandTotal);
  const discountAmt = applicableSlab ? Math.round(grandTotal * applicableSlab.pct / 100) : 0;
  const finalTotal = grandTotal - discountAmt;

  const saveBill = async () => {
    if (items.length === 0 || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, discountAmt, discountPct: applicableSlab?.pct ?? 0, finalTotal }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      fetchNextBillNo();
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
    <div className="app-container" style={styles.container}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-only { display: inline !important; }
          body, html { margin: 0 !important; padding: 0 !important; background: white !important; }
          .app-container {
            background: transparent !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            max-width: 100% !important;
          }
          #print-bill { padding: 24px !important; }
          #print-bill div { box-shadow: none !important; }
          .bill-table td, .bill-table th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      {/* ── INPUT AREA (no-print) ── */}
      <h1 className="no-print" style={styles.title}>Billing Counter</h1>
      <div className="no-print" style={styles.card}>
        <div style={styles.row}>
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
            placeholder="Qty"
            style={{ ...styles.smallInput, maxWidth: 80 }}
          />
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            onKeyDown={(e) => { if (e.key === "Enter") addItem(); }}
            placeholder="Price"
            style={{ ...styles.smallInput, maxWidth: 100 }}
          />
          <button style={styles.button} onClick={addItem}>Add</button>
        </div>
      </div>

      {/* ── BILL AREA (prints) ── */}
      <div id="print-bill" style={styles.billArea}>

        {/* Header */}
        <div style={styles.billHeader}>
          <img src="/logo.jpg" alt="Logo" style={styles.logo} />
          <div style={styles.billMeta}>
            <div style={styles.billMetaRow}>
              <span style={styles.metaLabel}>Bill No</span>
              <span style={styles.metaValue}>#{nextBillNo ?? "—"}</span>
            </div>
            <div style={styles.billMetaRow}>
              <span style={styles.metaLabel}>Date</span>
              <span style={styles.metaValue}>{billDate}</span>
            </div>
            <div style={styles.billMetaRow}>
              <span style={styles.metaLabel}>Time</span>
              <span style={styles.metaValue}>{billTime}</span>
            </div>
          </div>
        </div>

        <hr style={styles.divider} />

        {/* Table */}
        <table className="bill-table" style={styles.table}>
          <thead>
            <tr style={styles.theadRow}>
              <th style={{ ...styles.th, width: "5%", textAlign: "center" }}>#</th>
              <th style={{ ...styles.th, width: "30%" }}>Item</th>
              <th style={{ ...styles.th, width: "28%" }}>Shade / Type</th>
              <th style={{ ...styles.th, width: "10%", textAlign: "center" }}>Qty</th>
              <th style={{ ...styles.th, width: "12%", textAlign: "right" }}>Price</th>
              <th style={{ ...styles.th, width: "13%", textAlign: "right" }}>Total</th>
              <th className="no-print" style={{ ...styles.th, width: "5%" }}></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", padding: "24px 0", color: "#aaa", fontSize: 14 }}>
                  No items added yet
                </td>
              </tr>
            ) : (
              items.map((i, idx) => (
                <tr key={idx} style={idx % 2 === 0 ? styles.trEven : styles.trOdd}>
                  <td style={{ ...styles.td, textAlign: "center", color: "#999", fontSize: 13 }}>{idx + 1}</td>
                  <td style={styles.td}>{i.item}</td>
                  <td style={styles.td}>{i.shade}</td>
                  <td style={{ ...styles.td, textAlign: "center" }}>
                    <span className="no-print" style={styles.qtyControls}>
                      <button style={styles.qtyBtn} onClick={() => updateQty(idx, i.qty - 1)}>−</button>
                      <span style={styles.qtyNum}>{i.qty}</span>
                      <button style={styles.qtyBtn} onClick={() => updateQty(idx, i.qty + 1)}>+</button>
                    </span>
                    <span className="print-only" style={{ display: "none" }}>{i.qty}</span>
                  </td>
                  <td style={{ ...styles.td, textAlign: "right" }}>₹{i.price}</td>
                  <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>₹{i.total}</td>
                  <td className="no-print" style={{ ...styles.td, textAlign: "center" }}>
                    <button style={styles.removeBtn} onClick={() => removeItem(idx)}>✕</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <hr style={styles.divider} />

        {/* Totals */}
        <div style={styles.totalsBlock}>
          <div className="no-print" style={styles.profitRow}>
            <span>Net Profit</span>
            <span>₹{grandProfit}</span>
          </div>
          {applicableSlab && (
            <div style={styles.discountRow}>
              <span>Discount ({applicableSlab.pct}%)</span>
              <span>− ₹{discountAmt}</span>
            </div>
          )}
          <div style={styles.grandTotalRow}>
            <span>Grand Total</span>
            <span>₹{finalTotal}</span>
          </div>
        </div>

        <p style={styles.thankYou}>Thank you for your purchase!</p>
      </div>

      {/* ── ACTION BUTTONS ── */}
      <div className="no-print" style={styles.actions}>
        <button style={styles.printBtn} onClick={() => window.print()}>🖨 Print Bill</button>
        <button
          style={{ ...styles.printBtn, opacity: saving ? 0.6 : 1 }}
          onClick={saveBill}
          disabled={saving}
        >
          {saving ? "Saving..." : "💾 Save to Sheets"}
        </button>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    maxWidth: 860,
    margin: "36px auto",
    fontFamily: "Montserrat, Arial, sans-serif",
    background: "#f4f6f8",
    padding: 20,
    borderRadius: 14,
  },
  title: { textAlign: "center", marginBottom: 20, fontWeight: 700, fontSize: 22, letterSpacing: 0.5 },
  card: {
    background: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
    boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
  },
  row: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },
  smallInput: {
    flex: 1,
    padding: "11px 13px",
    fontSize: 14,
    borderRadius: 8,
    border: "1px solid #e0e0e0",
    outline: "none",
    background: "transparent",
    fontFamily: "inherit",
  },
  autofillWrapper: { position: "relative", flex: 1 },
  suggestion: {
    position: "absolute",
    left: 14,
    top: 11,
    color: "#bbb",
    pointerEvents: "none",
    fontSize: 14,
    fontFamily: "inherit",
    opacity: 0.7,
  },
  button: {
    padding: "11px 20px",
    fontSize: 14,
    borderRadius: 8,
    border: "none",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  // ── Bill area ──
  billArea: {
    background: "#fff",
    borderRadius: 12,
    padding: "24px 28px",
    boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
  },
  billHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },
  logo: { width: 220, maxHeight: 100, objectFit: "contain" },
  billMeta: { display: "flex", flexDirection: "column", gap: 4, alignSelf: "flex-end", textAlign: "right" },
  billMetaRow: { display: "flex", gap: 12, justifyContent: "flex-end", alignItems: "center" },
  metaLabel: { fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, minWidth: 36 },
  metaValue: { fontSize: 14, fontWeight: 600, color: "#111" },

  divider: { border: "none", borderTop: "1.5px solid #e8e8e8", margin: "14px 0" },

  // Table
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  theadRow: { background: "#111" },
  th: {
    padding: "10px 12px",
    color: "#fff",
    fontWeight: 600,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    textAlign: "left",
    border: "1px solid #333",
  },
  td: {
    padding: "10px 12px",
    color: "#222",
    fontSize: 14,
    border: "1px solid #e4e4e4",
    verticalAlign: "middle",
  },
  trEven: { background: "#fff" },
  trOdd: { background: "#fafafa" },

  qtyControls: { display: "inline-flex", alignItems: "center", gap: 6 },
  qtyBtn: {
    width: 24,
    height: 24,
    borderRadius: 4,
    border: "1px solid #ddd",
    background: "#f5f5f5",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  qtyNum: { minWidth: 20, textAlign: "center", fontWeight: 600 },
  removeBtn: {
    background: "none",
    border: "none",
    color: "#cc3333",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    padding: "2px 6px",
    borderRadius: 4,
  },

  // Totals
  totalsBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 6,
    marginTop: 6,
  },
  profitRow: {
    display: "flex",
    gap: 48,
    fontSize: 14,
    color: "#666",
  },
  discountRow: {
    display: "flex",
    gap: 48,
    fontSize: 14,
    color: "#e1c26a",
    fontWeight: 600,
  },
  grandTotalRow: {
    display: "flex",
    gap: 48,
    fontSize: 20,
    fontWeight: 700,
    color: "#111",
    borderTop: "2px solid #111",
    paddingTop: 8,
    marginTop: 4,
  },
  thankYou: {
    textAlign: "center",
    marginTop: 28,
    fontSize: 13,
    color: "#aaa",
    letterSpacing: 0.4,
  },

  // Action buttons
  actions: { display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end" },
  printBtn: {
    padding: "11px 20px",
    fontSize: 14,
    borderRadius: 8,
    border: "none",
    background: "#111",
    color: "#fff",
    cursor: "pointer",
  },
};
