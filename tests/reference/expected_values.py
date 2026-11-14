"""
Independent expected values for tests/mortgageCalculator.test.mjs.

These are computed here, in Python with exact decimal arithmetic, from textbook
definitions. They do not import or mirror the JavaScript implementation:

  - Payment: the level-payment annuity formula  P * i / (1 - (1 + i)^-n),
    with i = annual rate / 12 and n = months. At 0% it is P / n.
  - Schedule: each month, interest = balance * i, principal = payment - interest.
    Total interest and the first month the balance reaches 78% of the original
    value are read off that month-by-month schedule.
  - APR: the rate at which the present value of the payment stream equals the
    amount financed (loan minus prepaid finance charges), solved by bisection.

Run:  python3 tests/reference/expected_values.py
The printed numbers are pasted into the test file as literals. Re-run and
compare if a test's expected value is ever questioned.
"""
from decimal import Decimal as D, getcontext

getcontext().prec = 50


def payment(principal, annual_pct, years):
    n = years * 12
    if D(annual_pct) == 0:
        return D(principal) / n
    i = D(annual_pct) / 100 / 12
    return D(principal) * i / (1 - (1 + i) ** (-n))


def schedule(principal, annual_pct, years, extra=0, annual_extra=0):
    """extra: added to principal every month. annual_extra: added once a year, in month 12, 24, ..."""
    pay = payment(principal, annual_pct, years)
    i = D(annual_pct) / 100 / 12
    bal = D(principal)
    total_interest = D(0)
    months = 0
    while bal > D("0.005") and months < years * 12:
        interest = bal * i
        princ = pay - interest + D(extra)
        if (months + 1) % 12 == 0:
            princ += D(annual_extra)
        if princ > bal:
            princ = bal
        bal -= princ
        total_interest += interest
        months += 1
    return pay, total_interest, months


def first_month_at_or_below(principal, annual_pct, years, threshold_balance):
    pay = payment(principal, annual_pct, years)
    i = D(annual_pct) / 100 / 12
    bal = D(principal)
    for m in range(1, years * 12 + 1):
        bal -= pay - bal * i
        if bal <= D(threshold_balance):
            return m
    return None


def apr(loan, prepaid, note_pct, years, monthly_mi=0, mi_months=0):
    n = years * 12
    pay = payment(loan, note_pct, years)
    target = D(loan) - D(prepaid)

    def pv(annual_pct):
        i = D(annual_pct) / 100 / 12
        total = D(0)
        for m in range(1, n + 1):
            cash = pay + (D(monthly_mi) if m <= mi_months else D(0))
            total += cash / (1 + i) ** m
        return total

    lo, hi = D(note_pct), D(note_pct) * 4
    for _ in range(200):
        mid = (lo + hi) / 2
        if pv(mid) > target:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


if __name__ == "__main__":
    q = lambda x, p="0.01": D(x).quantize(D(p))
    print("PAYMENTS")
    for P, r, y in [(300000, "6.5", 30), (300000, "6.5", 15), (200000, "7", 30),
                    (400000, "3", 30), (360000, "0", 30), (250000, "10", 30),
                    (300000, "15", 30), (337750, "6.75", 30), ("343660.625", "6.75", 30),
                    ("345011.625", "6.75", 30), ("341127.5", "6.75", 30)]:
        print(f"  {P} @ {r}% {y}y -> {q(payment(P, r, y))}")
    print("SCHEDULES (payment, total interest, payoff month)")
    for P, r, y, extra in [(300000, "6.5", 30, 0), (300000, "6.5", 30, 200), (300000, "6.5", 15, 0)]:
        pay, ti, m = schedule(P, r, y, extra)
        print(f"  {P} @ {r}% {y}y extra {extra} -> pay {q(pay)} interest {q(ti, '1')} months {m}")
    pay, ti, m = schedule(300000, "6.5", 30, annual_extra=2400)
    print(f"  300000 @ 6.5% 30y, 2400 once a year -> interest {q(ti, '1')} months {m}")
    # "Bi-weekly" as the calculator defines it: 26 half-payments a year is one
    # extra full payment a year, modeled as payment/12 added every month.
    base = payment(300000, "6.5", 30)
    pay, ti, m = schedule(300000, "6.5", 30, extra=base / 12)
    print(f"  300000 @ 6.5% 30y, one extra payment a year spread monthly -> interest {q(ti, '1')} months {m}")
    print("PMI 78% MONTH (first month the end-of-month balance is at or below 78% of value)")
    # $350,000 price, 5% down -> $332,500 loan; 78% of value = $273,000
    print("  332500 @ 6.75% 30y, 78% of 350000 ->", first_month_at_or_below(332500, "6.75", 30, 273000))
    print("  337750 @ 6.75% 30y, 78% of 350000 ->", first_month_at_or_below(337750, "6.75", 30, 273000))
    print("APR")
    print("  300000, 0 prepaid, 6.5%, 30y ->", q(apr(300000, 0, "6.5", 30), "0.001"))
    print("  300000, 6000 prepaid, 6.5%, 30y ->", q(apr(300000, 6000, "6.5", 30), "0.001"))
    print("  300000, 6000 prepaid, 6.5%, 30y, MI 130/mo x 100 ->", q(apr(300000, 6000, "6.5", 30, 130, 100), "0.001"))
