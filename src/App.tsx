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
  misc?: boolean;
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
  const [redeemPoints, setRedeemPoints] = useState(false);
  const [fetchingCustomer, setFetchingCustomer] = useState(false);
  const [restockLoading, setRestockLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [barcode, setBarcode] = useState("");
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const shadeCache = useRef<Record<string, string[]>>({});
  const priceCache = useRef<Record<string, { price: number; qty: number }>>({});
  const itemRef = useRef<HTMLInputElement>(null);
  const shadeRef = useRef<HTMLInputElement>(null);
  const qtyRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const [editingShadeRow, setEditingShadeRow] = useState<number | null>(null);
  const [editingShadeValue, setEditingShadeValue] = useState("");
  const [editShadeSuggestion, setEditShadeSuggestion] = useState<string | null>(null);
  const [validatingShade, setValidatingShade] = useState(false);

  const startEditShade = (idx: number, currentShade: string) => {
    if (validatingShade) return;
    setEditingShadeRow(idx);
    setEditingShadeValue(currentShade);
    setEditShadeSuggestion(null);
  };

  const saveEditShade = async (idx: number) => {
    const newShade = editingShadeValue.trim();
    if (newShade === "") {
      alert("Shade cannot be empty");
      return;
    }

    const itemName = items[idx].item;
    setValidatingShade(true);

    try {
      let shades: string[] = [];
      if (shadeCache.current[itemName]) {
        shades = shadeCache.current[itemName];
      } else {
        const res = await fetch(`/api/core?action=getShades&item=${encodeURIComponent(itemName)}`);
        const data = await res.json();
        shades = data.shades || [];
        shadeCache.current[itemName] = shades;
      }

      const matchedShade = shades.find(s => s.toLowerCase() === newShade.toLowerCase());
      if (!matchedShade) {
        alert(`"${newShade}" is not a valid shade for ${itemName}. Available: ${shades.join(", ")}`);
        setEditingShadeRow(null);
        setEditingShadeValue("");
        return;
      }

      const updated = [...items];
      updated[idx].shade = matchedShade;
      setItems(updated);
      setEditingShadeRow(null);
      setEditingShadeValue("");
    } catch (err) {
      console.error("Failed to validate shade:", err);
      alert("Could not validate shade. Please try again.");
    } finally {
      setValidatingShade(false);
    }
  };

  const cancelEditShade = () => {
    if (validatingShade) return;
    setEditingShadeRow(null);
    setEditingShadeValue("");
  };

  const [billDate] = useState(() =>
    new Date().toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })
  );
  const [billTime, setBillTime] = useState(() =>
    new Date().toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
  );

  const normalizedPhone = phone.replace(/[^0-9]/g, "");
  const isPhoneValid = normalizedPhone.length === 10;
  const customerMatchesPhone = !!customer && customer.phone.replace(/[^0-9]/g, "") === normalizedPhone;

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
      const res = await fetch(`/api/core?action=getCustomer&phone=${encodeURIComponent(ph.trim())}`);
      const data = await res.json();
      setCustomer(data.customer || null);
      if (data.customer?.name) setCustomerName(data.customer.name);
    } catch { setCustomer(null); }
    finally { setFetchingCustomer(false); }
  };

  useEffect(() => { fetchNextBillNo(); }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchNextBillNo();
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      setBillTime(new Date().toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handleFocus = () => {
      fetchNextBillNo();
      setBillTime(new Date().toLocaleTimeString("en-IN", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }));
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  useEffect(() => {
    const cached = sessionStorage.getItem("allItems");
    if (cached) { setAllItems(JSON.parse(cached)); return; }
    fetch("/api/core?action=getItems")
      .then(res => res.json())
      .then(data => {
        setAllItems(data.items || []);
        sessionStorage.setItem("allItems", JSON.stringify(data.items || []));
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    fetch("/api/core?action=getDiscounts")
      .then(res => res.json())
      .then(data => setSlabs(data.slabs || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/core?action=getPointsConfig")
      .then(res => res.json())
      .then(data => setPointsConfig(data.config || null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!item) {
      setShades([]);
      setShade("");
      setPrice(0);
      setCost(0);
      return;
    }
    if (!allItems.includes(item)) {
      setShades([]);
      return;
    }
    if (shadeCache.current[item]) { setShades(shadeCache.current[item]); return; }
    fetch(`/api/core?action=getShades&item=${encodeURIComponent(item)}`)
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
    if (!allItems.includes(item)) return;
    fetch(`/api/core?action=getCost&item=${encodeURIComponent(item)}&shade=${encodeURIComponent(shade)}`)
      .then(res => res.json())
      .then(data => setCost(data.cost || 0))
      .catch(() => setCost(0));
  }, [item, shade, allItems]);

  useEffect(() => {
    if (!item || !shade) return;
    if (!allItems.includes(item) || !shades.includes(shade)) return;
    const key = `${item}__${shade}`;
    if (priceCache.current[key]) {
      setPrice(priceCache.current[key].price);
      const sq = priceCache.current[key].qty;
      if (sq >= 0 && sq < 2 && warnedKey !== `${item}-${shade}`) {
        window.alert("Low stock for this shade. Check the stock sheet for details.");
        setWarnedKey(`${item}-${shade}`);
      }
      return;
    }
    fetch(`/api/core?action=getPrice&item=${encodeURIComponent(item)}&shade=${encodeURIComponent(shade)}`)
      .then(res => res.json())
      .then(data => {
        const p = data.price || 0;
        const q = Number(data.qty ?? -1);
        priceCache.current[key] = { price: p, qty: q };
        setPrice(p);
        if (q >= 0 && q < 2 && warnedKey !== `${item}-${shade}`) {
          window.alert("Low stock for this shade. Check the stock sheet for details.");
          setWarnedKey(`${item}-${shade}`);
        }
      })
      .catch(() => setPrice(0));
  }, [item, shade, shades, warnedKey, allItems]);

  const isStandard = shades.length === 1 && shades[0].toLowerCase() === "standard";

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

  const itemSuggestion = item
    ? itemFuse.search(item)[0]?.item ?? null
    : null;

  const allShadesAreNumeric = shades.length > 0 && shades.every(s => /^\d+$/.test(s.trim()));

  let shadeSuggestion = null;
  if (shade && !allShadesAreNumeric) {
    const trimmed = shade.trim();
    const isNumeric = /^\d+$/.test(trimmed);
    if (isNumeric) {
      shadeSuggestion = shades.find(s => s.trim().toLowerCase().startsWith(trimmed.toLowerCase())) || null;
    } else {
      shadeSuggestion = shadeFuse.search(shade)[0]?.item ?? null;
    }
  }

  const selectItem = (val: string) => {
    setItem(val);
    setTimeout(() => isStandard ? qtyRef.current?.focus() : shadeRef.current?.focus(), 50);
  };

  const selectShade = (val: string) => {
    setShade(val);
    setTimeout(() => qtyRef.current?.focus(), 50);
  };

  const handleBarcodeScan = async () => {
    const code = barcode.trim();
    if (!code) return;
    setBarcodeLoading(true);
    try {
      const res = await fetch(`/api/lookupBarcode?barcode=${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Product not found");
        setBarcode("");
        return;
      }
      setItem(data.item);
      setShade(data.shade);
      setPrice(data.price);
      setBarcode("");
      addItem(); // auto-add to bill
    } catch (err) {
      console.error(err);
      alert("Failed to lookup barcode");
      setBarcode("");
    } finally {
      setBarcodeLoading(false);
      if (barcodeInputRef.current) barcodeInputRef.current.focus();
    }
  };

  useEffect(() => {
    const fields = [itemRef, shadeRef, qtyRef, priceRef];

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName;

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

      if (e.key === "Escape") {
        setSelectedRow(null);
        return;
      }

      if (e.key === "Tab") {
        if (target === barcodeInputRef.current && barcode) {
          e.preventDefault();
          handleBarcodeScan();
          return;
        }
        if (target === itemRef.current && itemSuggestion && item !== itemSuggestion) {
          e.preventDefault();
          selectItem(itemSuggestion);
          return;
        }
        if (target === shadeRef.current && shadeSuggestion && shade !== shadeSuggestion && !allShadesAreNumeric) {
          e.preventDefault();
          selectShade(shadeSuggestion);
          return;
        }
      }

      if (e.key !== "Enter") return;

      if (target === barcodeInputRef.current && barcode) {
        e.preventDefault();
        handleBarcodeScan();
        return;
      }

      if (target === itemRef.current) {
        if (itemSuggestion && item !== itemSuggestion) {
          e.preventDefault();
          selectItem(itemSuggestion);
        } else if (item) {
          e.preventDefault();
          if (isStandard) qtyRef.current?.focus();
          else shadeRef.current?.focus();
        }
        return;
      }

      if (target === shadeRef.current) {
        if (shadeSuggestion && shade !== shadeSuggestion && !allShadesAreNumeric) {
          e.preventDefault();
          selectShade(shadeSuggestion);
        } else if (shade) {
          e.preventDefault();
          qtyRef.current?.focus();
        }
        return;
      }

      if (target === qtyRef.current) {
        e.preventDefault();
        priceRef.current?.focus();
        return;
      }

      if (target === priceRef.current && item && shade && price) {
        e.preventDefault();
        addItem();
        return;
      }

      if (tag !== "BUTTON" && item && shade && price) {
        e.preventDefault();
        addItem();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [item, shade, price, qty, cost, shades, items, itemSuggestion, shadeSuggestion, isStandard, allItems, allShadesAreNumeric, barcode]);

  const addItem = async () => {
  if (!price) return;
  if (!item) {
    alert("Please enter an item name");
    return;
  }

  const itemExists = allItems.some(i => i.toLowerCase() === item.toLowerCase());
  let shadeIsValid = false;
  let isMisc = false;

  if (itemExists) {
    // Fetch shades for this item (use cache or API)
    let shadesList: string[] = [];
    if (shadeCache.current[item]) {
      shadesList = shadeCache.current[item];
    } else {
      try {
        const res = await fetch(`/api/core?action=getShades&item=${encodeURIComponent(item)}`);
        const data = await res.json();
        shadesList = data.shades || [];
        shadeCache.current[item] = shadesList;
      } catch (err) {
        console.error("Failed to fetch shades", err);
        shadesList = [];
      }
    }
    // If shade is provided, check if it exists in the list
    if (shade) {
      shadeIsValid = shadesList.some(s => s.toLowerCase() === shade.toLowerCase());
    } else {
      // Shade missing for existing item – treat as misc
      shadeIsValid = false;
    }
    isMisc = !shadeIsValid;
  } else {
    isMisc = true;
  }

  // If item exists and shade is missing/not found, we allow as misc, but we still need a shade value
  const finalShade = shade || (isMisc ? "Misc" : "");

  if (itemExists && !isMisc && !finalShade) {
    alert("Please select a shade for this item");
    return;
  }

  const total = qty * price;
  const profit = (price - cost) * qty;

  setItems(prev => [...prev, {
    item: item,
    shade: finalShade,
    qty,
    cost: cost || 0,
    price,
    total,
    profit,
    misc: isMisc,
  }]);

  // Reset form
  setItem("");
  setShade("");
  setQty(1);
  setPrice(0);
  setCost(0);
  setTimeout(() => itemRef.current?.focus(), 50);
};

  const grandTotal = items.reduce((sum, i) => sum + i.total, 0);
  const grandProfit = items.reduce((sum, i) => sum + i.profit, 0);

  const getApplicableSlab = (total: number) =>
    slabs.find(s => total >= s.minTotal && total <= s.maxTotal) || null;

  const applicableSlab = getApplicableSlab(grandTotal);
  const slabDiscount = applicableSlab ? Math.round(grandTotal * applicableSlab.pct / 100) : 0;

  const pointsDiscount = (() => {
    if (!redeemPoints || !pointsConfig || !customerMatchesPhone) return 0;
    if (customer.points < pointsConfig.minRedeem) return 0;
    return Math.floor(customer.points * pointsConfig.redeemRate);
  })();

  const discountAmt = pointsDiscount > 0 ? pointsDiscount : slabDiscount;
  const discountPct = pointsDiscount > 0 ? 0 : (applicableSlab?.pct ?? 0);
  const finalTotal = grandTotal - discountAmt;

  const captureBillImage = async (): Promise<Blob | null> => {
    const billEl = document.getElementById("print-bill");
    if (!billEl) return null;

    const logoEl = billEl.querySelector<HTMLImageElement>("img[alt='logo']");
    const originalSrc = logoEl?.src ?? "";
    const noPrint = billEl.querySelectorAll<HTMLElement>(".no-print");
    const printOnly = billEl.querySelectorAll<HTMLElement>(".print-only");

    try {
      if (logoEl) {
        try {
          const pngUrl = await svgToPngDataUrl("/logo.svg");
          logoEl.src = pngUrl;
          await new Promise(r => setTimeout(r, 100));
        } catch { /* continue */ }
      }

      noPrint.forEach(el => el.style.display = "none");
      printOnly.forEach(el => el.style.display = "inline");
      await new Promise(r => setTimeout(r, 50));

      const canvas = await html2canvas(billEl, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        allowTaint: true,
        logging: false,
        imageTimeout: 0,
      });

      return new Promise<Blob | null>((resolve) => {
        canvas.toBlob((blob) => resolve(blob), "image/png");
      });
    } catch (err) {
      console.error("Failed to capture bill image:", err);
      return null;
    } finally {
      noPrint.forEach(el => el.style.display = "");
      printOnly.forEach(el => el.style.display = "none");
      if (logoEl) logoEl.src = originalSrc;
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

  const saveBill = async (): Promise<boolean> => {
    if (items.length === 0 || saving) return false;
    if (!isPhoneValid) {
      alert("Please enter a valid 10-digit customer phone number before saving.");
      return false;
    }

    setSaving(true);

    try {
      const res = await fetch("/api/bill", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
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

      let data = null;

      try {
        data = await res.json();
      } catch {
        throw new Error("Invalid server response");
      }

      if (!res.ok) {
        throw new Error(data?.error || "Failed to save bill");
      }

      priceCache.current = {};
      fetchNextBillNo();

      setItems([]);
      setItem("");
      setShade("");
      setSelectedRow(null);
      setCustomer(null);
      setCustomerName("");
      setPhone("");
      setRedeemPoints(false);

      alert("Bill saved successfully.");
      return true;
    } catch (err: any) {
      console.error(err);
      alert(err.message || "Failed to save bill.");
      return false;
    } finally {
      setSaving(false);
    }
  };

  const sendWhatsAppWithBlob = async (blob: Blob) => {
    const cleaned = phone.replace(/[^0-9]/g, "");
    if (!cleaned) return;

    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      alert("Bill image copied to clipboard. Paste it in the WhatsApp chat.");
    } catch {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bill-${nextBillNo ?? "draft"}.png`;
      a.click();
      URL.revokeObjectURL(url);
      alert("Bill image downloaded. Attach it in WhatsApp.");
    }

    const waLink = `https://wa.me/${cleaned}`;
    const anchor = document.createElement("a");
    anchor.href = waLink;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
  };

  const sendWhatsApp = async () => {
    if (!phone || items.length === 0) return;
    if (!isPhoneValid) {
      alert("Invalid phone number. Please enter a 10-digit number.");
      return;
    }
    const blob = await captureBillImage();
    if (!blob) { alert("Failed to capture bill image."); return; }
    await sendWhatsAppWithBlob(blob);
  };

  const saveBillAndSend = async () => {
    if (items.length === 0 || saving) return;
    if (!isPhoneValid) {
      alert("Please enter a valid 10-digit customer phone number.");
      return;
    }

    if (redeemPoints && !customerMatchesPhone) {
      alert("Customer details are still loading or do not match the current phone number.");
      return;
    }

    const cleaned = normalizedPhone;
    const blob = await captureBillImage();
    let copied = false;

    if (blob) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        copied = true;
      } catch (err) {
        console.error(err);
      }
    } else {
      alert("Image fetch failed. Bill will be saved, but you'll need to attach the image manually in WhatsApp.");
    }

    const saved = await saveBill();
    if (!saved) return;

    if (cleaned) {
      const waLink = `https://wa.me/${cleaned}`;
      const anchor = document.createElement("a");
      anchor.href = waLink;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.click();
      if (copied) alert("Bill copied. Paste it in WhatsApp.");
      else alert("Please attach the bill image manually in WhatsApp.");
    }
  };

  const generateStoreRestock = async () => {
    const input = window.prompt(
      "Enter item name to restock (e.g., 'magnus'), or type 'all' for full low-stock list:"
    );
    if (!input || input.trim() === "") return;

    const item = input.trim();
    setRestockLoading(true);
    try {
      const res = await fetch(`/api/restock?type=store&item=${encodeURIComponent(item)}`);
      const data = await res.json();

      if (!res.ok) {
        alert(data.error || "Failed to generate restock");
        return;
      }

      if (!data.message) {
        alert(data.summary || `No restock needed.`);
        return;
      }

      const proceed = window.confirm(
        `Restock Summary:\n${data.summary}\n\nOpen WhatsApp to send?`
      );

      if (proceed && data.waLink) {
        const anchor = document.createElement("a");
        anchor.href = data.waLink;
        anchor.target = "_blank";
        anchor.rel = "noopener noreferrer";
        anchor.click();
      }
    } catch (err) {
      console.error(err);
      alert("Failed to generate restock list");
    } finally {
      setRestockLoading(false);
    }
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
      `}</style>

      <h1 className="no-print" style={styles.title}>Billing Counter</h1>
      <div className="no-print" style={styles.card}>
        <div style={styles.row}>
          <input
            ref={barcodeInputRef}
            type="text"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleBarcodeScan();
              }
            }}
            placeholder="Scan Barcode..."
            style={styles.smallInput}
            disabled={barcodeLoading}
          />
          {barcodeLoading && <span style={{ marginLeft: 8 }}>⌛</span>}
        </div>
        <div style={styles.row}>
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
            {itemSuggestion && item !== itemSuggestion && (
              <span style={styles.suggestion}>{itemSuggestion}</span>
            )}
            {item && !allItems.some(i => i.toLowerCase() === item.toLowerCase()) && (
              <span style={{ fontSize: 11, color: "#e67e22", marginLeft: 8 }}>(New item – no stock deduction)</span>
            )}
          </div>

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
              {shadeSuggestion && shade !== shadeSuggestion && (
                <span style={styles.suggestion}>{shadeSuggestion}</span>
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

      <div id="print-bill" style={styles.billArea}>
        <div style={styles.billHeader}>
          <img src="/logo.svg" alt="logo" style={styles.logo} crossOrigin="anonymous" />
          <div style={styles.billInfoRow}>
            <div style={styles.billLeft}>
              {customerName && (
                <div style={styles.billDetailRow}>
                  <span style={styles.metaLabel}>Customer</span>
                  <span style={styles.metaValue}>{customerName}</span>
                </div>
              )}
              {phone && (
                <div style={styles.billDetailRow}>
                  <span style={styles.metaLabel}>Phone</span>
                  <span style={styles.metaValue}>{phone}</span>
                </div>
              )}
            </div>
            <div style={styles.billRight}>
              <div style={styles.billDetailRow}>
                <span style={styles.metaLabel}>Bill No</span>
                <span style={styles.metaValue}>#{nextBillNo ?? "—"}</span>
              </div>
              <div style={styles.billDetailRow}>
                <span style={styles.metaLabel}>Date</span>
                <span style={styles.metaValue}>{billDate}</span>
              </div>
              <div style={styles.billDetailRow}>
                <span style={styles.metaLabel}>Time</span>
                <span style={styles.metaValue}>{billTime}</span>
              </div>
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
                  <td style={styles.td}>{i.item} {i.misc && <span style={{ fontSize: 10, color: "#e67e22" }}>(Misc)</span>}</td>
                  <td style={styles.td}>
                    {editingShadeRow === idx ? (
                      <div style={styles.autofillWrapper}>
                        <input
                          type="text"
                          value={editingShadeValue}
                          onChange={(e) => {
                            const val = e.target.value;
                            setEditingShadeValue(val);
                            const itemName = items[idx].item;
                            let itemShades: string[] = [];
                            if (shadeCache.current[itemName]) {
                              itemShades = shadeCache.current[itemName];
                            }
                            const allNumeric = itemShades.length > 0 && itemShades.every(s => /^\d+$/.test(s.trim()));
                            let suggestion = null;
                            if (val && !allNumeric) {
                              const trimmed = val.trim();
                              const isNumeric = /^\d+$/.test(trimmed);
                              if (isNumeric) {
                                suggestion = itemShades.find(s => s.trim().toLowerCase().startsWith(trimmed.toLowerCase())) || null;
                              } else {
                                const localFuse = new Fuse(itemShades, { threshold: 0.4, distance: 100, minMatchCharLength: 1 });
                                suggestion = localFuse.search(val)[0]?.item ?? null;
                              }
                            }
                            setEditShadeSuggestion(suggestion);
                          }}
                          onBlur={() => saveEditShade(idx)}
                          onKeyDown={(e) => {
                            if (e.key === "Tab" && editShadeSuggestion && editingShadeValue !== editShadeSuggestion) {
                              e.preventDefault();
                              setEditingShadeValue(editShadeSuggestion);
                              setEditShadeSuggestion(null);
                              return;
                            }
                            if (e.key === "Enter") saveEditShade(idx);
                            if (e.key === "Escape") cancelEditShade();
                          }}
                          autoFocus
                          disabled={validatingShade}
                          style={{
                            width: "100%",
                            minWidth: "120px",
                            padding: "6px 8px",
                            fontSize: "14px",
                            border: "1px solid #ccc",
                            borderRadius: "4px",
                            boxSizing: "border-box",
                          }}
                        />
                        {editShadeSuggestion && editingShadeValue !== editShadeSuggestion && (
                          <span style={styles.suggestion}>{editShadeSuggestion}</span>
                        )}
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
                        <span style={{ flex: 1, wordBreak: "break-word", whiteSpace: "normal" }}>
                          {i.shade}
                        </span>
                        <button
                          onClick={() => startEditShade(idx, i.shade)}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            fontSize: "14px",
                            padding: "4px",
                            color: "#666",
                            borderRadius: "4px",
                          }}
                          title="Edit shade"
                          aria-label="Edit shade"
                        >
                          ✏️
                        </button>
                      </div>
                    )}
                  </td>
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
        {!isPhoneValid && phone.trim().length > 0 && (
          <div style={{ fontSize: 12, color: "#cc3333", marginTop: 4 }}>Enter a valid 10-digit phone number</div>
        )}
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
        {customer && !customerMatchesPhone && (
          <div style={{ fontSize: 12, color: "#b56a00", marginTop: 6 }}>
            Customer lookup does not match the current phone number yet.
          </div>
        )}
      </div>

      <div className="no-print" style={styles.actions}>
        <button
          style={{
            ...styles.printBtn,
            background: "#22e6ae",
            opacity: restockLoading ? 0.6 : 1,
          }}
          onClick={generateStoreRestock}
          disabled={restockLoading}
        >
          📋 Store Restock (WhatsApp)
        </button>

        <button
          style={{
            ...styles.printBtn,
            background: "#25D366",
            opacity: (!isPhoneValid || items.length === 0) ? 0.5 : 1,
          }}
          onClick={sendWhatsApp}
          disabled={!isPhoneValid || items.length === 0}
        >
          📲 Send Bill
        </button>

        <button style={styles.printBtn} onClick={() => window.print()}>
          🖨 Print Bill
        </button>

        <button
          style={{
            ...styles.printBtn,
            opacity: (saving || items.length === 0 || !isPhoneValid) ? 0.6 : 1,
          }}
          onClick={saveBill}
          disabled={saving || items.length === 0 || !isPhoneValid}
        >
          {saving ? "Saving..." : "💾 Save to Sheets"}
        </button>

        <button
          style={{
            ...styles.printBtn,
            background: "#0a6ed1",
            opacity: (saving || items.length === 0 || !isPhoneValid) ? 0.6 : 1,
          }}
          onClick={saveBillAndSend}
          disabled={saving || items.length === 0 || !isPhoneValid}
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
  billInfoRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    width: "100%",
    gap: 20,
  },
  billLeft: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    textAlign: "left",
  },
  billRight: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    textAlign: "right",
  },
  billDetailRow: {
    display: "flex",
    gap: 12,
    alignItems: "center",
  },
  logo: { width: 240, height: "auto", objectFit: "contain", display: "block", margin: "0 auto 8px auto" },
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
  actions: { display: "flex", gap: 10, marginTop: 16, justifyContent: "flex-end", flexWrap: "wrap" },
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