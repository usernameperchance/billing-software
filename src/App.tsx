import { useState, useEffect, useRef, useMemo } from "react";
import Fuse from "fuse.js";
import html2canvas from "html2canvas";

type BillItem = {
  item: string;
  shade: string;
  qty: number;
  cost: number;
  price: number;
  total: number;
  profit: number;
};

type Slab = { minTotal: number; maxTotal: number; pct: number };
type Customer = { customerId: string; name: string; phone: string; points: number; totalSpend: number; totalBills: number };
type PointsConfig = { earnRate: number; redeemRate: number; minRedeem: number };

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
  const [phone, setPhone] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [pointsConfig, setPointsConfig] = useState<PointsConfig | null>(null);
  // const [pointsToRedeem, setPointsToRedeem] = useState(0);
  const [redeemPoints, setRedeemPoints] = useState(false);
  const [fetchingCustomer, setFetchingCustomer] = useState(false);

  // dropdown state
  const [itemDropdown, setItemDropdown] = useState<string[]>([]);
  const [shadeDropdown, setShadeDropdown] = useState<string[]>([]);
  const [itemDdIdx, setItemDdIdx] = useState(-1);
  const [shadeDdIdx, setShadeDdIdx] = useState(-1);

  // selected bill row for arrow key navigation
  const [selectedRow, setSelectedRow] = useState<number | null>(null);

  // caches
  const shadeCache = useRef<Record<string, string[]>>({});
  const priceCache = useRef<Record<string, { price: number; qty: number }>>({});

  // focus refs
  const itemRef = useRef<HTMLInputElement>(null);
  const shadeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);

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

  const lookupCustomer = async (ph: string) => {
    if (ph.replace(/[^0-9]/g, "").length < 10) { setCustomer(null); return; }
    setFetchingCustomer(true);
    try {
      const res = await fetch(`/api/getCustomer?phone=${encodeURIComponent(ph.trim())}`);
      const data = await res.json();
      setCustomer(data.customer || null);
      if (data.customer?.name) setCustomerName(data.customer.name);
    } catch { setCustomer(null); }
    finally { setFetchingCustomer(false); }
  };

  useEffect(() => { fetchNextBillNo(); }, []);

  useEffect(() => {
    const cached = sessionStorage.getItem("allItems");
    if (cached) { setAllItems(JSON.parse(cached)); return; }
    fetch("/api/getItems")
      .then(res => res.json())
      .then(data => {
        setAllItems(data.items || []);
        sessionStorage.setItem("allItems", JSON.stringify(data.items || []));
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetch("/api/getDiscounts")
      .then(res => res.json())
      .then(data => setSlabs(data.slabs || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/getPointsConfig")
      .then(res => res.json())
      .then(data => setPointsConfig(data.config || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!item || !allItems.includes(item)) {
      setShades([]);
      setShade("");
      setPrice(0);
      return;
    }
    if (shadeCache.current[item]) { setShades(shadeCache.current[item]); return; }
    fetch(`/api/getShades?item=${encodeURIComponent(item)}`)
      .then(res => res.json())
      .then(data => {
        const fetched = data.shades || [];
        shadeCache.current[item] = fetched;
        setShades(fetched);
      })
      .catch(console.error);
  }, [item, allItems]);

  useEffect(() => {
    if (shades.length === 1 && shades[0].toLowerCase() === "standard") {
      setShade(shades[0]);
    }
  }, [shades]);

  useEffect(() => {
    if (!item || !shade) return;
    fetch(`/api/getCost?item=${encodeURIComponent(item)}&shade=${encodeURIComponent(shade)}`)
      .then(res => res.json())
      .then(data => setCost(data.cost || 0))
      .catch(() => setCost(0));
  }, [item, shade]);

  useEffect(() => {
    if (!item || !shade || !shades.includes(shade)) return;
    const key = `${item}__${shade}`;
    if (priceCache.current[key]) {
      setPrice(priceCache.current[key].price);
      const sq = priceCache.current[key].qty;
      if (sq >= 0 && sq < 2 && warnedKey !== `${item}-${shade}`) {
        window.alert("low stock for this shade. check the stock sheet for details.");
        setWarnedKey(`${item}-${shade}`);
      }
      return;
    }
    fetch(`/api/getPrice?item=${encodeURIComponent(item)}&shade=${encodeURIComponent(shade)}`)
      .then(res => res.json())
      .then(data => {
        const p = data.price || 0;
        const q = Number(data.qty ?? -1);
        priceCache.current[key] = { price: p, qty: q };
        setPrice(p);
        if (q >= 0 && q < 2 && warnedKey !== `${item}-${shade}`) {
          window.alert("low stock for this shade. check the stock sheet for details.");
          setWarnedKey(`${item}-${shade}`);
        }
      })
      .catch(() => setPrice(0));
  }, [item, shade, shades, warnedKey]);

  const isStandard = shades.length === 1 && shades[0].toLowerCase() === "standard";

  // Fuse instances — lenient threshold so partial/middle matches work
  const itemFuse = useMemo(() => new Fuse(allItems, {
    threshold: 0.4,
    distance: 100,
    includeScore: true,
    minMatchCharLength: 1,
  }), [allItems]);

  const shadeFuse = useMemo(() => new Fuse(shades, {
    threshold: 0.4,
    distance: 100,
    includeScore: true,
    minMatchCharLength: 1,
  }), [shades]);

  // update dropdowns on input change
  useEffect(() => {
    if (!item) { setItemDropdown([]); setItemDdIdx(-1); return; }
    if (allItems.includes(item)) { setItemDropdown([]); return; }
    const results = itemFuse.search(item).slice(0, 6).map(r => r.item);
    setItemDropdown(results);
    setItemDdIdx(-1);
  }, [item, allItems]);

  useEffect(() => {
    if (!shade || isStandard) { setShadeDropdown([]); setShadeDdIdx(-1); return; }
    if (shades.includes(shade)) { setShadeDropdown([]); return; }
    const results = shadeFuse.search(shade).slice(0, 6).map(r => r.item);
    setShadeDropdown(results);
    setShadeDdIdx(-1);
  }, [shade, shades]);

  const selectItem = (val: string) => {
    setItem(val);
    setItemDropdown([]);
    setItemDdIdx(-1);
    setTimeout(() => isStandard ? qtyRef.current?.focus() : shadeRef.current?.focus(), 50);
  };

  const selectShade = (val: string) => {
    setShade(val);
    setShadeDropdown([]);
    setShadeDdIdx(-1);
    setTimeout(() => qtyRef.current?.focus(), 50);
  };

  // global keyboard controller
  useEffect(() => {
    const fields = [itemRef, shadeRef, qtyRef, priceRef];

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName;

      // ── Arrow Right / Left — move between input fields ──
      if (e.key === "ArrowRight" && tag === "INPUT") {
        const idx = fields.findIndex(r => r.current === target);
        if (idx !== -1 && idx < fields.length - 1) {
          e.preventDefault();
          fields[idx + 1].current?.focus();
        }
        return;
      }
      if (e.key === "ArrowLeft" && tag === "INPUT") {
        const idx = fields.findIndex(r => r.current === target);
        if (idx > 0) {
          e.preventDefault();
          fields[idx - 1].current?.focus();
        }
        return;
      }

      // ── Arrow Up / Down — navigate bill table rows ──
      if (e.key === "ArrowDown" && tag !== "INPUT") {
        e.preventDefault();
        setSelectedRow(prev => (prev === null ? 0 : Math.min(prev + 1, items.length - 1)));
        return;
      }
      if (e.key === "ArrowUp" && tag !== "INPUT") {
        e.preventDefault();
        setSelectedRow(prev => (prev === null ? 0 : Math.max(prev - 1, 0)));
        return;
      }

      // ── Arrow Up / Down inside item dropdown ──
      if (e.key === "ArrowDown" && target === itemRef.current && itemDropdown.length > 0) {
        e.preventDefault();
        setItemDdIdx(prev => Math.min(prev + 1, itemDropdown.length - 1));
        return;
      }
      if (e.key === "ArrowUp" && target === itemRef.current && itemDropdown.length > 0) {
        e.preventDefault();
        setItemDdIdx(prev => Math.max(prev - 1, 0));
        return;
      }

      // ── Arrow Up / Down inside shade dropdown ──
      if (e.key === "ArrowDown" && target === shadeRef.current && shadeDropdown.length > 0) {
        e.preventDefault();
        setShadeDdIdx(prev => Math.min(prev + 1, shadeDropdown.length - 1));
        return;
      }
      if (e.key === "ArrowUp" && target === shadeRef.current && shadeDropdown.length > 0) {
        e.preventDefault();
        setShadeDdIdx(prev => Math.max(prev - 1, 0));
        return;
      }

      // ── Escape — close dropdowns / deselect row ──
      if (e.key === "Escape") {
        setItemDropdown([]);
        setShadeDropdown([]);
        setSelectedRow(null);
        return;
      }

      // ── Enter logic ──
      if (e.key !== "Enter") return;

      // item dropdown — select highlighted or first result
      if (target === itemRef.current && itemDropdown.length > 0) {
        e.preventDefault();
        selectItem(itemDropdown[itemDdIdx >= 0 ? itemDdIdx : 0]);
        return;
      }

      // shade dropdown — select highlighted or first result
      if (target === shadeRef.current && shadeDropdown.length > 0) {
        e.preventDefault();
        selectShade(shadeDropdown[shadeDdIdx >= 0 ? shadeDdIdx : 0]);
        return;
      }

      // item confirmed, move to shade or qty
      if (target === itemRef.current && item && allItems.includes(item)) {
        e.preventDefault();
        if (isStandard) qtyRef.current?.focus();
        else shadeRef.current?.focus();
        return;
      }

      // shade confirmed, move to qty
      if (target === shadeRef.current && shade && shades.includes(shade)) {
        e.preventDefault();
        qtyRef.current?.focus();
        return;
      }

      // qty → move to price
      if (target === qtyRef.current) {
        e.preventDefault();
        priceRef.current?.focus();
        return;
      }

      // price → add item
      if (target === priceRef.current && item && shade && price) {
        e.preventDefault();
        addItem();
        return;
      }

      // global fallback — add item from anywhere except buttons
      if (tag !== "BUTTON" && item && shade && price) {
        e.preventDefault();
        addItem();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [item, shade, price, qty, cost, shades, items, itemDropdown, shadeDropdown, itemDdIdx, shadeDdIdx, isStandard]);

  const addItem = () => {
    if (!item || !shade || !price) return;
    const total = qty * price;
    const profit = (price - cost) * qty;
    setItems(prev => [...prev, { item, shade, qty, cost, price, total, profit }]);
    setShade("");
    setQty(1);
    setPrice(0);
    setItemDropdown([]);
    setShadeDropdown([]);
    if (isStandard) {
      setItem("");
      setTimeout(() => itemRef.current?.focus(), 50);
    } else {
      setTimeout(() => shadeRef.current?.focus(), 50);
    }
  };

  const grandTotal = items.reduce((sum, i) => sum + i.total, 0);
  const grandProfit = items.reduce((sum, i) => sum + i.profit, 0);

  const getApplicableSlab = (total: number) =>
    slabs.find(s => total >= s.minTotal && total <= s.maxTotal) || null;

  const applicableSlab = getApplicableSlab(grandTotal);
  const slabDiscount = applicableSlab ? Math.round(grandTotal * applicableSlab.pct / 100) : 0;

  // points redemption value — only if toggled on, config exists, customer has enough points
  const pointsDiscount = (() => {
    if (!redeemPoints || !pointsConfig || !customer) return 0;
    if (customer.points < pointsConfig.minRedeem) return 0;
    return Math.floor(customer.points * pointsConfig.redeemRate);
  })();

  // points take priority — if redeeming, slab discount is skipped
  const discountAmt = pointsDiscount > 0 ? pointsDiscount : slabDiscount;
  const discountPct = pointsDiscount > 0 ? 0 : (applicableSlab?.pct ?? 0);
  const finalTotal = grandTotal - discountAmt;

  const saveBill = async () => {
    if (items.length === 0 || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/bill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items,
          discountAmt,
          discountPct,
          finalTotal,
          pointsRedeemed: pointsDiscount,
          customer: phone ? { name: customerName, phone } : null,
          earnRate: pointsConfig?.earnRate ?? 0,
          redeemRate: pointsConfig?.redeemRate ?? 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      priceCache.current = {};
      fetchNextBillNo();
      alert("Bill saved");
      setItems([]);
      setItem("");
      setShade("");
      setSelectedRow(null);
      setCustomer(null);
      setCustomerName("");
      setPhone("");
      setRedeemPoints(false);
      // setPointsToRedeem(0);
    } catch (err) {
      console.error(err);
      alert("Failed to save bill");
    } finally {
      setSaving(false);
    }
  };

  const svgToPngDataUrl = (svgUrl: string): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth || 480;
        c.height = img.naturalHeight || 240;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(img, 0, 0);
        resolve(c.toDataURL("image/png"));
      };
      img.onerror = reject;
      img.src = svgUrl;
    });
  };

  const sendWhatsApp = async () => {
    if (!phone || items.length === 0) return;
    const billEl = document.getElementById("print-bill");
    if (!billEl) return;
    try {
      const logoEl = billEl.querySelector<HTMLImageElement>("img[alt='logo']");
      const originalSrc = logoEl?.src ?? "";
      if (logoEl) {
        try {
          const pngUrl = await svgToPngDataUrl("/logo.svg");
          logoEl.src = pngUrl;
          await new Promise(r => setTimeout(r, 100));
        } catch { /* continue anyway */ }
      }
      const noPrint = billEl.querySelectorAll<HTMLElement>(".no-print");
      noPrint.forEach(el => el.style.display = "none");
      const printOnly = billEl.querySelectorAll<HTMLElement>(".print-only");
      printOnly.forEach(el => el.style.display = "inline");

      const canvas = await html2canvas(billEl, {
        scale: 2, backgroundColor: "#ffffff", useCORS: true, allowTaint: true, logging: false,
      });

      noPrint.forEach(el => el.style.display = "");
      printOnly.forEach(el => el.style.display = "none");
      if (logoEl) logoEl.src = originalSrc;

      canvas.toBlob(async (blob: Blob | null) => {
        if (!blob) return;
        try {
          await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
          const cleaned = phone.replace(/[^0-9]/g, "");
          window.open(`https://wa.me/${cleaned}`, "_blank");
          alert("Bill image copied. Paste in WhatsApp to send.");
        } catch {
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `bill-${nextBillNo ?? "draft"}.png`;
          a.click();
          URL.revokeObjectURL(url);
          const cleaned = phone.replace(/[^0-9]/g, "");
          window.open(`https://wa.me/${cleaned}`, "_blank");
        }
      }, "image/png");
    } catch (err) {
      console.error(err);
      alert("Failed to capture bill image.");
    }
  };

  const saveBillAndSend = async () => {
    await saveBill();
    if (phone) await sendWhatsApp();
  };

  const updateQty = (idx: number, newQty: number) => {
    if (newQty < 1) return;
    const updated = [...items];
    updated[idx].qty = newQty;
    updated[idx].total = newQty * updated[idx].price;
    updated[idx].profit = (updated[idx].price - updated[idx].cost) * newQty;
    setItems(updated);
  };

  const removeItem = (idx: number) => {
    setItems(items.filter((_, i) => i !== idx));
    setSelectedRow(null);
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
          #print-bill div { box-shadow: none !important; background: transparent !important; }
          .bill-table td, .bill-table th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
        .dropdown { position: absolute; top: 100%; left: 0; right: 0; background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 100; max-height: 200px; overflow-y: auto; }
        .dropdown-item { padding: 9px 14px; font-size: 14px; cursor: pointer; font-family: inherit; }
        .dropdown-item:hover, .dropdown-item.active { background: #f4f6f8; }
      `}</style>

      {/* ---- INPUT AREA ---- */}
      <h1 className="no-print" style={styles.title}>Billing Counter</h1>
      <div className="no-print" style={styles.card}>
        <div style={styles.row}>

          {/* Item input with dropdown */}
          <div style={styles.autofillWrapper}>
            <input
              ref={itemRef}
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="Item..."
              style={styles.smallInput}
              autoFocus
              autoComplete="off"
            />
            {itemDropdown.length > 0 && (
              <div className="dropdown">
                {itemDropdown.map((d, i) => (
                  <div
                    key={d}
                    className={`dropdown-item${i === itemDdIdx ? " active" : ""}`}
                    onMouseDown={() => selectItem(d)}
                  >
                    {d}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Shade input with dropdown */}
          {!isStandard && (
            <div style={styles.autofillWrapper}>
              <input
                ref={shadeRef}
                value={shade}
                onChange={(e) => setShade(e.target.value)}
                placeholder="Shade/Variant..."
                style={styles.smallInput}
                autoComplete="off"
              />
              {shadeDropdown.length > 0 && (
                <div className="dropdown">
                  {shadeDropdown.map((d, i) => (
                    <div
                      key={d}
                      className={`dropdown-item${i === shadeDdIdx ? " active" : ""}`}
                      onMouseDown={() => selectShade(d)}
                    >
                      {d}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <input
            ref={qtyRef}
            type="number"
            min="1"
            value={qty}
            onChange={(e) => setQty(Number(e.target.value))}
            placeholder="Qty"
            style={{ ...styles.smallInput, maxWidth: 80 }}
          />
          <input
            ref={priceRef}
            type="number"
            value={price}
            onChange={(e) => setPrice(Number(e.target.value))}
            placeholder="Price"
            style={{ ...styles.smallInput, maxWidth: 100 }}
          />
          <button style={styles.button} onClick={addItem}>Add</button>
        </div>
      </div>

      {/* ---- BILL AREA ---- */}
      <div id="print-bill" style={styles.billArea}>
        <div style={styles.billHeader}>
          <img src="/logo.svg" alt="logo" style={styles.logo} crossOrigin="anonymous" />
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
                <tr
                  key={idx}
                  style={{
                    ...(idx % 2 === 0 ? styles.trEven : styles.trOdd),
                    outline: selectedRow === idx ? "2px solid #111" : "none",
                    cursor: "pointer",
                  }}
                  onClick={() => setSelectedRow(idx)}
                >
                  <td style={{ ...styles.td, textAlign: "center", color: "#999", fontSize: 13 }}>{idx + 1}</td>
                  <td style={styles.td}>{i.item}</td>
                  <td style={styles.td}>{i.shade}</td>
                  <td style={{ ...styles.td, textAlign: "center" }}>
                    <span className="no-print" style={styles.qtyControls}>
                      <button style={styles.qtyBtn} onClick={(e) => { e.stopPropagation(); updateQty(idx, i.qty - 1); }}>−</button>
                      <span style={styles.qtyNum}>{i.qty}</span>
                      <button style={styles.qtyBtn} onClick={(e) => { e.stopPropagation(); updateQty(idx, i.qty + 1); }}>+</button>
                    </span>
                    <span className="print-only" style={{ display: "none" }}>{i.qty}</span>
                  </td>
                  <td style={{ ...styles.td, textAlign: "right" }}>₹{i.price}</td>
                  <td style={{ ...styles.td, textAlign: "right", fontWeight: 600 }}>₹{i.total}</td>
                  <td className="no-print" style={{ ...styles.td, textAlign: "center" }}>
                    <button style={styles.removeBtn} onClick={(e) => { e.stopPropagation(); removeItem(idx); }}>✕</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <hr style={styles.divider} />

        <div style={styles.totalsBlock}>
          <div className="no-print" style={styles.profitRow}>
            <span>Net Profit</span>
            <span>₹{grandProfit}</span>
          </div>
          {discountAmt > 0 && (
            <div style={styles.discountRow}>
              <span>
                {pointsDiscount > 0
                  ? `Points Redeemed`
                  : `Discount (${applicableSlab?.pct}%)`}
              </span>
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

      {/* ---- CUSTOMER SECTION ---- */}
      <div className="no-print" style={styles.customerCard}>
        <div style={styles.row}>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="Customer Name..."
            style={styles.smallInput}
          />
          <input
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              lookupCustomer(e.target.value);
            }}
            placeholder="Phone (10 digits)..."
            style={styles.smallInput}
          />
          {fetchingCustomer && <span style={{ fontSize: 13, color: "#888" }}>Looking up...</span>}
        </div>
        {customer && (
          <div style={styles.customerInfo}>
            <span>👤 {customer.name} — {customer.points} pts</span>
            {pointsConfig && customer.points >= pointsConfig.minRedeem && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={redeemPoints}
                  onChange={(e) => setRedeemPoints(e.target.checked)}
                />
                Redeem {customer.points} pts (₹{Math.floor(customer.points * pointsConfig.redeemRate)} off)
              </label>
            )}
            {pointsConfig && customer.points < pointsConfig.minRedeem && (
              <span style={{ fontSize: 12, color: "#aaa" }}>
                {pointsConfig.minRedeem - customer.points} more pts needed to redeem
              </span>
            )}
          </div>
        )}
        {!customer && phone.replace(/[^0-9]/g, "").length >= 10 && !fetchingCustomer && (
          <div style={{ fontSize: 13, color: "#888", marginTop: 6 }}>New customer — will be registered on save</div>
        )}
      </div>

      {/* ---- ACTION BUTTONS ---- */}
      <div className="no-print" style={styles.actions}>
        <input
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            lookupCustomer(e.target.value);
          }}
          placeholder="Phone no. for WhatsApp..."
          style={{ ...styles.smallInput, maxWidth: 220, display: "none" }}
        />
        <button
          style={{ ...styles.printBtn, background: "#25D366", opacity: (!phone || items.length === 0) ? 0.5 : 1 }}
          onClick={sendWhatsApp}
          disabled={!phone || items.length === 0}
        >
          📲 Send Bill
        </button>
        <button style={styles.printBtn} onClick={() => window.print()}>🖨 Print Bill</button>
        <button
          style={{ ...styles.printBtn, opacity: saving ? 0.6 : 1 }}
          onClick={saveBill}
          disabled={saving}
        >
          {saving ? "Saving..." : "💾 Save to Sheets"}
        </button>
        <button
          style={{ ...styles.printBtn, background: "#0a6ed1", opacity: (saving || items.length === 0) ? 0.6 : 1 }}
          onClick={saveBillAndSend}
          disabled={saving || items.length === 0}
        >
          {saving ? "Saving..." : "💾📲 Save & Send"}
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
  billArea: {
    background: "#fff",
    borderRadius: 12,
    padding: "10px 28px 24px 28px",
    boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
  },
  billHeader: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginBottom: 16,
    gap: 10,
  },
  logo: { width: 240, height: "auto", objectFit: "contain", display: "block", margin: "0 auto 8px auto" },
  billMeta: { display: "flex", flexDirection: "column", gap: 4, alignSelf: "flex-end", textAlign: "right" },
  billMetaRow: { display: "flex", gap: 12, justifyContent: "flex-end", alignItems: "center" },
  metaLabel: { fontSize: 12, color: "#888", textTransform: "uppercase", letterSpacing: 0.5, minWidth: 36 },
  metaValue: { fontSize: 14, fontWeight: 600, color: "#111" },
  divider: { border: "none", borderTop: "1.5px solid #e8e8e8", margin: "14px 0" },
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
  totalsBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 6,
    marginTop: 6,
  },
  profitRow: { display: "flex", gap: 48, fontSize: 14, color: "#666" },
  discountRow: { display: "flex", gap: 48, fontSize: 14, color: "#9f7448", fontWeight: 600 },
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
  thankYou: { textAlign: "center", marginTop: 28, fontSize: 13, color: "#aaa", letterSpacing: 0.4 },
  customerCard: {
    background: "#fff",
    padding: 16,
    borderRadius: 12,
    marginTop: 16,
    boxShadow: "0 4px 14px rgba(0,0,0,0.06)",
  },
  customerInfo: {
    display: "flex",
    alignItems: "center",
    gap: 20,
    marginTop: 10,
    fontSize: 14,
    color: "#333",
  },
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