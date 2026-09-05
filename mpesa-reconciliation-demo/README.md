# M-Pesa Payment Reconciliation Demo

A small, self-contained demo tool: match a business's customer order list
against an M-Pesa statement export, and get a clear report of what's paid,
what's outstanding, and what payments don't belong to any known order.

This is a **demo for a Fiverr gig**, not production software - no real
client data, no external services, just Python's standard library.

## Quick start

```bash
cd mpesa-reconciliation-demo

# (optional) regenerate the mock sample data
python3 generate_sample_data.py

# run the reconciliation
python3 reconcile.py
```

That's it - no dependencies to install. It reads the bundled sample data
in `sample_data/` and writes two reports to `output/`:

- `reconciliation_report.csv` - one row per order/transaction, easy to open in Excel
- `reconciliation_report.html` - a styled, presentable report you can open in a browser to demo live

It also prints a summary straight to the terminal.

### Running against your own data

```bash
python3 reconcile.py --orders my_orders.csv --statement my_statement.csv --output-dir my_output
```

Your CSVs need to match these column headers exactly:

**Orders CSV:** `Order ID, Customer Name, Phone Number, Amount Expected, Date`

**M-Pesa statement CSV:** `Receipt No., Completion Time, Details, Transaction Status, Paid In, Withdrawn, Balance`
(this matches the columns in a real Safaricom M-Pesa statement export)

## How the matching works (for talking to clients)

The core problem: an order and a payment describing "the same" transaction
almost never look byte-for-byte identical, for two reasons.

**1. Phone number formatting differs between the order form and the statement.**
A customer's number might be entered as `0712345678` on the order sheet, but
the M-Pesa statement's `Details` text says `254712345678`. Someone might
type `+254 712 345 678` with spaces. All of these are the same phone
number. The script strips everything down to the 9-digit national number
(dropping the `0` / `254` / `+254` prefix and any spaces or punctuation)
before comparing, so all formats line up.

**2. M-Pesa fees can shave a few shillings off the amount that lands in
the account.** If a customer owes KES 2,500 and pays via M-Pesa, the
amount that shows up as "Paid In" might be KES 2,467 - the difference is
a transaction fee, not a discount or an error. The script treats two
amounts as matching if they're within a tolerance window: a flat KES 50
**or** 2% of the expected amount, whichever is larger (both configurable
via `--amount-tolerance-abs` / `--amount-tolerance-pct`). That's generous
enough to absorb typical fees without being so loose that it hides real
discrepancies.

**Phone number is never fuzzy - only its formatting is.** The script only
ever matches an order to a transaction from the *same* phone number
(after normalizing format). It never matches on amount alone, since two
different customers could easily owe the same amount. If a payment comes
in from the right phone number but the amount is way off - e.g. a
customer sent a deposit instead of the full amount - it is **not**
silently matched. It's left as an unmatched order with a note pointing
you to the actual transaction, so a human decides what happened rather
than the tool guessing.

**Matching order:** exact amount matches are resolved first, then fuzzy
(within-tolerance) matches for what's left. Each transaction can satisfy
at most one order, so one payment is never counted against two different
orders.

**What's deliberately excluded from matching:** the statement's
`Withdrawn` rows (money the business paid out - not a customer payment)
and any transaction whose `Transaction Status` isn't `Completed` (e.g.
`Failed`, `Reversed`). Those are real rows in the statement, but they
aren't payments received, so they never enter the matching pool.

## The three report sections

- **Matched Orders** - an order and a statement payment agree on phone
  number and amount (exactly or within fee tolerance). Confirmed paid.
- **Unmatched Orders** - no payment found for this order at all, or a
  payment came from the right phone but the amount doesn't reconcile
  (flagged for manual review, with the details of what was found).
- **Unmatched Transactions** - a completed payment came in that doesn't
  match any order on file. Could be a new customer who paid without
  referencing an order, or someone who quoted the wrong amount/reference.

## Sample data

`generate_sample_data.py` builds a realistic 15-order dataset (fixed
random seed, so it's reproducible) that deliberately covers every case
above: exact matches, phone format variations, fee-adjusted amounts, an
unpaid order, a deposit-only mismatch, orphan payments, a withdrawal, and
a reversed transaction. Good talking points for a live demo.
