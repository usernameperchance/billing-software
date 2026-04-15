# Before & After: Stock Deduction Flow

## ❌ BEFORE (Vulnerable to Double Deduction)

```
Bill: ₹2000 (Item A qty 10, Item B qty 20, Item C qty 30)
│
├─ START PROCESSING
│
├─ Item A: Fetch stock (50) ✓
│  └─ Deduct 10 → 40 ✓ [MODIFICATION MADE]
│
├─ Item B: Fetch stock (8 available) ✓  
│  └─ ERROR: Need 20, only have 8 ✗
│     └─ Calculate shortage...
│        └─ Try to deduct anyway from mixed sources
│           └─ ERROR: Insufficient ✗
│
├─ BILL FAILS ❌
│  │
│  └─ PROBLEM: Item A already DEDUCTED!
│     └─ But bill was never saved
│        └─ On retry, Item A deducts AGAIN ⚠️
│
└─ Result: DOUBLE DEDUCTION of Item A (10 + 10)
```

### Issues with Old Approach:
1. ❌ Deduction happens DURING validation
2. ❌ If error on item N, items 1 to N-1 already modified
3. ❌ No rollback mechanism
4. ❌ Retry causes double deduction
5. ❌ Inconsistent stock vs sales records

---

## ✅ AFTER (Transaction-Safe Flow)

```
Bill: ₹2000 (Item A qty 10, Item B qty 20, Item C qty 30)
│
├─ ══════════════════════════════════════════════════
│  STEP 1: VALIDATE ALL ITEMS (READ-ONLY)
│  ══════════════════════════════════════════════════
│
├─ Item A: Check stock (need 10)
│           Store: 50 ✓, Loft: 0
│           Available: 50 ✓✓✓ PASS
│
├─ Item B: Check stock (need 20)
│           Store: 8 ✓, Loft: 0
│           Available: 8 ✗✗✗ FAIL
│
├─ ERROR DETECTED: "Insufficient stock for Item B"
│  │
│  ├─ ❌ NO MODIFICATIONS MADE YET!
│  ├─ ❌ Item A stock still = 50
│  ├─ ❌ Nothing to rollback
│  └─ ❌ Item C never checked (stopped early)
│
├─ Return Error → User Fixes Stock → Retry
│
├─ ══════════════════════════════════════════════════
│  RETRY: STEP 1 AGAIN (READ-ONLY)
│  ══════════════════════════════════════════════════
│
├─ Item A: Check stock (need 10)
│           Available: 50 ✓ PASS
│
├─ Item B: Check stock (need 20)
│           Available: 25 (fixed) ✓ PASS
│
├─ Item C: Check stock (need 30)
│           Available: 100 ✓ PASS
│
├─ ✅ ALL ITEMS VALIDATED!
│
├─ ══════════════════════════════════════════════════
│  STEP 2: DEDUCT STOCK (WRITE OPERATIONS)
│  ══════════════════════════════════════════════════
│  (Only executed if STEP 1 passed)
│
├─ Item A: Deduct 10 from store
│           50 - 10 = 40 ✓ [MODIFICATION MADE]
│
├─ Item B: Deduct 20 from store + loft
│           25 - 20 = 5 ✓ [MODIFICATION MADE]
│
├─ Item C: Deduct 30 from store
│           100 - 30 = 70 ✓ [MODIFICATION MADE]
│
├─ If any deduction fails → ROLLBACK ALL ✓
│
├─ ══════════════════════════════════════════════════
│  STEP 3: SAVE BILL & CUSTOMER
│  ══════════════════════════════════════════════════
│
├─ Create Customer record
├─ Save Bill row
│
└─ SUCCESS ✅
   Stock: A=40, B=5, C=70
   Bill: Saved correctly
   No double deductions!
```

### Advantages of New Approach:
1. ✅ Validation happens FIRST (read-only, no side effects)
2. ✅ If error detected, STOP before any modification
3. ✅ Automatic rollback if deduction fails
4. ✅ Retry is safe (no double deduction)
5. ✅ Consistent stock vs sales records
6. ✅ Clear separation: validate → commit → save

---

## 📊 Comparison Table

| Aspect | Before | After |
|--------|--------|-------|
| **Validation timing** | During each item processing | All items validated first |
| **Modifications on error** | Already made → need rollback | Haven't started yet → nothing to rollback |
| **Retry behavior** | Double deduction risk ⚠️ | Safe, idempotent ✅ |
| **Error recovery** | Manual rollback attempt | Automatic, comprehensive |
| **Stock accuracy** | Inconsistent | Guaranteed accurate |
| **Code clarity** | Mixed concerns | Clear 3-step flow |
| **Failure scenarios** | 5+ partial failure modes | 1 safe mode: all-or-nothing |

---

## 🧪 Test Scenarios

### Scenario 1: Successful Bill
```
ALL ITEMS VALID → Deduct all → Save bill
✅ Stock: Correct
✅ Bill: Saved
✅ Retry: Works correctly
```

### Scenario 2: Item 2 Fails Validation
```
Item 1 ✓ → Item 2 ✗ → Stop before deduction
✅ Item 1 stock: Untouched (still 50)
✅ Item 2 not attempted
✅ Retry after fix: Clean slate
```

### Scenario 3: Item 3 Deduction Fails (After Items 1&2 Deducted)
```
Validate all items ✓ → Deduct Item 1 ✓ → Deduct Item 2 ✓ → Deduct Item 3 ✗
→ AUTOMATIC ROLLBACK:
  - Item 1: Restore to original ✓
  - Item 2: Restore to original ✓
  - Item 3: Never deducted
✅ Stock: Back to original state
```

### Scenario 4: Network Timeout During Deduction
```
Validate all ✓ → Deduct Item 1 ✓ → Network issue → Partial deduction
→ AUTOMATIC ROLLBACK restores all ✓
✅ Safe to retry
```

---

## Code Impact

### Files Modified:
1. **[api/bill.ts](api/bill.ts)**
   - Added: `validateAllItemsStock()` (150+ lines)
   - Added: `deductAllItemsStock()` (100+ lines)
   - Refactored: POST handler to use 3-step flow
   - Added: Empty items validation

2. **[src/App.tsx](src/App.tsx)**
   - Fixed: `addItem()` to allow price = 0
   - Fixed: `saveEditShade()` to re-fetch price/cost
   - Fixed: `saveBill()` to clear all caches
   - Fixed: Fuzzy matching thresholds

3. **[api/core.ts](api/core.ts)**
   - Fixed: `handleGetCustomer()` to normalize phone

### Lines Changed:
- Additions: ~350 new lines
- Modifications: ~50 lines
- Deletions: ~60 lines (old nested loop logic)
- Net: +340 lines (better clarity & safety)

---

## 🎯 Rollout Recommendation

**Phase 1 (Immediate):** Deploy bill.ts changes + core.ts fix
- Prevents all double deductions
- Fixes customer lookup

**Phase 2 (Same release):** Deploy App.tsx changes
- Improves UX (free items, shade editing, caching)
- Tightens fuzzy matching

**Testing**: Run all 6 test scenarios from [FIXES_APPLIED.md](FIXES_APPLIED.md)

---

Generated: 2026-04-15
