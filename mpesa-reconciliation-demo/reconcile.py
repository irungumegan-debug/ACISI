#!/usr/bin/env python3
"""
M-Pesa payment reconciliation demo.

Matches a business's "customer orders" list against a raw M-Pesa statement
export, so a small business owner can see at a glance:

  - which orders are confirmed paid
  - which orders still have no payment against them (chase these up)
  - which statement payments don't belong to any known order (a new
    customer who didn't mention an order, or someone who paid the wrong
    reference amount)

Usage:
    python3 reconcile.py \\
        --orders sample_data/orders.csv \\
        --statement sample_data/mpesa_statement.csv \\
        --output-dir output

Run with no arguments to reconcile the bundled sample data.

------------------------------------------------------------------------
WHY FUZZY MATCHING IS NEEDED (read this before demoing to a client)
------------------------------------------------------------------------
A naive reconciliation would just compare "phone number + amount" for exact
equality. In practice that fails constantly for two reasons:

1. PHONE NUMBER FORMATTING. The same Safaricom number can appear as
   "0712345678", "+254712345678", "254712345678", or with stray spaces
   ("0712 345 678") depending on where it was typed - the order form vs.
   the M-Pesa statement's free-text "Details" column. We normalise every
   phone number down to its 9-digit national number (dropping the 0/254/+
   prefix and any spaces) before comparing, so all of those forms match
   each other.

2. AMOUNT DRIFT FROM FEES. M-Pesa sometimes deducts a small transaction
   fee from what the customer sends, so the amount that lands in the
   business's account can be a few shillings less than what was invoiced.
   We treat two amounts as "the same payment" if they're within a
   tolerance window (a flat KES amount OR a percentage of the expected
   amount, whichever is larger) rather than requiring exact equality.

Matching is still anchored on the phone number - we never guess a match
from amount alone, since two customers could easily owe similar amounts.
If a payment comes from the right phone number but the amount is wildly
off (e.g. a deposit, not a full payment), we deliberately do NOT auto-match
it - it's flagged in the notes for a human to check, rather than silently
reconciled.
"""
import argparse
import csv
import html
import re
from pathlib import Path

DEFAULT_ABS_TOLERANCE = 50      # KES - covers typical M-Pesa fee amounts
DEFAULT_PCT_TOLERANCE = 0.02    # 2% - covers fees on larger amounts


def normalize_phone(raw):
    """Reduce any phone number format to its 9-digit national number.

    '+254712345678', '254712345678', '0712345678' and '0712 345 678'
    (and any other stray whitespace/dashes) all normalize to '712345678'.
    Returns None if the input doesn't look like a Kenyan mobile number.
    """
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("254"):
        digits = digits[3:]
    elif digits.startswith("0"):
        digits = digits[1:]
    if len(digits) != 9:
        return None
    return digits


def extract_phone_from_details(details):
    """Pull a phone number out of an M-Pesa statement's free-text 'Details'
    column, e.g. 'Customer Payment from 254712345678 - JOHN KAMAU' ->
    '712345678'. Looks for a run of 9-12 digits, which is generous enough
    to catch 07..., 254..., and +254... written with no separators (the
    statement export never puts spaces inside the digits themselves)."""
    match = re.search(r"\d{9,12}", details or "")
    if not match:
        return None
    return normalize_phone(match.group(0))


def amounts_match(expected, paid, abs_tolerance, pct_tolerance):
    """True if `paid` is close enough to `expected` to count as the same
    payment - within a flat KES tolerance or a percentage of the expected
    amount, whichever is more generous. This is what absorbs M-Pesa fees
    shaving a few shillings off the total."""
    tolerance = max(abs_tolerance, expected * pct_tolerance)
    return abs(expected - paid) <= tolerance


def load_orders(path):
    orders = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            orders.append({
                "order_id": row["Order ID"],
                "customer_name": row["Customer Name"],
                "phone_raw": row["Phone Number"],
                "phone_normalized": normalize_phone(row["Phone Number"]),
                "amount_expected": float(row["Amount Expected"]),
                "date": row["Date"],
            })
    return orders


def load_transactions(path):
    """Load statement rows, keeping only completed customer payments
    (Paid In > 0). Withdrawn-only rows (business paying someone out) and
    non-completed statuses (Failed, Reversed, Pending) are real statement
    entries but are not customer payments, so they're excluded up front
    rather than being eligible for matching."""
    txns = []
    with open(path, newline="") as f:
        for row in csv.DictReader(f):
            status = row["Transaction Status"].strip()
            paid_in = row["Paid In"].strip()
            if status.lower() != "completed" or not paid_in:
                continue
            txns.append({
                "receipt_no": row["Receipt No."],
                "completion_time": row["Completion Time"],
                "details": row["Details"],
                "phone_normalized": extract_phone_from_details(row["Details"]),
                "amount_paid": float(paid_in),
            })
    return txns


def reconcile(orders, txns, abs_tolerance, pct_tolerance):
    """Two-pass matching, one order <-> one transaction:

      Pass 1 - exact amount matches, grouped by phone. Resolved first so an
               exact match is never stolen by a looser fuzzy match for a
               different order sharing the same phone.
      Pass 2 - fuzzy amount matches (within tolerance), for whatever's left.

    Both passes only ever consider transactions whose normalized phone
    equals the order's normalized phone - phone number is never fuzzy,
    only its formatting is normalized away. Each transaction can satisfy
    at most one order.
    """
    unmatched_txns = list(txns)
    matched = []
    unmatched_orders = []

    def find_by_phone(phone):
        return [t for t in unmatched_txns if t["phone_normalized"] == phone]

    remaining_orders = list(orders)

    for exact in (True, False):
        still_remaining = []
        for order in remaining_orders:
            if order["phone_normalized"] is None:
                still_remaining.append(order)
                continue
            candidates = find_by_phone(order["phone_normalized"])
            hit = None
            for t in candidates:
                if exact and t["amount_paid"] == order["amount_expected"]:
                    hit = t
                    break
                if not exact and amounts_match(order["amount_expected"], t["amount_paid"], abs_tolerance, pct_tolerance):
                    hit = t
                    break
            if hit:
                unmatched_txns.remove(hit)
                matched.append({**order, "txn": hit})
            else:
                still_remaining.append(order)
        remaining_orders = still_remaining

    for order in remaining_orders:
        note = "No payment found from this phone number."
        if order["phone_normalized"] is not None:
            same_phone_leftover = [t for t in txns if t["phone_normalized"] == order["phone_normalized"]]
            if same_phone_leftover:
                t = same_phone_leftover[0]
                diff = t["amount_paid"] - order["amount_expected"]
                note = (
                    f"Payment of KES {t['amount_paid']:,.0f} received from this phone "
                    f"(receipt {t['receipt_no']}) but differs from the expected "
                    f"KES {order['amount_expected']:,.0f} by KES {diff:,.0f} - too large "
                    f"to be a fee. Check whether this was a partial/deposit payment."
                )
        unmatched_orders.append({**order, "note": note})

    return matched, unmatched_orders, unmatched_txns


def write_csv_report(path, matched, unmatched_orders, unmatched_txns):
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Category", "Order ID", "Customer Name", "Phone Number", "Amount Expected",
                     "Receipt No.", "Completion Time", "Amount Paid", "Difference", "Notes"])
        for m in matched:
            diff = m["txn"]["amount_paid"] - m["amount_expected"]
            w.writerow(["Matched", m["order_id"], m["customer_name"], m["phone_raw"],
                        f"{m['amount_expected']:.0f}", m["txn"]["receipt_no"], m["txn"]["completion_time"],
                        f"{m['txn']['amount_paid']:.0f}", f"{diff:.0f}",
                        "Exact match" if diff == 0 else "Matched within fee tolerance"])
        for o in unmatched_orders:
            w.writerow(["Unmatched Order", o["order_id"], o["customer_name"], o["phone_raw"],
                        f"{o['amount_expected']:.0f}", "", "", "", "", o["note"]])
        for t in unmatched_txns:
            w.writerow(["Unmatched Transaction", "", "", "", "",
                        t["receipt_no"], t["completion_time"], f"{t['amount_paid']:.0f}", "",
                        f"Payment received ({t['details']}) with no matching order - "
                        f"possible new customer or wrong reference."])


def write_html_report(path, matched, unmatched_orders, unmatched_txns, abs_tolerance, pct_tolerance):
    def esc(s):
        return html.escape(str(s))

    total_expected = sum(o["amount_expected"] for o in matched + unmatched_orders)
    total_matched = sum(m["txn"]["amount_paid"] for m in matched)
    total_unmatched_txn = sum(t["amount_paid"] for t in unmatched_txns)

    def row(cells):
        return "<tr>" + "".join(f"<td>{esc(c)}</td>" for c in cells) + "</tr>"

    matched_rows = "".join(
        row([
            m["order_id"], m["customer_name"], m["phone_raw"],
            f"KES {m['amount_expected']:,.0f}", m["txn"]["receipt_no"],
            f"KES {m['txn']['amount_paid']:,.0f}",
            "Exact" if m["txn"]["amount_paid"] == m["amount_expected"] else "Within fee tolerance",
        ]) for m in matched
    )
    unmatched_order_rows = "".join(
        row([o["order_id"], o["customer_name"], o["phone_raw"], f"KES {o['amount_expected']:,.0f}", o["note"]])
        for o in unmatched_orders
    )
    unmatched_txn_rows = "".join(
        row([t["receipt_no"], t["completion_time"], t["details"], f"KES {t['amount_paid']:,.0f}"])
        for t in unmatched_txns
    )

    html_doc = f"""<!doctype html>
<html><head><meta charset="utf-8"><title>M-Pesa Reconciliation Report</title>
<style>
  body {{ font-family: -apple-system, Segoe UI, Roboto, sans-serif; margin: 2rem; color: #1a1a1a; background: #fafafa; }}
  h1 {{ margin-bottom: 0.25rem; }}
  .subtitle {{ color: #666; margin-top: 0; }}
  .summary {{ display: flex; gap: 1rem; margin: 1.5rem 0; flex-wrap: wrap; }}
  .card {{ background: white; border-radius: 8px; padding: 1rem 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); min-width: 160px; }}
  .card .num {{ font-size: 1.6rem; font-weight: 700; }}
  .card .label {{ color: #666; font-size: 0.85rem; }}
  .matched .num {{ color: #1a7f37; }}
  .unmatched .num {{ color: #b45309; }}
  .orphan .num {{ color: #b91c1c; }}
  h2 {{ margin-top: 2.5rem; }}
  table {{ border-collapse: collapse; width: 100%; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
  th, td {{ text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #eee; font-size: 0.9rem; }}
  th {{ background: #f0f0f0; }}
  tr:last-child td {{ border-bottom: none; }}
  .empty {{ color: #888; font-style: italic; padding: 0.75rem; }}
  .note {{ color: #666; font-size: 0.85rem; margin-top: 2rem; }}
</style></head>
<body>
  <h1>M-Pesa Reconciliation Report</h1>
  <p class="subtitle">Matching customer orders against the M-Pesa statement (phone number + amount, with tolerance for fees and formatting).</p>

  <div class="summary">
    <div class="card matched"><div class="num">{len(matched)}</div><div class="label">Orders matched (paid)</div></div>
    <div class="card unmatched"><div class="num">{len(unmatched_orders)}</div><div class="label">Orders unmatched (unpaid)</div></div>
    <div class="card orphan"><div class="num">{len(unmatched_txns)}</div><div class="label">Payments with no order</div></div>
    <div class="card"><div class="num">KES {total_matched:,.0f}</div><div class="label">Confirmed revenue</div></div>
    <div class="card"><div class="num">KES {total_expected - total_matched:,.0f}</div><div class="label">Outstanding</div></div>
    <div class="card"><div class="num">KES {total_unmatched_txn:,.0f}</div><div class="label">Unclaimed payments</div></div>
  </div>

  <h2>Matched Orders (confirmed paid)</h2>
  <table>
    <tr><th>Order ID</th><th>Customer</th><th>Phone</th><th>Expected</th><th>Receipt No.</th><th>Paid</th><th>Match Type</th></tr>
    {matched_rows or '<tr><td colspan="7" class="empty">None</td></tr>'}
  </table>

  <h2>Unmatched Orders (no payment found)</h2>
  <table>
    <tr><th>Order ID</th><th>Customer</th><th>Phone</th><th>Expected</th><th>Notes</th></tr>
    {unmatched_order_rows or '<tr><td colspan="5" class="empty">None</td></tr>'}
  </table>

  <h2>Unmatched Transactions (payment received, no matching order)</h2>
  <table>
    <tr><th>Receipt No.</th><th>Completion Time</th><th>Details</th><th>Paid In</th></tr>
    {unmatched_txn_rows or '<tr><td colspan="4" class="empty">None</td></tr>'}
  </table>

  <p class="note">Matching rules: phone numbers are normalized to their 9-digit national number
  (so +254, 254 and 0-prefixed forms, with or without spaces, all compare equal); amounts are
  considered a match within KES {abs_tolerance:.0f} or {pct_tolerance * 100:.0f}% of the expected
  amount (whichever is larger), to absorb M-Pesa transaction fees.</p>
</body></html>
"""
    Path(path).write_text(html_doc)


def print_summary(matched, unmatched_orders, unmatched_txns):
    total_expected = sum(o["amount_expected"] for o in matched + unmatched_orders)
    total_matched = sum(m["txn"]["amount_paid"] for m in matched)
    total_unmatched_txn = sum(t["amount_paid"] for t in unmatched_txns)

    print("\n=== M-Pesa Reconciliation Summary ===")
    print(f"Orders matched (paid):        {len(matched)}")
    print(f"Orders unmatched (unpaid):    {len(unmatched_orders)}")
    print(f"Payments with no order:       {len(unmatched_txns)}")
    print(f"Confirmed revenue:            KES {total_matched:,.0f}")
    print(f"Outstanding (unpaid orders):  KES {total_expected - total_matched:,.0f}")
    print(f"Unclaimed payments:           KES {total_unmatched_txn:,.0f}")

    if unmatched_orders:
        print("\n--- Orders to chase up ---")
        for o in unmatched_orders:
            print(f"  {o['order_id']} ({o['customer_name']}, {o['phone_raw']}): {o['note']}")

    if unmatched_txns:
        print("\n--- Payments needing investigation ---")
        for t in unmatched_txns:
            print(f"  {t['receipt_no']}: KES {t['amount_paid']:,.0f} - {t['details']}")


def main():
    here = Path(__file__).parent
    parser = argparse.ArgumentParser(description="Reconcile customer orders against an M-Pesa statement.")
    parser.add_argument("--orders", default=here / "sample_data" / "orders.csv")
    parser.add_argument("--statement", default=here / "sample_data" / "mpesa_statement.csv")
    parser.add_argument("--output-dir", default=here / "output")
    parser.add_argument("--amount-tolerance-abs", type=float, default=DEFAULT_ABS_TOLERANCE,
                         help=f"Flat KES tolerance for amount matching (default {DEFAULT_ABS_TOLERANCE})")
    parser.add_argument("--amount-tolerance-pct", type=float, default=DEFAULT_PCT_TOLERANCE,
                         help=f"Percentage tolerance for amount matching (default {DEFAULT_PCT_TOLERANCE})")
    args = parser.parse_args()

    orders = load_orders(args.orders)
    txns = load_transactions(args.statement)
    matched, unmatched_orders, unmatched_txns = reconcile(
        orders, txns, args.amount_tolerance_abs, args.amount_tolerance_pct
    )

    output_dir = Path(args.output_dir)
    output_dir.mkdir(exist_ok=True)
    csv_path = output_dir / "reconciliation_report.csv"
    html_path = output_dir / "reconciliation_report.html"
    write_csv_report(csv_path, matched, unmatched_orders, unmatched_txns)
    write_html_report(html_path, matched, unmatched_orders, unmatched_txns,
                       args.amount_tolerance_abs, args.amount_tolerance_pct)

    print_summary(matched, unmatched_orders, unmatched_txns)
    print(f"\nCSV report:  {csv_path}")
    print(f"HTML report: {html_path}")


if __name__ == "__main__":
    main()
