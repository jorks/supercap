# SuperCap

An Australian salary sacrifice planning calculator. You give it your salary, any pay
rise, any bonus and what you have already contributed, and it tells you how much to
sacrifice per pay to land just under your concessional contributions cap, then writes
the email to send to payroll.

It is a single folder of static files. There is no build step, no package manager and
no server.

## Running it

Open `index.html` in a modern browser. That is the whole thing.

Double-clicking the file works. So does dragging it onto a browser window. It runs from
`file://` and works with no network connection.

## Privacy

Nothing leaves your browser. There is no analytics, no telemetry and no network request
of any kind. The page loads only its own files.

Your figures are saved to `localStorage` so the page remembers them when you come back.
"Reset all data" in the header clears that immediately. If you would rather it never
saved anything, use a private window.

## File structure

The app itself sits at the root, so you can open `index.html` and go. Supporting files
live in `dev/`.

```
index.html            markup and templates
styles.css            the whole visual system
calculations.js       the calculation engine: pure functions, no DOM
app.js                state, rendering, the slider, the email generator
data.generated.js     tax and super rules as a script tag (generated, committed)
dev/data.json         the same rules in the form humans edit
dev/tests.html        the test suite in a browser
dev/tests.js          the tests themselves
dev/sync-data.mjs     regenerates data.generated.js from data.json
dev/run-tests.mjs     runs tests.js from the command line
```

`calculations.js` knows nothing about the DOM and `app.js` does no arithmetic. That
split is deliberate: it is what lets the same engine run under both `dev/tests.html` and
Node without a browser.

## How the calculation works

1. **Salary is pro-rated by calendar day.** If you get a rise part-way through the year,
   SuperCap counts the actual days at each rate rather than splitting by month. A rise on
   1 September is 62 days at the old salary and 303 at the new, not "two months and ten".
2. **Employer super is calculated on that pro-rated salary**, capped by the maximum
   contribution base where one applies, plus super on the bonus if it is paid in the year.
3. **Everything already counted is added up** (employer super, salary sacrifice you have
   already made, personal deductible contributions) and subtracted from the general cap.
4. **What is left is divided by the pays you have remaining**, less a safety buffer, and
   rounded down to a whole dollar. Rounding down means rounding can never push you over.
   Confirmed carry-forward room extends the slider, but is not included in the recommended
   amount automatically.

All money is held internally as integer cents, so no figure is ever the victim of
floating point. Dates are ISO strings compared as UTC day numbers, so nothing shifts
around daylight saving.

## How payroll anchoring works

SuperCap does not guess your pay cycle. You give it one real payday you know about (the
anchor) and how many days are between pays. Every other payday in the year is counted
forwards and backwards from that anchor.

This is why it handles the years with 27 fortnightly pays instead of 26 without being
told: it counts the paydays that actually fall inside the financial year rather than
assuming a number.

Pays on or before your "calculate as at" date are treated as already processed, so the
recommendation only spreads across deductions you can still change.

## Updating the rules

`dev/data.json` is the file humans edit. Rates, caps, thresholds and tax brackets all live
there, one block per financial year.

Because the app runs from `file://`, where `fetch()` is blocked, the browser reads the
rules from `data.generated.js` instead. After editing `dev/data.json`:

```
node dev/sync-data.mjs
```

Then commit both files. `node dev/sync-data.mjs --check` verifies the generated file is
current without writing, which is useful before sharing a copy.

The script also validates as it goes: it will refuse to generate if the tax brackets have
a gap, a financial year has the wrong start date, or a cap is negative. It warns, but
does not block, when the maximum contribution base does not match what the cap and SG
rate imply, since that mismatch usually means one of the two was updated alone.

**Values that are indexed each year are `null` until the ATO publishes them.** Never
substitute last year's figure. When a cap is `null`, SuperCap says so and asks the user to
enter it rather than quietly calculating against a wrong number.

## Running the tests

In a browser, open `dev/tests.html`.

From a terminal, if you have Node:

```
node dev/run-tests.mjs
```

Same suite either way. It covers the money and date helpers, payday generation, calendar
pro-rating, the maximum contribution base, cap usage, the recommendation, the slider
projection, and the FY2026-27 fixture from the brief.

## Known limitations

- **Australia only.** The rules, terminology and tax brackets are Australian, and there is
  no intention to generalise them.
- **The rules data is static.** Nothing updates itself. Check the figures against the ATO
  before relying on them. The header shows when the shipped data was last verified.
- **Indexed amounts for future years are unknown**, so those years need you to enter the
  cap manually.
- **Division 293 is flagged, not calculated.** If your income and contributions look like
  they cross the threshold, SuperCap tells you to check, and stops there.
- **A limited tax estimate, not a tax calculator.** SuperCap estimates the income-tax
  effect of salary sacrifice using resident rates and the 15% contributions tax, so it
  can show that sacrificing $200 in the 37% bracket only reduces take-home by about
  $126. It does not model Medicare levy, HELP debt, offsets, Division 293 amounts or
  other income.
- **Your employer's payroll is the source of truth.** Their pay dates, cut-offs and
  rounding will differ slightly from any model. That is what the safety buffer is for.

## Disclaimer

SuperCap is general information, not financial, tax or superannuation advice. It is a
planning aid built to save you a spreadsheet, not a substitute for advice from a
qualified adviser or from the ATO. Check the numbers before you act on them.

## Licence

SuperCap is open source under the [MIT Licence](LICENSE).

---

Made with love by [James Corcoran](https://github.com/jorks) · [LinkedIn](https://www.linkedin.com/in/jamescorc/)
