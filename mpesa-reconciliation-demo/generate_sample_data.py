#!/usr/bin/env python3
"""
Generates realistic mock data for the M-Pesa reconciliation demo:

  - sample_data/orders.csv           customer orders a small business is expecting payment for
  - sample_data/mpesa_statement.csv  a sample M-Pesa statement export covering those payments

The data is deliberately constructed to exercise every case the reconciler
has to handle, so the demo tells a complete story:

  - clean exact matches (phone + amount identical)
  - phone numbers written in different formats (+254, 0-prefix, spaces)
  - amounts that differ slightly because M-Pesa transaction fees shifted the total
  - an order with no payment at all (customer hasn't paid yet)
  - an order where a payment came in from the right phone but the amount is
    way off (e.g. a partial/deposit payment) - a case worth flagging for a human
  - two statement transactions with no matching order at all (new customer,
    or paid without a reference the business recognises)
  - a "Withdrawn" row (the business paying someone out) - not a customer
    payment at all, and must be ignored by the reconciler
  - a "Failed" transaction that shows Paid In money but never actually
    completed, and must also be ignored

Re-run this script any time you want a fresh random-looking dataset; it uses
a fixed seed so the demo is reproducible.
"""
import csv
import random
from pathlib import Path

random.seed(42)

OUT_DIR = Path(__file__).parent / "sample_data"
OUT_DIR.mkdir(exist_ok=True)

NAMES = [
    "John Kamau", "Jane Wanjiru", "Peter Otieno", "Grace Achieng",
    "Samuel Mwangi", "Mercy Njeri", "David Kiptoo", "Faith Wambui",
    "Brian Ochieng", "Ann Wangari", "Joseph Mutua", "Lucy Chebet",
    "Daniel Kimani", "Esther Nyambura", "Kevin Odhiambo",
]

RECEIPT_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # M-Pesa-style receipt codes


def receipt_no():
    return "".join(random.choice(RECEIPT_CHARS) for _ in range(10))


def national_number(i):
    """A 9-digit Safaricom-style national number (no leading 0/254)."""
    return f"7{10000000 + i * 137:08d}"[:9]


# Each row: (order_id, name, phone_as_written_by_customer, amount_expected,
#            day_offset, txn_amount_or_None, txn_status)
#
# txn_amount_or_None of None means "no matching transaction exists at all"
# (the customer hasn't paid). Where txn_amount differs from amount_expected,
# that's simulating an M-Pesa transaction fee shifting the total.
ROWS = [
    ("ORD-1001", NAMES[0], "0" + national_number(0), 2500, 1, 2500, "Completed"),           # exact match
    ("ORD-1002", NAMES[1], "+254" + national_number(1), 1800, 2, 1800, "Completed"),         # phone format differs (+254 vs 254)
    ("ORD-1003", NAMES[2], "0" + national_number(2), 2500, 3, 2467, "Completed"),            # fee shaved off the total
    ("ORD-1004", NAMES[3], "0712 345 678", 3200, 4, 3200, "Completed"),                       # spaces in phone
    ("ORD-1005", NAMES[4], "0" + national_number(4), 4500, 5, None, "Completed"),            # never paid
    ("ORD-1006", NAMES[5], "0" + national_number(5), 6000, 6, 3000, "Completed"),            # way off - looks like a deposit, needs a human
    ("ORD-1007", NAMES[6], "0" + national_number(6), 1500, 7, 1500, "Completed"),            # exact match
    ("ORD-1008", NAMES[7], "254" + national_number(7), 2200, 8, 2200, "Completed"),          # 254-prefix vs 0-prefix
    ("ORD-1009", NAMES[8], "0" + national_number(8), 3300, 9, 3267, "Completed"),            # small fee variance
    ("ORD-1010", NAMES[9], "0" + national_number(9), 900, 10, 900, "Completed"),             # exact match
    ("ORD-1011", NAMES[10], "0" + national_number(10), 5000, 11, 5000, "Completed"),         # exact match
    ("ORD-1012", NAMES[11], "0" + national_number(11), 2750, 12, None, "Completed"),         # never paid (said "bank transfer instead")
    ("ORD-1013", NAMES[12], "+254 " + national_number(12), 1200, 13, 1200, "Completed"),     # +254 with a space, exact amount
    ("ORD-1014", NAMES[13], "0" + national_number(13), 4100, 14, 4067, "Completed"),         # small fee variance
    ("ORD-1015", NAMES[14], "0" + national_number(14), 2000, 15, 2000, "Completed"),         # exact match
]


def to_statement_phone(raw):
    """Render a phone the way it'd typically appear inside M-Pesa's free-text
    'Details' field: digits only, 254-prefixed, no plus sign."""
    digits = "".join(ch for ch in raw if ch.isdigit())
    if digits.startswith("254"):
        return digits
    if digits.startswith("0"):
        return "254" + digits[1:]
    return "254" + digits


def write_orders():
    with open(OUT_DIR / "orders.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Order ID", "Customer Name", "Phone Number", "Amount Expected", "Date"])
        for order_id, name, phone, amount, day_offset, *_ in ROWS:
            date = f"2026-08-{day_offset:02d}"
            w.writerow([order_id, name, phone, amount, date])


def write_statement():
    txns = []
    for order_id, name, phone, amount, day_offset, txn_amount, status in ROWS:
        if txn_amount is None:
            continue
        stmt_phone = to_statement_phone(phone)
        txns.append({
            "Receipt No.": receipt_no(),
            "Completion Time": f"08/{day_offset:02d}/2026 {9 + (day_offset % 8)}:{(day_offset * 7) % 60:02d}:00",
            "Details": f"Customer Payment from {stmt_phone} - {name.upper()}",
            "Transaction Status": status,
            "Paid In": txn_amount,
            "Withdrawn": "",
            "Balance": "",
        })

    # Two payments received with no corresponding order at all - a new
    # customer who paid without contacting the business first, and someone
    # who quoted the wrong reference / paid for an order not in this batch.
    extra_people = [("Alice Nduta", national_number(20)), ("Moses Karanja", national_number(21))]
    for name, num in extra_people:
        completion_day = random.randint(1, 28)
        txns.append({
            "Receipt No.": receipt_no(),
            "Completion Time": f"08/{completion_day:02d}/2026 {10 + (completion_day % 6)}:{(completion_day * 3) % 60:02d}:00",
            "Details": f"Customer Payment from 254{num} - {name.upper()}",
            "Transaction Status": "Completed",
            "Paid In": random.choice([1500, 2600, 3400]),
            "Withdrawn": "",
            "Balance": "",
        })

    # A payout the business made to a supplier - money going OUT, not a
    # customer payment. The reconciler must ignore Withdrawn-only rows.
    txns.append({
        "Receipt No.": receipt_no(),
        "Completion Time": "08/15/2026 14:20:00",
        "Details": "Business Payment to 254798765432 - KIBANDA SUPPLIES LTD",
        "Transaction Status": "Completed",
        "Paid In": "",
        "Withdrawn": 5000,
        "Balance": "",
    })

    # A transaction that shows an amount but never actually completed -
    # must be ignored, not treated as a real payment.
    txns.append({
        "Receipt No.": receipt_no(),
        "Completion Time": "08/18/2026 16:05:00",
        "Details": f"Customer Payment from 254{national_number(0)} - {NAMES[0].upper()}",
        "Transaction Status": "Reversed",
        "Paid In": 2500,
        "Withdrawn": "",
        "Balance": "",
    })

    random.shuffle(txns)

    balance = 42000
    with open(OUT_DIR / "mpesa_statement.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Receipt No.", "Completion Time", "Details", "Transaction Status", "Paid In", "Withdrawn", "Balance"])
        for t in txns:
            if t["Transaction Status"] == "Completed":
                balance += t["Paid In"] or 0
                balance -= t["Withdrawn"] or 0
            t["Balance"] = balance
            w.writerow([t["Receipt No."], t["Completion Time"], t["Details"], t["Transaction Status"], t["Paid In"], t["Withdrawn"], t["Balance"]])


if __name__ == "__main__":
    write_orders()
    write_statement()
    print(f"Wrote {OUT_DIR / 'orders.csv'}")
    print(f"Wrote {OUT_DIR / 'mpesa_statement.csv'}")
