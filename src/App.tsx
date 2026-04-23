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
  const [lastDeletedItem, setLastDeletedItem] = useState<BillItem | null>(null);
  const [lastDeletedIdx, setLastDeletedIdx] = useState<number | null>(null);
  const [deleteConfirmIdx, setDeleteConfirmIdx] = useState<number | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [savingProgress, setSavingProgress] = useState(false);
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

  // Auto-save bill to localStorage
  useEffect(() => {
    if (items.length > 0) {
      const draftBill = { items, customerName, phone, redeemPoints };
      localStorage.setItem("billDraft", JSON.stringify(draftBill));
    }
  }, [items, customerName, phone, redeemPoints]);

  // Show toast for a few seconds
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Recover unsaved bill on mount
  useEffect(() => {
    const draft = localStorage.getItem("billDraft");
    if (draft) {
      try {
        const { items: draftItems, customerName: draftName, phone: draftPhone, redeemPoints: draftRedeem } = JSON.parse(draft);
        if (draftItems?.length > 0) {
          const shouldRecover = window.confirm("You have an unsaved bill. Would you like to recover it?");
          if (shouldRecover) {
            setItems(draftItems);
            setCustomerName(draftName || "");
            setPhone(draftPhone || "");
            setRedeemPoints(draftRedeem || false);
            setToast({ message: "Bill recovered from draft", type: "success" });
          } else {
            localStorage.removeItem("billDraft");
          }
        }
      } catch (err) {
        console.error("Failed to recover bill draft:", err);
      }
    }
  }, []);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
  };

  const confirmDeleteItem = (idx: number) => {
    setDeleteConfirmIdx(idx);
  };

  const cancelDelete = () => {
    setDeleteConfirmIdx(null);
  };

  const undoDelete = () => {
    if (lastDeletedItem !== null && lastDeletedIdx !== null) {
      const updated = [...items];
      updated.splice(lastDeletedIdx, 0, lastDeletedItem);
      setItems(updated);
      setLastDeletedItem(null);
      setLastDeletedIdx(null);
      setSelectedRow(null);
      showToast("Item restored", "success");
    }
  };

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

      let newPrice = items[idx].price;
      let newCost = items[idx].cost;

      try {
        const priceRes = await fetch(
          `/api/core?action=getPrice&item=${encodeURIComponent(itemName)}&shade=${encodeURIComponent(matchedShade)}`
        );
        const priceData = await priceRes.json();
        newPrice = priceData.price || items[idx].price;
      } catch (err) {
        console.error("Failed to fetch new price for shade", err);
      }

      try {
        const costRes = await fetch(
          `/api/core?action=getCost&item=${encodeURIComponent(itemName)}&shade=${encodeURIComponent(matchedShade)}`
        );
        const costData = await costRes.json();
        newCost = costData.cost || items[idx].cost;
      } catch (err) {
        console.error("Failed to fetch new cost for shade", err);
      }

      const updated = [...items];
      updated[idx].shade = matchedShade;
      updated[idx].price = newPrice;
      updated[idx].cost = newCost;
      updated[idx].total = updated[idx].qty * newPrice;
      updated[idx].profit = (newPrice - newCost) * updated[idx].qty;
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
      if (data.customer?.name) {
        setCustomerName(data.customer.name);
        showToast(`Customer found: ${data.customer.name}`, "success");
      }
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
    threshold: 0.6,
    distance: 50,
    includeScore: true,
    minMatchCharLength: 2,
  }), [allItems]);

  const shadeFuse = useMemo(() => new Fuse(shades, {
    threshold: 0.6,
    distance: 50,
    includeScore: true,
    minMatchCharLength: 2,
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
      addItem(true);
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

      // Keyboard shortcuts
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (isPhoneValid && items.length > 0 && !saving) {
          saveBill();
        }
        return;
      }

      if (e.ctrlKey && e.key === 'Enter') {
        e.preventDefault();
        if (isPhoneValid && items.length > 0 && !saving) {
          saveBillAndSend();
        }
        return;
      }

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
        addItem(false);
        return;
      }

      if (tag !== "BUTTON" && item && shade && price) {
        e.preventDefault();
        addItem(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [item, shade, price, qty, cost, shades, items, itemSuggestion, shadeSuggestion, isStandard, allItems, allShadesAreNumeric, barcode, isPhoneValid, saving]);

  const addItem = async (fromBarcode = false) => {
    if (price === undefined || price === null || price < 0) {
      alert("Please enter a valid price (0 or higher)");
      return;
    }
    if (!item) {
      alert("Please enter an item name");
      return;
    }

    const itemExists = allItems.some(i => i.toLowerCase() === item.toLowerCase());
    let shadeIsValid = false;
    let isMisc = false;

    if (itemExists) {
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
      if (shade) {
        shadeIsValid = shadesList.some(s => s.toLowerCase() === shade.toLowerCase());
      } else {
        shadeIsValid = false;
      }
      isMisc = !shadeIsValid;
    } else {
      isMisc = true;
    }

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

    if (fromBarcode) {
      setItem("");
      setShade("");
      setQty(1);
      setPrice(0);
      setCost(0);
      setTimeout(() => barcodeInputRef.current?.focus(), 50);
    } else {
      setShade("");
      setQty(1);
      setPrice(0);
      setCost(0);
      setTimeout(() => shadeRef.current?.focus(), 50);
    }
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
    setSavingProgress(true);

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
      shadeCache.current = {};
      sessionStorage.removeItem("allItems");
      localStorage.removeItem("billDraft");
      fetchNextBillNo();

      setItems([]);
      setItem("");
      setShade("");
      setSelectedRow(null);
      setCustomer(null);
      setCustomerName("");
      setPhone("");
      setRedeemPoints(false);

      showToast(`Bill #${nextBillNo} saved successfully!`, "success");
      return true;
    } catch (err: any) {
      console.error(err);
      showToast(err.message || "Failed to save bill.", "error");
      return false;
    } finally {
      setSaving(false);
      setSavingProgress(false);
    }
  };

  const sendWhatsAppWithBlob = async (blob: Blob) => {
    const cleaned = phone.replace(/[^0-9]/g, "");
    if (!cleaned) return;

    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      showToast("Bill image copied to clipboard. Paste it in WhatsApp.", "success");
    } catch {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bill-${nextBillNo ?? "draft"}.png`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Bill image downloaded. Attach it in WhatsApp.", "info");
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
      showToast("Invalid phone number. Please enter a 10-digit number.", "error");
      return;
    }
    const blob = await captureBillImage();
    if (!blob) { showToast("Failed to capture bill image.", "error"); return; }
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
    setSavingProgress(true);
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
      showToast("Image fetch failed. Bill will be saved, but you'll need to attach the image manually in WhatsApp.", "error");
    }

    const saved = await saveBill();
    if (!saved) { setSavingProgress(false); return; }

    if (cleaned) {
      const waLink = `https://wa.me/${cleaned}`;
      const anchor = document.createElement("a");
      anchor.href = waLink;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.click();
      if (copied) showToast("Bill copied. Paste it in WhatsApp.", "success");
      else showToast("Please attach the bill image manually in WhatsApp.", "info");
    }
    setSavingProgress(false);
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
    const deleted = items[idx];
    setLastDeletedItem(deleted);
    setLastDeletedIdx(idx);
    setItems(items.filter((_, i) => i !== idx));
    setSelectedRow(null);
    setDeleteConfirmIdx(null);
    showToast(`Item removed (Undo available)`, "info");
  };

  return (
    <div className="app-container" style={styles.container}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');
        
        * {
          font-family: 'Montserrat', sans-serif;
        }
        
        .bill-table {
          border-left: 1px solid #c5cad1 !important;
          border-right: 1px solid #c5cad1 !important;
        }
        .bill-table th, .bill-table td {
          border-right: 1px solid #c5cad1 !important;
        }
        .bill-table th:first-child, .bill-table td:first-child {
          border-left: 1px solid #c5cad1 !important;
        }
        .bill-table th:last-child, .bill-table td:last-child {
          border-right: none !important;
        }
        
        input, button {
          font-family: 'Montserrat', sans-serif;
        }
        
        input:focus {
          outline: none;
          box-shadow: 0 0 0 3px rgba(26, 26, 26, 0.1);
          border-color: #1a1a1a !important;
        }
        
        button:hover:not(:disabled) {
          background-color: #333 !important;
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        
        button:active:not(:disabled) {
          transform: translateY(0);
        }
        
        @media print {
          .no-print { display: none !important; }
          .print-only { display: inline !important; }
          body, html { 
            margin: 0 !important; 
            padding: 0 !important; 
            background: white !important;
            font-family: 'Montserrat', Arial, sans-serif !important;
          }
          .app-container {
            background: white !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            max-width: 100% !important;
          }
          #print-bill { 
            border: 1.5px solid #000 !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            padding: 28px 32px !important;
            page-break-inside: avoid !important;
          }
          .bill-table {
            page-break-inside: avoid !important;
            border-left: 1px solid #000 !important;
            border-right: 1px solid #000 !important;
          }
          .bill-table th, .bill-table td {
            border-right: 1px solid #000 !important;
          }
          .bill-table th:first-child, .bill-table td:first-child {
            border-left: 1px solid #000 !important;
          }
          .bill-table th:last-child, .bill-table td:last-child {
            border-right: none !important;
          }
          .bill-table td, .bill-table th { 
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color: #000 !important;
            background-color: inherit !important;
          }
          .bill-table th {
            background-color: #f0f1f3 !important;
            border-bottom: 1.5px solid #000 !important;
            border-top: 1.5px solid #000 !important;
          }
          .bill-table tr:nth-child(odd) {
            background-color: #ffffff !important;
          }
          .bill-table tr:nth-child(even) {
            background-color: #fafbfc !important;
          }
          .bill-table td {
            border-bottom: 0.75px solid #e0e3e8 !important;
          }
          hr {
            border: none !important;
            border-top: 1px dotted #999 !important;
            margin: 12px 0 !important;
          }
        }
      `}</style>

      {/* Toast Notification */}
      {toast && (
        <div style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          background: toast.type === 'success' ? '#10b981' : toast.type === 'error' ? '#ef4444' : '#3b82f6',
          color: '#fff',
          padding: "14px 20px",
          borderRadius: "0px",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          fontSize: "13px",
          fontWeight: 600,
          zIndex: 9999,
          maxWidth: "300px",
          animation: "slideIn 0.3s ease",
          fontFamily: "'Montserrat', sans-serif",
          letterSpacing: "0.3px",
        }}>
          {toast.message}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteConfirmIdx !== null && (
        <div style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9998,
        }}>
          <div style={{
            background: "#fff",
            padding: "24px",
            borderRadius: "0px",
            boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
            maxWidth: "400px",
            fontFamily: "'Montserrat', sans-serif",
          }}>
            <h3 style={{ margin: "0 0 12px 0", fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>Delete Item?</h3>
            <p style={{ margin: "0 0 20px 0", fontSize: "13px", color: "#64748b", lineHeight: "1.5" }}>
              Are you sure you want to delete "<strong>{items[deleteConfirmIdx]?.item}</strong>"? You can undo this action.
            </p>
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                onClick={cancelDelete}
                style={{
                  padding: "10px 18px",
                  fontSize: "12px",
                  fontWeight: 700,
                  border: "1px solid #cbd5e1",
                  background: "#f1f5f9",
                  color: "#334155",
                  cursor: "pointer",
                  borderRadius: "0px",
                  fontFamily: "'Montserrat', sans-serif",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => { removeItem(deleteConfirmIdx); }}
                style={{
                  padding: "10px 18px",
                  fontSize: "12px",
                  fontWeight: 700,
                  border: "none",
                  background: "#dc2626",
                  color: "#fff",
                  cursor: "pointer",
                  borderRadius: "0px",
                  fontFamily: "'Montserrat', sans-serif",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateX(20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
      `}</style>

      <h1 className="no-print" style={styles.title}>Billing Counter</h1>
      <div className="no-print" style={{ textAlign: "center", fontSize: "11px", color: "#64748b", marginBottom: "20px", letterSpacing: "0.3px", fontFamily: "'Montserrat', sans-serif" }}>
        <span style={{ fontWeight: 700, textTransform: "uppercase" }}>Keyboard Shortcuts:</span> Enter to add • Tab for autocomplete • Ctrl+S to save • Ctrl+Enter to save & send
      </div>

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
          <button style={styles.button} onClick={() => { addItem(false); }}>Add</button>
        </div>
      </div>

      {/* Professional bill area with a solid border – like a supermarket receipt */}
      <div id="print-bill" style={styles.billArea}>
        <div style={styles.billHeader}>
          <img src="/logo.svg" alt="logo" style={styles.logo} crossOrigin="anonymous" />
          <div style={{ ...styles.metadataRight, width: "100%", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px", paddingTop: "8px", marginTop: "0px" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ ...styles.metaLabel, textAlign: "center", display: "block", marginBottom: "4px" }}>Bill No</div>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "#1a1a1a", textAlign: "center" }}>#{nextBillNo ?? "—"}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ ...styles.metaLabel, textAlign: "center", display: "block", marginBottom: "4px" }}>Date</div>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "#1a1a1a", textAlign: "center" }}>{billDate}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ ...styles.metaLabel, textAlign: "center", display: "block", marginBottom: "4px" }}>Time</div>
              <div style={{ fontSize: "16px", fontWeight: 700, color: "#1a1a1a", textAlign: "center" }}>{billTime}</div>
            </div>
          </div>
        </div>

        <hr style={styles.divider} />

        {/* Customer info inside a bordered box */}
        <div style={styles.customerBox}>
          <div style={styles.customerBoxRow}>
            <span style={styles.metaLabel}>Customer:</span>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#1a1a1a" }}>{customerName || "Walk-in"}</span>
          </div>
          <div style={styles.customerBoxRow}>
            <span style={styles.metaLabel}>Phone:</span>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#1a1a1a" }}>{phone || "—"}</span>
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
              <th style={{ ...styles.th, width: "12%", textAlign: "right", paddingRight: "20px" }}>Price</th>
              <th style={{ ...styles.th, width: "13%", textAlign: "right", paddingRight: "20px" }}>Total</th>
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
                    backgroundColor: selectedRow === idx ? styles.selectedRow.backgroundColor : undefined,
                    cursor: "pointer",
                  }}
                  onClick={() => setSelectedRow(idx)}
                >
                  <td style={{ ...styles.td, textAlign: "center", color: "#999", fontSize: 13 }}>{idx + 1}</td>
                  <td style={styles.td}>
                    {i.item}
                    {i.misc && <span className="no-print" style={{ fontSize: 10, color: "#e67e22" }}> (Misc)</span>}
                  </td>
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
                          className="no-print"
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
                  <td style={{ ...styles.td, textAlign: "right", paddingRight: "20px" }}>₹{i.price}</td>
                  <td style={{ ...styles.td, textAlign: "right", fontWeight: 700, paddingRight: "20px" }}>₹{i.total}</td>
                  <td className="no-print" style={{ ...styles.td, textAlign: "center" }}>
                    <button style={styles.removeBtn} onClick={(e) => { e.stopPropagation(); confirmDeleteItem(idx); }}>✕</button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <hr style={styles.divider} />
        <div style={styles.totalsBlock}>
          <div className="no-print" style={{ ...styles.profitRow, display: "flex", justifyContent: "space-between", paddingRight: "8px" }}>
            <span>Net Profit</span>
            <span>₹{grandProfit}</span>
          </div>
          {discountAmt > 0 && (
            <div style={{ ...styles.discountRow, display: "flex", justifyContent: "space-between", paddingRight: "8px" }}>
              <span>
                {pointsDiscount > 0
                  ? `Points Redeemed`
                  : `Discount (${applicableSlab?.pct}%)`}
              </span>
              <span>− ₹{discountAmt}</span>
            </div>
          )}
          <div style={{ ...styles.grandTotalRow, display: "flex", justifyContent: "space-between" }}>
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
            placeholder="Phone (10 digits)... *"
            style={{...styles.smallInput, borderColor: phone.trim().length > 0 && !isPhoneValid ? '#ef4444' : '#cbd5e1'}}
          />
          {fetchingCustomer && <span style={{ fontSize: 13, color: "#888", fontFamily: "'Montserrat', sans-serif" }}>Looking up...</span>}
        </div>
        {!isPhoneValid && phone.trim().length > 0 && (
          <div style={{ fontSize: 12, color: "#cc3333", marginTop: 4, fontFamily: "'Montserrat', sans-serif", fontWeight: 600 }}>⚠ Enter a valid 10-digit phone number</div>
        )}
        {customer && (
          <div style={styles.customerInfo}>
            <span>👤 {customer.name} — {customer.points} pts</span>
            {pointsConfig && customer.points >= pointsConfig.minRedeem && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontFamily: "'Montserrat', sans-serif" }}>
                <input
                  type="checkbox"
                  checked={redeemPoints}
                  onChange={(e) => setRedeemPoints(e.target.checked)}
                />
                Redeem {customer.points} points (₹{Math.floor(customer.points * pointsConfig.redeemRate)} off)
              </label>
            )}
            {pointsConfig && customer.points < pointsConfig.minRedeem && (
              <span style={{ fontSize: 12, color: "#aaa", fontFamily: "'Montserrat', sans-serif" }}>
                {pointsConfig.minRedeem - customer.points} More points needed to redeem.
              </span>
            )}
          </div>
        )}
        {!customer && phone.replace(/[^0-9]/g, "").length >= 10 && !fetchingCustomer && (
          <div style={{ fontSize: 13, color: "#888", marginTop: 6, fontFamily: "'Montserrat', sans-serif", fontWeight: 500 }}>🆕 New customer — will be registered on save</div>
        )}
        {customer && !customerMatchesPhone && (
          <div style={{ fontSize: 12, color: "#b56a00", marginTop: 6, fontFamily: "'Montserrat', sans-serif", fontWeight: 600 }}>
            ⏳ Customer lookup does not match the current phone number yet.
          </div>
        )}
      </div>

      <div className="no-print" style={styles.actions}>
        {lastDeletedItem && (
          <button
            style={{
              ...styles.printBtn,
              background: "#8b5cf6",
            }}
            onClick={undoDelete}
          >
            ↶ Undo Delete
          </button>
        )}

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
            opacity: (savingProgress || items.length === 0 || !isPhoneValid) ? 0.6 : 1,
          }}
          onClick={saveBill}
          disabled={savingProgress || items.length === 0 || !isPhoneValid}
        >
          {savingProgress ? "⏳ Saving..." : "💾 Save to Sheets"}
        </button>

        <button
          style={{
            ...styles.printBtn,
            background: "#0a6ed1",
            opacity: (savingProgress || items.length === 0 || !isPhoneValid) ? 0.6 : 1,
          }}
          onClick={saveBillAndSend}
          disabled={savingProgress || items.length === 0 || !isPhoneValid}
        >
          {savingProgress ? "⏳ Saving..." : "💾📲 Save & Send"}
        </button>
      </div>
    </div>
  );
}

const styles: { [key: string]: React.CSSProperties } = {
  container: {
    maxWidth: 900,
    margin: "28px auto",
    fontFamily: "'Montserrat', sans-serif",
    background: "#f8f9fb",
    padding: "28px",
    borderRadius: "0px",
  },
  title: { 
    textAlign: "center", 
    marginBottom: "28px", 
    fontWeight: 800, 
    fontSize: "32px", 
    letterSpacing: "-1px",
    color: "#0f172a",
    textTransform: "uppercase",
    fontFamily: "'Montserrat', sans-serif",
  },
  card: {
    background: "#ffffff",
    padding: "24px",
    borderRadius: "0px",
    marginBottom: "28px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    border: "1px solid #e2e8f0",
  },
  row: { display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" },
  smallInput: {
    flex: 1,
    padding: "12px 14px",
    fontSize: "14px",
    borderRadius: "0px",
    border: "1px solid #cbd5e1",
    outline: "none",
    background: "#fbfcfd",
    fontFamily: "'Montserrat', sans-serif",
    transition: "border-color 0.2s, box-shadow 0.2s",
    fontWeight: 500,
  },
  autofillWrapper: { position: "relative", flex: 1 },
  suggestion: {
    position: "absolute",
    left: "14px",
    top: "12px",
    color: "#a8adb8",
    pointerEvents: "none",
    fontSize: "14px",
    fontFamily: "'Montserrat', sans-serif",
    opacity: 0.7,
    fontWeight: 500,
  },
  button: {
    padding: "12px 24px",
    fontSize: "13px",
    fontWeight: 700,
    borderRadius: "0px",
    border: "none",
    background: "#0f172a",
    color: "#fff",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "all 0.2s ease",
    fontFamily: "'Montserrat', sans-serif",
    letterSpacing: "0.3px",
  },
  billArea: {
    background: "#ffffff",
    borderRadius: "0px",
    padding: "32px 36px",
    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
    border: "1.5px solid #1a1a1a",
    pageBreakInside: "avoid",
  },
  billHeader: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    marginBottom: "12px",
    gap: "10px",
    paddingBottom: "18px",
    borderBottom: "1px dotted #cbd5e1",
  },
  metadataRight: {
    alignSelf: "flex-end",
    textAlign: "right",
    marginTop: "8px",
  },
  metaRow: {
    display: "flex",
    justifyContent: "flex-end",
    gap: "16px",
    alignItems: "center",
    marginBottom: "3px",
    fontSize: "13px",
  },
  customerBox: {
    border: "1px solid #e2e8f0",
    borderRadius: "0px",
    padding: "16px 18px",
    marginBottom: "0px",
    marginTop: "14px",
    backgroundColor: "#f8f9fb",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "1px dotted #cbd5e1",
    fontFamily: "'Montserrat', sans-serif",
  },
  customerBoxRow: {
    display: "flex",
    gap: "18px",
    alignItems: "center",
  },
  logo: { width: "300px", height: "auto", objectFit: "contain", display: "block", margin: "0 auto 14px auto" },
  metaLabel: { fontSize: "10px", color: "#64748b", textTransform: "uppercase", letterSpacing: "0.8px", fontWeight: 800, minWidth: "52px", fontFamily: "'Montserrat', sans-serif" },
  metaValue: { fontSize: "15px", fontWeight: 700, color: "#0f172a", textAlign: "right", minWidth: "80px", fontFamily: "'Montserrat', sans-serif", letterSpacing: "-0.3px" },
  divider: { border: "none", borderTop: "1px dotted #cbd5e1", margin: "14px 0", padding: "0" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "13px", marginTop: "14px", border: "1px solid #c5cad1", borderTop: "none", fontFamily: "'Montserrat', sans-serif" },
  theadRow: { backgroundColor: "#f0f1f3" },
  th: {
    padding: "16px 13px",
    color: "#334155",
    fontWeight: 800,
    fontSize: "10px",
    textTransform: "uppercase",
    letterSpacing: "0.8px",
    textAlign: "left",
    borderBottom: "1.5px solid #0f172a",
    borderTop: "1.5px solid #0f172a",
    fontFamily: "'Montserrat', sans-serif",
  },
  td: {
    padding: "13px 13px",
    color: "#1e293b",
    fontSize: "13px",
    borderBottom: "0.75px solid #e0e3e8",
    verticalAlign: "middle",
    fontFamily: "'Montserrat', sans-serif",
    fontWeight: 500,
  },
  trEven: { backgroundColor: "#ffffff" },
  trOdd: { backgroundColor: "#fbfcfd" },
  selectedRow: { backgroundColor: "#f0f4f8" },
  qtyControls: { display: "inline-flex", alignItems: "center", gap: "6px" },
  qtyBtn: {
    width: "28px",
    height: "28px",
    borderRadius: "0px",
    border: "1px solid #cbd5e1",
    background: "#f1f5f9",
    cursor: "pointer",
    fontSize: "13px",
    fontWeight: 700,
    lineHeight: 1,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "0",
    transition: "all 0.2s ease",
    fontFamily: "'Montserrat', sans-serif",
    color: "#0f172a",
  },
  qtyNum: { minWidth: "28px", textAlign: "center", fontWeight: 700, fontSize: "13px", fontFamily: "'Montserrat', sans-serif" },
  removeBtn: {
    background: "none",
    border: "none",
    color: "#dc2626",
    cursor: "pointer",
    fontSize: "15px",
    fontWeight: 700,
    padding: "2px 6px",
    borderRadius: "0px",
    transition: "color 0.2s",
    fontFamily: "'Montserrat', sans-serif",
  },
  totalsBlock: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: "10px",
    marginTop: "14px",
    paddingTop: "14px",
    borderTop: "1px dotted #cbd5e1",
  },
  profitRow: { display: "flex", gap: "64px", fontSize: "13px", color: "#64748b", justifyContent: "space-between", minWidth: "260px", fontFamily: "'Montserrat', sans-serif", fontWeight: 600 },
  discountRow: { display: "flex", gap: "64px", fontSize: "14px", color: "#059669", fontWeight: 800, justifyContent: "space-between", minWidth: "260px", fontFamily: "'Montserrat', sans-serif", letterSpacing: "-0.3px" },
  grandTotalRow: {
    display: "flex",
    gap: "64px",
    fontSize: "19px",
    fontWeight: 800,
    color: "#0f172a",
    borderTop: "1.5px solid #0f172a",
    paddingTop: "12px",
    marginTop: "10px",
    justifyContent: "space-between",
    minWidth: "260px",
    letterSpacing: "-0.8px",
    fontFamily: "'Montserrat', sans-serif",
  },
  thankYou: { 
    textAlign: "center", 
    marginTop: "22px", 
    paddingTop: "18px",
    borderTop: "1px dotted #cbd5e1",
    fontSize: "11px", 
    color: "#475569", 
    letterSpacing: "0.4px",
    fontWeight: 700,
    textTransform: "uppercase",
    fontFamily: "'Montserrat', sans-serif",
  },
  customerCard: {
    background: "#ffffff",
    padding: "24px",
    borderRadius: "0px",
    marginTop: "24px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
    border: "1px solid #e2e8f0",
  },
  customerInfo: {
    display: "flex",
    alignItems: "center",
    gap: "20px",
    marginTop: "14px",
    fontSize: "13px",
    color: "#1e293b",
    fontFamily: "'Montserrat', sans-serif",
    fontWeight: 600,
  },
  actions: { display: "flex", gap: "10px", marginTop: "24px", justifyContent: "flex-end", flexWrap: "wrap" },
  printBtn: {
    padding: "12px 24px",
    fontSize: "12px",
    fontWeight: 700,
    borderRadius: "0px",
    border: "none",
    background: "#0f172a",
    color: "#fff",
    cursor: "pointer",
    transition: "all 0.2s ease",
    fontFamily: "'Montserrat', sans-serif",
    letterSpacing: "0.3px",
    textTransform: "uppercase",
  },
};