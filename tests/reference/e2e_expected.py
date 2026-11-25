"""
Independent expected values for the calculator browser tests
(tests/e2e/calculator.*.spec.ts). Writes tests/e2e/fixtures/expected.json.

Run:  python3 tests/reference/e2e_expected.py
CI regenerates the file and fails if it differs from the committed copy, so the
JSON can never be hand-edited to make a test pass.

Nothing here imports or mirrors the JavaScript. Each rule cites where it comes from:

  P&I          level-payment annuity  P * i / (1 - (1 + i)^-n), i = rate/12, n = months; P/n at 0%.
  FHA          HUD Mortgagee Letter 2023-05, Appendix 1.0 (case numbers endorsed on or after
               2023-03-20), read 2026-11-25: UFMIP 1.75% of the base loan; annual MIP by term,
               base loan and LTV (FHA_MIP below). Minimum 3.5% down (HUD, 580+ credit score).
  VA           va.gov "VA funding fee and loan closing costs", effective 2023-04-07, read
               2026-11-25: first use 2.15 / 1.5 / 1.25%, after first use 3.3 / 1.5 / 1.25%
               (under 5% / 5% or more / 10% or more down); exempt (service-connected
               disability) 0%. No monthly mortgage insurance.
  USDA         1.00% upfront guarantee fee, 0.35% annual fee, 30-year fixed only.
               UNVERIFIED for FY2026: the USDA pages refused automated access. Owner to confirm.
  Conventional PMI tiers are the SITE'S OWN ASSUMPTION (the page says "PMI est. based on 740+
               FICO, <43% DTI"); there is no regulated rate. Used here as a stated input:
               under 5% down 0.52%, 5% to 9.99% 0.37%, 10% to 19.99% 0.27%, 20%+ none.
               Minimum 3% down (Fannie Mae / Freddie Mac 97% LTV programs).
  Monthly MI   annual rate x base loan / 12 (first-year level amount; the site's documented
               convention, a common simplification of the average-balance method).
  Escrow       taxes, insurance and HOA are typed into the page as fixed dollar amounts, so
               the site's default tax rate and insurance factor are never needed here.
  Display      whole dollars, half rounded away from zero (Intl.NumberFormat, en-US).
               A scenario whose cents land within $0.01 of .50 is REFUSED: a test there could
               pass or fail on floating-point noise.

Known defects: where the app is documented as wrong (QA_DEFECT_LOG.md D-5, D-6), the
scenario records BOTH the correct value (from the source) and the app's documented
behavior, marked with the defect ID. Tests assert the app's behavior as a
characterization and print the correct value, until the defect is fixed.
"""
import json
from decimal import Decimal as D, ROUND_HALF_UP, getcontext
from pathlib import Path

getcontext().prec = 50
ONE_EIGHTH = D("0.125")

# HUD ML 2023-05 Appendix 1.0: (max_term_years, base_loan_limit) -> [(max_ltv, bps)]
HIGH_BALANCE = D("726200")
FHA_MIP = {
    "long_standard": [(D("90"), 50), (D("95"), 50), (D("100"), 55)],
    "long_high": [(D("90"), 70), (D("95"), 70), (D("100"), 75)],
    "short_standard": [(D("90"), 15), (D("100"), 40)],
    "short_high": [(D("78"), 15), (D("90"), 40), (D("100"), 65)],
}


def fha_annual_mip_pct(term, base_loan, ltv):
    key = ("short" if term <= 15 else "long") + ("_high" if base_loan > HIGH_BALANCE else "_standard")
    for max_ltv, bps in FHA_MIP[key]:
        if ltv <= max_ltv:
            return D(bps) / 100
    raise ValueError("LTV above 100%")


def fha_app_mip_pct(down_pct):
    """The app's DOCUMENTED DEFECTIVE behavior (D-5, D-6): the 30-year standard-size row
    applied to every loan. Written from the defect description, not from the JS."""
    return D("0.55") if D(down_pct) < 5 else D("0.5")


def va_fee_pct(usage, down_pct):
    if usage == "exempt":
        return D(0)
    d = D(down_pct)
    if d >= 10:
        return D("1.25")
    if d >= 5:
        return D("1.5")
    return D("2.15") if usage == "first" else D("3.3")


def conventional_pmi_pct(down_pct):
    d = D(down_pct)
    if d >= 20:
        return D(0)
    if d >= 10:
        return D("0.27")
    if d >= 5:
        return D("0.37")
    return D("0.52")


def payment(principal, annual_pct, years):
    n = years * 12
    if D(annual_pct) == 0:
        return D(principal) / n
    i = D(annual_pct) / 100 / 12
    return D(principal) * i / (1 - (1 + i) ** (-n))


def starting_rate(api_rate):
    """Documented rule (page disclaimer): round to the nearest 0.125%, then add 0.125%."""
    steps = (D(api_rate) / ONE_EIGHTH).quantize(D(1), rounding=ROUND_HALF_UP)
    return steps * ONE_EIGHTH + ONE_EIGHTH


class Ambiguous(Exception):
    pass


def dollars(x, where):
    x = D(x)
    cents = (x - x.to_integral_value(rounding="ROUND_FLOOR")) * 100
    if abs(cents - 50) < 1:
        raise Ambiguous(f"{where}: {x} is within $0.01 of a rounding boundary")
    whole = int(x.quantize(D(1), rounding=ROUND_HALF_UP))
    return f"${whole:,}"


def cents(x):
    """Exact dollars and cents, for documentation fields that tests do not assert."""
    return f"${D(x).quantize(D('0.01'), rounding=ROUND_HALF_UP):,}"


def pct_label(p):
    """How the page prints a rate inside a label, e.g. 0.5 -> '0.5', 2.15 -> '2.15'."""
    s = format(D(p).normalize(), "f")
    return s


def program_result(program, s):
    price, down_pct, term = D(s["price"]), D(s["downPct"]), s["term"]
    rate = D(s["rates"][program])
    base = price - price * down_pct / 100
    ltv = base / price * 100
    escrow = D(s["taxes"]) + D(s["insurance"]) + D(s.get("hoa", 0))
    out = {"rate": f"{rate:.3f}"}

    if program == "Conventional":
        if down_pct < 3:
            return {"eligible": False, "reason": "Minimum 3% Down Required"}
        mi_pct, upfront, upfront_label = conventional_pmi_pct(down_pct), D(0), None
        mi_label = f"PMI ({pct_label(mi_pct)}%)" if mi_pct > 0 else None
    elif program == "FHA":
        if down_pct < D("3.5"):
            return {"eligible": False, "reason": "Minimum 3.5% Down Required"}
        mi_pct = fha_annual_mip_pct(term, base, ltv)
        upfront, upfront_label = base * D("0.0175"), "UFMIP (1.75%)"
        mi_label = f"MIP ({pct_label(mi_pct)}%)"
        app_pct = fha_app_mip_pct(down_pct)
        if app_pct != mi_pct:
            defect = "D-5" if term <= 15 else "D-6"
            loan = base + upfront
            app_mi = base * app_pct / 100 / 12
            app_total = payment(loan, rate, term) + app_mi + escrow
            out["knownDefect"] = {
                "id": defect,
                # Documentation of the gap, exact to the cent:
                "correct": {"miLabel": mi_label, "mi": cents(base * mi_pct / 100 / 12),
                            "total": cents(payment(loan, rate, term) + base * mi_pct / 100 / 12 + escrow)},
                # What the page shows today (asserted by the characterization test):
                "app": {"miLabel": f"MIP ({pct_label(app_pct)}%)", "mi": cents(app_mi),
                        "total": dollars(app_total, f"{s['id']} {program} app total")},
            }
    elif program == "VA":
        fee = va_fee_pct(s.get("vaUsage", "first"), down_pct)
        mi_pct, upfront = D(0), base * fee / 100
        upfront_label = f"Funding Fee ({pct_label(fee)}%)" if fee > 0 else None
        mi_label = None
    elif program == "USDA":
        if term != 30:
            return {"eligible": False, "reason": "USDA 30-Year Only"}
        mi_pct, upfront, upfront_label = D("0.35"), base * D("0.01"), "Guarantee Fee (1.00%)"
        mi_label = "Annual Fee (0.35%)"
    else:
        raise ValueError(program)

    loan = base + upfront
    pi = payment(loan, rate, term)
    mi = base * mi_pct / 100 / 12
    total = pi + mi + escrow
    where = f"{s['id']} {program}"
    ambiguous = []

    def secondary(name, value):
        """Breakdown lines: a value on a rounding boundary is recorded as ambiguous
        (tests skip it) instead of guessing which way JavaScript's float lands."""
        try:
            return dollars(value, f"{where} {name}")
        except Ambiguous:
            ambiguous.append(name)
            return None

    out.update({
        "eligible": True,
        "baseLoan": secondary("baseLoan", base),
        "totalLoan": secondary("totalLoan", loan),
        "pi": secondary("pi", pi),
        "mi": secondary("mi", mi) if mi > 0 else None,
        "miLabel": mi_label,
        "upfront": secondary("upfront", upfront) if upfront > 0 else None,
        "upfrontLabel": upfront_label,
        "total": dollars(total, where + " total"),  # the headline number: never ambiguous
        "ambiguous": ambiguous,
    })
    return out


# Rates the calculator starts with when /api/rates answers with tests/e2e/fixtures/rates.json
FIXTURE_API = {"Conventional30": "6.41", "Conventional15": "5.62", "FHA": "6.10", "VA": "5.95"}
FIXTURE_RATES_30 = {
    "Conventional": starting_rate(FIXTURE_API["Conventional30"]),
    "FHA": starting_rate(FIXTURE_API["FHA"]),
    "VA": starting_rate(FIXTURE_API["VA"]),
    "USDA": starting_rate(FIXTURE_API["FHA"]),  # owner's rule: USDA always follows FHA
}

ESCROW = {"taxes": 300, "insurance": 100}


def scenario(id, title, price, downPct, term=30, rates=None, vaUsage="first", **extra):
    return {"id": id, "title": title, "price": price, "downPct": downPct, "term": term,
            "rates": {k: str(v) for k, v in (rates or FIXTURE_RATES_30).items()},
            "vaUsage": vaUsage, **ESCROW, **extra}


SCENARIOS = [
    scenario("A1", "defaults: $350,000, 3.5% down, 30 years, fixture rates", 350000, "3.5"),
    scenario("A2", "link with settings: $400,000, 10% down, 15 years, FHA at 6%", 400000, "10", term=15,
             rates={"Conventional": starting_rate(FIXTURE_API["Conventional15"]), "FHA": "6",
                    "VA": FIXTURE_RATES_30["VA"], "USDA": FIXTURE_RATES_30["USDA"]},
             url="/calculator?price=400000&down=10&term=15&program=FHA&rate=6&tax=300&insurance=100"),
    scenario("A4", "0% interest: P&I is the loan divided by 360", 360000, "20",
             rates={"Conventional": "0", "FHA": "0", "VA": "0", "USDA": "0"}),
    scenario("D6", "high-balance FHA: $900,000, 10% down (base loan $810,000)", 900000, "10"),
]
# Boundary value analysis on the down payment, one scenario per edge, both sides.
for d in ["2.99", "3", "3.49", "3.5", "4.99", "5", "9.99", "10", "19.99", "20"]:
    SCENARIOS.append(scenario(f"BVA-{d}", f"down payment {d}% on $400,000", 400000, d))
for usage in ["first", "subsequent", "exempt"]:
    SCENARIOS.append(scenario(f"VA-{usage}", f"VA {usage} use, 0% down, $400,000", 400000, "0", vaUsage=usage))


def build():
    out = []
    for s in SCENARIOS:
        programs = {p: program_result(p, s) for p in ["Conventional", "FHA", "VA", "USDA"]}
        out.append({**s, "expected": programs})
    return {"_generated_by": "tests/reference/e2e_expected.py (do not edit by hand)", "scenarios": out}


if __name__ == "__main__":
    path = Path(__file__).resolve().parents[1] / "e2e" / "fixtures" / "expected.json"
    path.write_text(json.dumps(build(), indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {path.relative_to(Path.cwd()) if path.is_relative_to(Path.cwd()) else path}")
