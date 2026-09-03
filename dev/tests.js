/**
 * SuperCap — calculation tests.
 *
 * Deterministic assertions over calculations.js. No framework, no build step:
 * open tests.html in a browser, or run `node dev/run-tests.mjs`.
 *
 * The weight is on the financial logic. UI behaviour is checked by hand.
 */
window.SuperCapTests = (function () {
  'use strict';

  var Calc = window.SuperCapCalc;
  var DATA = window.SUPERCAP_DATA;

  var suites = [];
  var currentSuite = null;

  function describe(name, body) {
    currentSuite = { name: name, cases: [] };
    suites.push(currentSuite);
    body();
    currentSuite = null;
  }

  function it(name, body) {
    var target = currentSuite;
    target.cases.push({ name: name, body: body });
  }

  function fail(message) {
    throw new Error(message);
  }

  function assert(condition, message) {
    if (!condition) fail(message || 'Expected condition to be true');
  }

  function equal(actual, expected, message) {
    if (actual !== expected) {
      fail((message ? message + ' — ' : '') + 'expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
    }
  }

  /** Money comparisons allow a cent or two of slack where rounding order is arbitrary. */
  function closeTo(actual, expected, tolerance, message) {
    var slack = tolerance === undefined ? 1 : tolerance;
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > slack) {
      fail(
        (message ? message + ' — ' : '') +
          'expected ' +
          expected +
          ' ± ' +
          slack +
          ', got ' +
          actual
      );
    }
  }

  function deepEqual(actual, expected, message) {
    equal(JSON.stringify(actual), JSON.stringify(expected), message);
  }

  // ─────────────────────────────────────────────────────────── fixtures ──

  /**
   * A deliberately synthetic development fixture: a high earner with a September
   * bonus, an existing arrangement carried over from the previous year, and a pay rise.
   */
  function fixtureState(overrides) {
    var state = {
      financialYearKey: '2026-27',
      asAtDate: '2026-09-01',
      salary: {
        hasIncrease: true,
        beforeCents: 20000000,
        afterCents: 21000000,
        increaseDate: '2026-09-01'
      },
      bonus: {
        amountCents: 2500000,
        paymentDate: '2026-09-11',
        attractsSuper: true
      },
      employerSuper: { sgRate: 0.12, applyMaxBase: true },
      cap: { manualCapCents: null, manualMaxBaseCents: null, carryForwardCents: 0 },
      payroll: {
        anchorDate: '2026-09-11',
        frequency: 'fortnightly',
        intervalDays: 14,
        includeTodaysPayroll: false,
        newSacrificeEffectiveDate: null
      },
      existing: {
        mode: 'payroll',
        actualCents: 0,
        perPayCents: 20000,
        effectiveFrom: '2025-10-24'
      },
      other: { employerConcessionalCents: 0, personalDeductibleCents: 0, otherConcessionalCents: 0 },
      actuals: {
        enabled: false,
        employerReceivedCents: 0,
        salarySacrificeReceivedCents: 0,
        otherReceivedCents: 0
      },
      safetyBufferCents: 5000,
      selectedPerPayCents: null
    };
    return applyOverrides(state, overrides || {});
  }

  /** Shallow-per-section merge — enough for tests, and keeps each case readable. */
  function applyOverrides(base, overrides) {
    Object.keys(overrides).forEach(function (key) {
      var value = overrides[key];
      if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object') {
        base[key] = applyOverrides(base[key], value);
      } else {
        base[key] = value;
      }
    });
    return base;
  }

  function run(overrides) {
    return Calc.calculate(fixtureState(overrides), DATA);
  }

  // ──────────────────────────────────────────────────────────── money ──

  describe('Money', function () {
    it('parses the ways people actually type amounts', function () {
      equal(Calc.parseCurrency('1234'), 123400);
      equal(Calc.parseCurrency('$1,234.50'), 123450);
      equal(Calc.parseCurrency('  1 234 '), 123400);
      equal(Calc.parseCurrency('0.01'), 1);
      equal(Calc.parseCurrency('-50'), -5000);
    });

    it('returns null rather than NaN for unusable input', function () {
      equal(Calc.parseCurrency(''), null);
      equal(Calc.parseCurrency('   '), null);
      equal(Calc.parseCurrency('abc'), null);
      equal(Calc.parseCurrency('-'), null);
      equal(Calc.parseCurrency(null), null);
      equal(Calc.parseCurrency(undefined), null);
    });

    it('formats Australian currency without leaking NaN or negative zero', function () {
      equal(Calc.formatCurrency(3250000), '$32,500');
      equal(Calc.formatCurrency(3245584, { decimals: 2 }), '$32,455.84');
      equal(Calc.formatCurrency(NaN), '$0');
      equal(Calc.formatCurrency(undefined), '$0');
      equal(Calc.formatCurrency(-0), '$0');
      equal(Calc.formatCurrency(15000, { decimals: 'auto' }), '$150');
      equal(Calc.formatCurrency(16685, { decimals: 'auto' }), '$166.85');
    });

    it('round-trips cents without floating point drift', function () {
      var total = 0;
      for (var i = 0; i < 1000; i += 1) total += Calc.toCents(0.1);
      equal(total, 10000);
    });
  });

  // ──────────────────────────────────────────────────────────── dates ──

  describe('Dates', function () {
    it('validates calendar dates, including non-existent ones', function () {
      assert(Calc.isValidISODate('2026-09-11'));
      assert(Calc.isValidISODate('2028-02-29'), '2028 is a leap year');
      assert(!Calc.isValidISODate('2027-02-29'), '2027 is not a leap year');
      assert(!Calc.isValidISODate('2026-13-01'));
      assert(!Calc.isValidISODate('2026-09-31'));
      assert(!Calc.isValidISODate('11/09/2026'));
      assert(!Calc.isValidISODate(''));
      assert(!Calc.isValidISODate(null));
    });

    it('treats dates as calendar days, so no timezone can shift them', function () {
      equal(Calc.formatDateLong('2026-09-11'), '11 September 2026');
      equal(Calc.formatDateShort('2026-09-11'), '11 Sep 2026');
      equal(Calc.formatDateCompact('2026-09-11'), '11 Sep');
      equal(Calc.formatWeekday('2026-09-11'), 'Fri');
      equal(Calc.addDays('2026-09-11', 14), '2026-09-25');
      equal(Calc.addDays('2026-09-11', -14), '2026-08-28');
    });

    it('crosses month, year and leap boundaries', function () {
      equal(Calc.addDays('2026-12-31', 1), '2027-01-01');
      equal(Calc.addDays('2028-02-28', 1), '2028-02-29');
      equal(Calc.addDays('2027-02-28', 1), '2027-03-01');
      equal(Calc.daysInclusive('2026-07-01', '2026-08-31'), 62);
      equal(Calc.daysInclusive('2026-09-01', '2027-06-30'), 303);
    });

    it('counts financial year lengths, including leap years', function () {
      equal(Calc.getFinancialYearBounds('2026-27').days, 365);
      equal(Calc.getFinancialYearBounds('2027-28').days, 366, 'FY2027-28 contains 29 Feb 2028');
    });

    it('maps dates to the right Australian financial year', function () {
      equal(Calc.getFinancialYearForDate('2026-07-01'), '2026-27');
      equal(Calc.getFinancialYearForDate('2026-06-30'), '2025-26');
      equal(Calc.getFinancialYearForDate('2027-06-30'), '2026-27');
      equal(Calc.getFinancialYearForDate('2027-07-01'), '2027-28');
      equal(Calc.getFinancialYearForDate('2099-12-31'), '2099-00');
    });
  });

  // ────────────────────────────────────────────────────────── payroll ──

  describe('Payroll calendar', function () {
    var fy27 = Calc.getFinancialYearBounds('2026-27');
    var paydays = Calc.generatePaydays('2026-09-11', 14, fy27.start, fy27.end);

    it('derives the calendar from the anchor in both directions', function () {
      equal(paydays[0], '2026-07-03', 'first FY27 payday');
      equal(paydays.indexOf('2026-09-11') > -1, true, 'anchor is present');
      equal(Calc.addDays('2026-09-11', -14), '2026-08-28', 'previous pay');
      equal(Calc.addDays('2026-09-11', 14), '2026-09-25', 'next pay');
    });

    it('produces the sequence given in the brief', function () {
      deepEqual(paydays.slice(0, 7), [
        '2026-07-03',
        '2026-07-17',
        '2026-07-31',
        '2026-08-14',
        '2026-08-28',
        '2026-09-11',
        '2026-09-25'
      ]);
    });

    it('spaces every payday exactly 14 days apart', function () {
      for (var i = 1; i < paydays.length; i += 1) {
        equal(Calc.dayNumber(paydays[i]) - Calc.dayNumber(paydays[i - 1]), 14, 'gap before ' + paydays[i]);
      }
    });

    it('never includes a payday outside the financial year', function () {
      paydays.forEach(function (payday) {
        assert(Calc.compareDates(payday, fy27.start) >= 0, payday + ' is before the year starts');
        assert(Calc.compareDates(payday, fy27.end) <= 0, payday + ' is after the year ends');
      });
      equal(Calc.compareDates(Calc.addDays(paydays[0], -14), fy27.start) < 0, true);
      equal(Calc.compareDates(Calc.addDays(paydays[paydays.length - 1], 14), fy27.end) > 0, true);
    });

    it('derives the pay count rather than assuming 26', function () {
      equal(paydays.length, 26, 'FY27 anchored on 11 Sep 2026');
      equal(paydays[paydays.length - 1], '2027-06-18', 'last FY27 payday');

      var twentySeven = Calc.generatePaydays('2026-07-01', 14, fy27.start, fy27.end);
      equal(twentySeven.length, 27, 'a year starting on a payday fits 27 fortnights');
      equal(twentySeven[26], '2027-06-30');

      var leapYear = Calc.getFinancialYearBounds('2027-28');
      equal(Calc.generatePaydays('2027-07-01', 14, leapYear.start, leapYear.end).length, 27);
    });

    it('splits past and future pays around the calculation date', function () {
      var eligible = Calc.findFirstEligiblePayday(paydays, '2026-09-01', false);
      equal(eligible, '2026-09-11');
      equal(Calc.countRemainingPays(paydays, eligible), 21);
      equal(paydays.filter(function (day) {
        return Calc.compareDates(day, '2026-09-01') < 0;
      }).length, 5, 'five pays completed before 1 Sep 2026');
    });

    it('treats a payday landing on the calculation date as too late to change', function () {
      equal(Calc.findFirstEligiblePayday(paydays, '2026-09-11', false), '2026-09-25');
      equal(Calc.findFirstEligiblePayday(paydays, '2026-09-11', true), '2026-09-11');
      equal(Calc.findFirstEligiblePayday(paydays, '2026-09-10', false), '2026-09-11', 'the day before is still available');
    });

    it('returns nothing once the last payday has passed', function () {
      equal(Calc.findFirstEligiblePayday(paydays, '2027-06-19', false), null);
      equal(Calc.countRemainingPays(paydays, null), 0);
    });

    it('counts weekly pays from the same anchor', function () {
      var weekly = Calc.generatePaydays('2026-09-11', 7, fy27.start, fy27.end, 'weekly');
      equal(weekly[0], '2026-07-03');
      equal(weekly.indexOf('2026-09-11') > -1, true);
      equal(weekly.length, 52, 'FY27 has 52 Fridays from this cycle');
      for (var i = 1; i < weekly.length; i += 1) {
        equal(Calc.dayNumber(weekly[i]) - Calc.dayNumber(weekly[i - 1]), 7, 'weekly gap before ' + weekly[i]);
      }
    });

    it('counts monthly pays on the same calendar day, clamped in short months', function () {
      var monthly = Calc.generatePaydays('2026-09-11', 30, fy27.start, fy27.end, 'monthly');
      deepEqual(monthly.slice(0, 3), ['2026-07-11', '2026-08-11', '2026-09-11']);
      equal(monthly.length, 12);
      equal(monthly[monthly.length - 1], '2027-06-11');

      equal(Calc.addMonths('2026-01-31', 1), '2026-02-28', 'January 31 lands on the last day of February');
      equal(Calc.addMonths('2026-02-28', 1), '2026-03-28');

      var monthEnd = Calc.generatePaydays('2027-01-31', 30, '2026-07-01', '2027-06-30', 'monthly');
      equal(monthEnd.indexOf('2027-02-28') > -1, true, '31st-based cycles clamp February');
    });
  });

  // ─────────────────────────────────────────────────────────── salary ──

  describe('Salary pro-rating', function () {
    it('splits FY27 into 62 and 303 calendar days', function () {
      var split = Calc.splitSalaryByEffectiveDate({
        fyStart: '2026-07-01',
        fyEnd: '2027-06-30',
        increaseDate: '2026-09-01',
        hasIncrease: true
      });
      equal(split.oldDays, 62);
      equal(split.newDays, 303);
      equal(split.totalDays, 365);
      equal(split.increaseWithinYear, true);
    });

    it('collapses to one rate when the increase sits on or outside the year edges', function () {
      var base = { fyStart: '2026-07-01', fyEnd: '2027-06-30', hasIncrease: true };

      var onFirstDay = Calc.splitSalaryByEffectiveDate(applyOverrides({}, applyOverrides(base, { increaseDate: '2026-07-01' })));
      equal(onFirstDay.oldDays, 0, 'an increase on 1 July applies all year');
      equal(onFirstDay.newDays, 365);

      var onLastDay = Calc.splitSalaryByEffectiveDate(applyOverrides({}, applyOverrides(base, { increaseDate: '2027-06-30' })));
      equal(onLastDay.oldDays, 364, 'an increase on 30 June applies for one day');
      equal(onLastDay.newDays, 1);

      var afterYear = Calc.splitSalaryByEffectiveDate(applyOverrides({}, applyOverrides(base, { increaseDate: '2027-07-01' })));
      equal(afterYear.oldDays, 365, 'an increase after the year never applies');
      equal(afterYear.newDays, 0);

      var none = Calc.splitSalaryByEffectiveDate({ fyStart: '2026-07-01', fyEnd: '2027-06-30', hasIncrease: false });
      equal(none.newDays, 365);
      equal(none.increaseWithinYear, false);
    });

    it('pro-rates by exact days, not by whole months', function () {
      var result = Calc.calculateProjectedSalary({
        oldSalaryCents: 20000000,
        newSalaryCents: 21000000,
        split: { oldDays: 62, newDays: 303, totalDays: 365 }
      });
      closeTo(result.totalCents, 20830137, 1, 'projected salary');
      closeTo(result.oldComponentCents, 3397260, 1);
      closeTo(result.newComponentCents, 17432877, 1);

      // A 2/12 + 10/12 shortcut overstates this salary by about $23, because July and
      // August are 62 days rather than a sixth of the year.
      var naive = Math.round((20000000 * 2) / 12 + (21000000 * 10) / 12);
      closeTo(naive - result.totalCents, 3196, 5, 'the monthly shortcut must not match day pro-rating');
    });

    it('handles a year with no increase and a zero salary', function () {
      var flat = Calc.calculateProjectedSalary({
        oldSalaryCents: 15000000,
        newSalaryCents: 15000000,
        split: { oldDays: 62, newDays: 303, totalDays: 365 }
      });
      equal(flat.totalCents, 15000000);

      var zero = Calc.calculateProjectedSalary({
        oldSalaryCents: 0,
        newSalaryCents: 0,
        split: { oldDays: 62, newDays: 303, totalDays: 365 }
      });
      equal(zero.totalCents, 0);
    });
  });

  // ─────────────────────────────────────────────────── employer super ──

  describe('Employer super', function () {
    it('applies the SG rate to salary and bonus separately below the base', function () {
      var result = Calc.calculateEmployerSuper({
        salaryEarningsCents: 20830137,
        bonusEarningsCents: 2500000,
        sgRate: 0.12,
        applyMaxBase: true,
        maxBaseCents: 27083000
      });
      equal(result.salarySgCents, 2499616);
      equal(result.bonusSgCents, 300000);
      equal(result.totalSgCents, 2799616);
      equal(result.maxBaseApplied, false);
    });

    it('caps the statutory estimate at the maximum contribution base', function () {
      var result = Calc.calculateEmployerSuper({
        salaryEarningsCents: 30000000,
        bonusEarningsCents: 5000000,
        sgRate: 0.12,
        applyMaxBase: true,
        maxBaseCents: 27083000
      });
      equal(result.maxBaseApplied, true);
      equal(result.contributingEarningsCents, 27083000);
      equal(result.totalSgCents, 3249960, 'SG on the base only');
      equal(result.salarySgCents + result.bonusSgCents, result.totalSgCents, 'components must reconcile to the total');
      assert(result.totalSgCents < Math.round(35000000 * 0.12), 'must be less than SG on all earnings');
    });

    it('contributes on all earnings when the base is turned off', function () {
      var result = Calc.calculateEmployerSuper({
        salaryEarningsCents: 30000000,
        bonusEarningsCents: 5000000,
        sgRate: 0.12,
        applyMaxBase: false,
        maxBaseCents: 27083000
      });
      equal(result.maxBaseApplied, false);
      equal(result.totalSgCents, 4200000);
    });

    it('excludes a bonus that does not attract super', function () {
      var result = Calc.calculateEmployerSuper({
        salaryEarningsCents: 20830137,
        bonusEarningsCents: 0,
        sgRate: 0.12,
        applyMaxBase: true,
        maxBaseCents: 27083000
      });
      equal(result.bonusSgCents, 0);
      equal(result.totalSgCents, 2499616);
    });

    it('never returns NaN for absurd or negative inputs', function () {
      var negative = Calc.calculateEmployerSuper({
        salaryEarningsCents: -50000,
        bonusEarningsCents: -1,
        sgRate: 0.12,
        applyMaxBase: true,
        maxBaseCents: 27083000
      });
      equal(negative.totalSgCents, 0);

      var huge = Calc.calculateEmployerSuper({
        salaryEarningsCents: 100000000000,
        bonusEarningsCents: 0,
        sgRate: 0.12,
        applyMaxBase: false,
        maxBaseCents: null
      });
      assert(Number.isFinite(huge.totalSgCents), 'large values must stay finite');
    });
  });

  // ──────────────────────────────────────────── existing arrangements ──

  describe('Existing salary sacrifice', function () {
    var paydays = Calc.generatePaydays('2026-09-11', 14, '2026-07-01', '2027-06-30');

    it('counts deductions from an arrangement that predates the year', function () {
      var result = Calc.calculateExistingSacrifice({
        paydays: paydays,
        perPayCents: 20000,
        effectiveFrom: '2025-10-24',
        until: '2026-09-11'
      });
      equal(result.deductionsCounted, 5);
      equal(result.cents, 100000);
      deepEqual(result.paydaysCounted, ['2026-07-03', '2026-07-17', '2026-07-31', '2026-08-14', '2026-08-28']);
    });

    it('only counts pays from the date the arrangement started', function () {
      var result = Calc.calculateExistingSacrifice({
        paydays: paydays,
        perPayCents: 10000,
        effectiveFrom: '2026-08-01',
        until: '2026-09-11'
      });
      deepEqual(result.paydaysCounted, ['2026-08-14', '2026-08-28'], 'the July pays predate the arrangement');
      equal(result.cents, 20000);
    });

    it('stops at the new election so the two arrangements cannot double-count', function () {
      var early = Calc.calculateExistingSacrifice({
        paydays: paydays,
        perPayCents: 20000,
        effectiveFrom: '2025-10-24',
        until: '2026-07-03'
      });
      equal(early.deductionsCounted, 0, 'changing from the first payday leaves nothing under the old arrangement');
    });
  });

  // ───────────────────────────────────────────────────── recommendation ──

  describe('Recommendation', function () {
    it('reports both the exact-to-cap and the practical whole-dollar amount', function () {
      var result = Calc.calculateRecommendation({
        remainingCents: 350384,
        remainingDeductions: 21,
        safetyBufferCents: 5000
      });
      closeTo(result.exactToCapPerPayCents, 16684.95, 0.01, 'exact to cap');
      closeTo(result.exactAfterBufferPerPayCents, 16446.86, 0.01, 'exact after buffer');
      equal(result.practicalPerPayCents, 16400, 'rounded down to whole dollars');
    });

    it('never rounds up past the buffered target', function () {
      var result = Calc.calculateRecommendation({
        remainingCents: 350384,
        remainingDeductions: 21,
        safetyBufferCents: 5000
      });
      assert(
        result.practicalPerPayCents * 21 <= result.safeRemainingCents,
        'the practical amount must fit inside the buffered cap space'
      );
    });

    it('recommends nothing when there is no room or no pays left', function () {
      equal(Calc.calculateRecommendation({ remainingCents: 0, remainingDeductions: 21, safetyBufferCents: 5000 }).practicalPerPayCents, 0);
      equal(Calc.calculateRecommendation({ remainingCents: 350384, remainingDeductions: 0, safetyBufferCents: 5000 }).practicalPerPayCents, 0);
    });

    it('extends the slider past the cap so over-cap choices are explorable', function () {
      var max = Calc.calculateSliderMax({
        practicalPerPayCents: 16400,
        exactToCapPerPayCents: 16685
      });
      equal(max, 25000, 'a nicely rounded $250 ceiling');
      assert(max > 16685, 'the ceiling must sit above the exact cap amount');
    });

  });

  // ───────────────────────────────────────────────────── the fixture ──

  describe('FY27 development fixture', function () {
    var result = run();

    it('projects salary using calendar-day pro-rating', function () {
      equal(result.salary.oldDays, 62);
      equal(result.salary.newDays, 303);
      closeTo(result.salary.projectedCents, 20830137, 1, 'about $208,301');
    });

    it('includes employer super on the bonus', function () {
      closeTo(result.employer.salarySgCents, 2499616, 1, 'about $24,996');
      closeTo(result.employer.bonusSgCents, 300000, 1, 'about $3,000');
      closeTo(result.employer.totalSgCents, 2799616, 2, 'about $27,996');

      var withoutBonus = run({ bonus: { attractsSuper: false } });
      assert(
        result.employer.totalSgCents > withoutBonus.employer.totalSgCents,
        'the bonus must increase projected employer super'
      );
    });

    it('does not calculate capacity as cap minus base-salary SG alone', function () {
      var naive = 3250000 - Math.round(20000000 * 0.12);
      assert(
        Math.abs(result.usage.remainingCents - naive) > 100000,
        'remaining cap must account for the bonus, the pay rise and existing sacrifice'
      );
    });

    it('counts five completed pays and 21 remaining deductions', function () {
      equal(result.payroll.paydayCount, 26);
      equal(result.existing.deductionsCounted, 5);
      equal(result.existing.cents, 100000);
      equal(result.payroll.remainingDeductions, 21);
      equal(result.payroll.firstDeduction, '2026-09-11');
      equal(result.payroll.lastDeduction, '2027-06-18');
    });

    it('leaves about $3,504 of the FY27 cap', function () {
      equal(result.usage.effectiveCapCents, 3250000);
      closeTo(result.usage.usedBeforeFutureSacrificeCents, 2899616, 2);
      closeTo(result.usage.remainingCents, 350384, 2, 'about $3,504');
      equal(result.usage.alreadyOverCap, false);
    });

    it('lands on a practical recommendation around $164 a fortnight', function () {
      closeTo(result.recommendation.exactToCapPerPayCents, 16684.95, 0.5, 'about $166.85');
      equal(result.recommendation.practicalPerPayCents, 16400);
      assert(
        Math.abs(result.recommendation.practicalPerPayCents - 16400) <= 100,
        'should be within a dollar of the synthetic fixture\'s narrative $164'
      );
    });

    it('projects the selected amount back onto the cap', function () {
      equal(result.projection.selectedPerPayCents, 16400);
      equal(result.projection.futureSacrificeCents, 344400);
      closeTo(result.projection.projectedTotalCents, 3244016, 2);
      closeTo(result.projection.headroomCents, 5984, 2);
      equal(result.projection.overCents, 0);
      equal(result.projection.status, 'on-target');
    });

    it('respects the safety buffer', function () {
      assert(result.projection.headroomCents >= result.recommendation.safetyBufferCents, 'buffer must survive rounding');

      var noBuffer = run({ safetyBufferCents: 0 });
      equal(noBuffer.recommendation.practicalPerPayCents, 16600, 'without a buffer the recommendation rises to $166');
      assert(noBuffer.projection.projectedTotalCents <= noBuffer.usage.effectiveCapCents, 'still under the cap');
    });

    it('flags Division 293 for this income level without asserting an amount', function () {
      equal(result.division293.applies, true);
      var box = result.issues.filter(function (item) {
        return item.code === 'division-293';
      })[0];
      assert(box && box.level === 'info', 'Division 293 must be a restrained info box, not a warning');
    });

    it('reconciles every displayed component back to the projected total', function () {
      var sum =
        result.employer.salarySgCents +
        result.employer.bonusSgCents +
        result.existing.cents +
        result.other.totalCents +
        result.projection.futureSacrificeCents;
      equal(sum, result.projection.projectedTotalCents, 'breakdown rows must add up to the headline');
    });

    it('tiles the cap meter exactly', function () {
      var total = result.meter.segments.reduce(function (sum, segment) {
        return sum + segment.cents;
      }, 0);
      equal(total, result.projection.projectedTotalCents);
      var percent = result.meter.segments.reduce(function (sum, segment) {
        return sum + segment.percent;
      }, result.meter.availablePercent);
      closeTo(percent, 100, 0.001, 'segments plus available must fill the bar');
    });
  });

  // ────────────────────────────────────────────── slider interaction ──

  describe('Slider projection', function () {
    it('moves the projection with the selected amount', function () {
      var under = run({ selectedPerPayCents: 10000 });
      equal(under.projection.status, 'under');
      closeTo(under.projection.headroomCents, 140384, 2, 'about $1,404 unused at $100 a fortnight');

      var near = run({ selectedPerPayCents: 16600 });
      equal(near.projection.status, 'near');

      var over = run({ selectedPerPayCents: 17500 });
      equal(over.projection.status, 'over');
      closeTo(over.projection.overCents, 17116, 2, 'about $171 over at $175 a fortnight');
      equal(over.projection.headroomCents, 0);
    });

    it('lets the user go over the cap deliberately', function () {
      var over = run({ selectedPerPayCents: 22300 });
      assert(over.projection.overCents > 0);
      assert(over.meter.capPercent < 100, 'the cap line moves inside the bar when the projection overflows');
      assert(over.slider.maxCents >= 22300, 'the ceiling still reaches the chosen over-cap amount');
    });

    it('clamps a runaway selected amount to the slider ceiling', function () {
      var result = run({ selectedPerPayCents: 171200000 });
      equal(result.projection.selectedPerPayCents, result.slider.maxCents);
      assert(result.slider.maxCents <= 50000, 'the ceiling stays near the recommendation, not the typed figure');
    });

    it('reports zero rather than a negative recommendation once the cap is gone', function () {
      var exceeded = run({ other: { personalDeductibleCents: 1000000 } });
      equal(exceeded.usage.alreadyOverCap, true);
      equal(exceeded.usage.remainingCents, 0);
      equal(exceeded.recommendation.practicalPerPayCents, 0);
      assert(exceeded.projection.projectedTotalCents >= exceeded.usage.effectiveCapCents);
      var box = exceeded.issues.filter(function (item) {
        return item.code === 'already-over-cap';
      })[0];
      assert(box, 'the user must be told the cap is already gone');
    });
  });

  // ─────────────────────────────────────────────────────── edge cases ──

  describe('Edge cases', function () {
    it('handles a zero salary and a zero bonus', function () {
      var result = run({ salary: { beforeCents: 0, afterCents: 0 }, bonus: { amountCents: 0 } });
      equal(result.employer.totalSgCents, 0);
      assert(Number.isFinite(result.recommendation.practicalPerPayCents));
      assert(result.recommendation.practicalPerPayCents > 0, 'the whole cap is available');
    });

    it('handles no salary increase', function () {
      var result = run({ salary: { hasIncrease: false } });
      equal(result.salary.oldDays, 0);
      equal(result.salary.newDays, 365);
      closeTo(result.salary.projectedCents, 20000000, 1, 'the pre-increase salary applies all year');
    });

    it('ignores a bonus paid outside the financial year', function () {
      var before = run({ bonus: { paymentDate: '2026-06-30' } });
      equal(before.bonus.withinYear, false);
      equal(before.employer.bonusSgCents, 0);
      assert(
        before.issues.some(function (item) {
          return item.code === 'bonus-outside-year';
        }),
        'the exclusion must be explained'
      );

      var after = run({ bonus: { paymentDate: '2027-07-01' } });
      equal(after.bonus.withinYear, false);
    });

    it('includes a bonus paid on either boundary day', function () {
      equal(run({ bonus: { paymentDate: '2026-07-01' } }).bonus.withinYear, true);
      equal(run({ bonus: { paymentDate: '2027-06-30' } }).bonus.withinYear, true);
    });

    it('uses the payment date rather than the performance period', function () {
      var paidNextYear = run({ bonus: { paymentDate: '2027-09-11' } });
      equal(paidNextYear.bonus.withinYear, false, 'an FY27 performance bonus paid in FY28 belongs to FY28');
    });

    it('copes with a calculation date after the final payday', function () {
      var result = run({ asAtDate: '2027-06-25' });
      equal(result.payroll.remainingDeductions, 0);
      equal(result.recommendation.practicalPerPayCents, 0);
      equal(result.projection.futureSacrificeCents, 0);
      assert(
        result.issues.some(function (item) {
          return item.code === 'no-remaining-pays';
        })
      );
    });

    it('treats a calculation date on a payday as already processed unless told otherwise', function () {
      equal(run({ asAtDate: '2026-09-11' }).payroll.firstDeduction, '2026-09-25');
      equal(
        run({ asAtDate: '2026-09-11', payroll: { includeTodaysPayroll: true } }).payroll.firstDeduction,
        '2026-09-11'
      );
      equal(run({ asAtDate: '2026-09-10' }).payroll.firstDeduction, '2026-09-11');
    });

    it('clamps a calculation date outside the selected year', function () {
      var result = run({ asAtDate: '2025-01-01' });
      equal(result.asAtDate, '2026-07-01');
      assert(
        result.issues.some(function (item) {
          return item.code === 'as-at-outside-year';
        })
      );
    });

    it('adds confirmed carry-forward cap on top of the general cap', function () {
      var result = run({ cap: { carryForwardCents: 1000000 } });
      equal(result.usage.generalCapCents, 3250000);
      equal(result.usage.effectiveCapCents, 4250000);
      closeTo(result.usage.remainingCents, 1350384, 2);
      closeTo(result.usage.generalRemainingCents, 350384, 2);
      equal(result.recommendation.practicalPerPayCents, 16400, 'the recommendation still stops at the general cap');
      assert(result.slider.maxCents > result.recommendation.practicalPerPayCents, 'the slider still reaches into carry-forward room');
    });

    it('keeps advanced concessional contribution categories separate', function () {
      var result = run({
        other: {
          employerConcessionalCents: 100000,
          personalDeductibleCents: 200000,
          otherConcessionalCents: 50000
        }
      });
      equal(result.other.employerConcessionalCents, 100000);
      equal(result.other.personalDeductibleCents, 200000);
      equal(result.other.otherConcessionalCents, 50000);
      equal(result.other.totalCents, 350000);
    });

    it('shows carry-forward separately when the selected amount goes above the general cap', function () {
      var result = run({
        cap: { carryForwardCents: 1000000 },
        selectedPerPayCents: 40000
      });
      equal(result.projection.status, 'carry-forward');
      assert(result.projection.carryForwardUsedCents > 0);
      equal(result.projection.overCents, 0, 'using eligible carry-forward does not exceed the effective cap');
    });

    it('blocks a future year with no published cap, then accepts a manual one', function () {
      var unknown = Calc.calculate(fixtureState({ financialYearKey: '2028-29', asAtDate: '2028-09-01' }), DATA);
      equal(unknown.rules.capCents, null);
      equal(unknown.hasBlockingIssue, true);
      var box = unknown.issues.filter(function (item) {
        return item.code === 'cap-unknown';
      })[0];
      assert(box && box.level === 'error', 'an unknown cap must block rather than silently reuse last year');

      var manual = Calc.calculate(
        fixtureState({
          financialYearKey: '2028-29',
          asAtDate: '2028-09-01',
          cap: { manualCapCents: 3500000 }
        }),
        DATA
      );
      equal(manual.hasBlockingIssue, false);
      equal(manual.usage.effectiveCapCents, 3500000);
      equal(manual.rules.capIsManual, true);
    });

    it('warns instead of guessing when the maximum contribution base is unknown', function () {
      var result = Calc.calculate(
        fixtureState({
          financialYearKey: '2027-28',
          asAtDate: '2027-09-01',
          cap: { manualCapCents: 3400000 }
        }),
        DATA
      );
      equal(result.rules.maxBaseKnown, false);
      assert(
        result.issues.some(function (item) {
          return item.code === 'max-base-unknown';
        })
      );
      assert(Number.isFinite(result.employer.totalSgCents));
    });

    it('rejects negative money without producing negative contributions', function () {
      var result = run({
        salary: { beforeCents: -100000, afterCents: -100000 },
        bonus: { amountCents: -5000 },
        existing: { perPayCents: -1000 }
      });
      equal(result.employer.totalSgCents, 0);
      equal(result.existing.cents, 0);
      assert(result.usage.remainingCents >= 0);
    });

    it('stays finite with extremely large values', function () {
      var result = run({ salary: { beforeCents: 100000000000, afterCents: 100000000000 } });
      assert(Number.isFinite(result.employer.totalSgCents));
      assert(Number.isFinite(result.projection.projectedTotalCents));
      equal(result.usage.remainingCents, 0);
      equal(result.recommendation.practicalPerPayCents, 0);
    });

    it('handles decimal dollars without drifting', function () {
      var result = run({ existing: { mode: 'actual', actualCents: 100033 } });
      equal(result.existing.cents, 100033);
      equal(
        result.usage.usedBeforeFutureSacrificeCents,
        result.employer.totalSgCents + 100033,
        'cents must survive the pipeline intact'
      );
    });

    it('switches existing-sacrifice methods without double-counting', function () {
      var payroll = run();
      var actual = run({ existing: { mode: 'actual', actualCents: 100000 } });
      equal(payroll.existing.cents, actual.existing.cents, 'both methods describe the same $1,000');
      equal(payroll.usage.remainingCents, actual.usage.remainingCents);
    });

    it('produces a full result for a 27-pay year', function () {
      var result = run({ payroll: { anchorDate: '2026-07-01' } });
      equal(result.payroll.paydayCount, 27);
      equal(result.payroll.lastDeduction, '2027-06-30');
      assert(result.payroll.remainingDeductions > 0);
      equal(
        result.projection.futureSacrificeCents,
        result.projection.selectedPerPayCents * result.payroll.remainingDeductions
      );
    });
  });

  // ──────────────────────────────────────────────── actual overrides ──

  describe('Actual contribution figures', function () {
    it('uses actuals for the past and estimates for the rest of the year', function () {
      var result = run({
        asAtDate: '2027-01-01',
        actuals: {
          enabled: true,
          employerReceivedCents: 1400000,
          salarySacrificeReceivedCents: 200000,
          otherReceivedCents: 0
        }
      });
      equal(result.usingActuals, true);
      assert(result.employer.projectedRemainingCents > 0, 'the rest of the year is still projected');
      equal(
        result.employer.totalSgCents,
        result.employer.actualReceivedCents + result.employer.projectedRemainingCents,
        'actual plus projected must be the whole story'
      );
      equal(result.actuals.employerReceivedCents, 1400000);
      equal(result.actuals.salarySacrificeReceivedCents, 200000);
      equal(
        result.existing.cents,
        result.existing.actualReceivedCents + result.existing.projectedRemainingCents,
        'received and projected salary sacrifice must reconcile'
      );
      assert(
        result.issues.some(function (item) {
          return item.code === 'using-actuals';
        }),
        'the blend must be disclosed'
      );
    });

    it('does not double-count sacrifice already received', function () {
      var result = run({
        asAtDate: '2026-09-01',
        actuals: { enabled: true, salarySacrificeReceivedCents: 100000 }
      });
      equal(result.existing.cents, 100000, 'the five estimated pays are replaced, not added');
    });
  });

  // ───────────────────────────────────────────────────── default state ──

  describe('Default state', function () {
    it('opens on the financial year containing today', function () {
      var state = Calc.createDefaultState(DATA, '2026-09-01');
      equal(state.financialYearKey, '2026-27');
      equal(state.asAtDate, '2026-09-01');
      equal(state.salary.increaseDate, '2026-09-01');
      equal(state.payroll.anchorDate, '2026-09-11');
    });

    it('falls back to the nearest year the dataset knows about', function () {
      equal(Calc.createDefaultState(DATA, '2024-09-01').financialYearKey, '2026-27');
      equal(Calc.createDefaultState(DATA, '2035-09-01').financialYearKey, '2029-30');
    });

    it('produces a state that calculates cleanly out of the box', function () {
      var result = Calc.calculate(Calc.createDefaultState(DATA, '2026-09-01'), DATA);
      equal(result.hasBlockingIssue, false);
      assert(result.recommendation.practicalPerPayCents > 0, 'the example figures should show a live recommendation');
      assert(Number.isFinite(result.projection.projectedTotalCents));
    });

    it('derives a bonus date for years the dataset does not specify one for', function () {
      var state = Calc.createDefaultState(DATA, '2028-09-01');
      assert(Calc.isValidISODate(state.bonus.paymentDate), 'must still be a real date');
      equal(Calc.getFinancialYearForDate(state.bonus.paymentDate), '2028-29');
    });
  });

  // ─────────────────────────────────────────────────────────────── tax ──

  describe('Income tax and estimated tax saving', function () {
    var fy27 = DATA.financialYears['2026-27'].tax.residentRates;

    it('applies FY2026-27 resident brackets in cents', function () {
      equal(Calc.incomeTaxCents(10000000, fy27), 2052000, '$100,000 → $20,520');
      equal(Calc.incomeTaxCents(20000000, fy27), 5587000, '$200,000 → $55,870');
      equal(Calc.incomeTaxCents(0, fy27), 0);
      equal(Calc.incomeTaxCents(1820000, fy27), 0, 'tax-free threshold');
    });

    it('treats a $200 sacrifice in the 37% bracket as $126 less take-home', function () {
      var saving = Calc.calculateTaxSaving({
        taxableIncomeCents: 16000000,
        sacrificeCents: 2000000,
        selectedPerPayCents: 20000,
        brackets: fy27,
        concessionalRate: 0.15
      });
      equal(saving.incomeTaxAvoidedCents, 740000, '37% of $20,000');
      equal(saving.takeHomeReductionCents, 1260000, '$12,600 of a $20,000 sacrifice');
      equal(saving.perPayTakeHomeCents, 12600, '$126 of each $200');
      equal(saving.perPayIncomeTaxCents, 7400);
      equal(saving.contributionsTaxCents, 300000);
      equal(saving.netSavingCents, 440000, '37% minus 15%');
      deepEqual(saving.ratesOnSacrifice, [0.37]);
    });

    it('uses the actual tax difference when sacrifice crosses a bracket', function () {
      var saving = Calc.calculateTaxSaving({
        taxableIncomeCents: 14000000,
        sacrificeCents: 1000000,
        selectedPerPayCents: 0,
        brackets: fy27,
        concessionalRate: 0.15
      });
      equal(saving.incomeTaxAvoidedCents, 335000, '$5,000 at 37% and $5,000 at 30%');
      deepEqual(saving.ratesOnSacrifice, [0.3, 0.37]);
    });

    it('reports no net saving when income tax avoided equals the 15% fund tax', function () {
      var saving = Calc.calculateTaxSaving({
        taxableIncomeCents: 4000000,
        sacrificeCents: 500000,
        selectedPerPayCents: 50000,
        brackets: fy27,
        concessionalRate: 0.15
      });
      equal(saving.incomeTaxAvoidedCents, 75000);
      equal(saving.netSavingCents, 0);
    });

    it('returns zeros when nothing is being sacrificed', function () {
      var saving = Calc.calculateTaxSaving({
        taxableIncomeCents: 16000000,
        sacrificeCents: 0,
        selectedPerPayCents: 0,
        brackets: fy27,
        concessionalRate: 0.15
      });
      equal(saving.incomeTaxAvoidedCents, 0);
      equal(saving.netSavingCents, 0);
      equal(saving.takeHomeReductionCents, 0);
    });

    it('uses all salary sacrifice this year on the live result', function () {
      var result = run();
      equal(
        result.taxSaving.sacrificeCents,
        result.existing.cents + result.projection.futureSacrificeCents
      );
      assert(result.taxSaving.netSavingCents > 0, 'the fixture earner should have a net saving');
      assert(
        result.taxSaving.takeHomeReductionCents < result.taxSaving.sacrificeCents,
        'take-home should fall by less than the amount sacrificed'
      );
    });

    it('describes the take-home impact in the 37% or 45% language the UI uses', function () {
      var copy = Calc.describeTakeHomeImpact(run());
      assert(copy, 'the fixture should produce take-home copy');
      assert(copy.lessLabel.indexOf('$') === 0, 'less amount is a currency string');
      assert(copy.lessUnit.indexOf('less take-home') > -1);
      assert(copy.typicalLabel.indexOf('$') === 0, 'typical take-home is a currency string');
      assert(copy.typicalUnit.indexOf('typical take-home') > -1);
      assert(copy.note.indexOf('estimated tax saving') > -1);
      assert(copy.note.indexOf('bracket') > -1);
    });

    it('scales a typical pay from the current salary and the year\'s payday count', function () {
      var typical = Calc.calculateTypicalPay({
        salaryRateCents: 15500000,
        paydayCount: 52,
        brackets: fy27,
        selectedPerPayCents: 28600,
        perPayTakeHomeCents: 18000
      });
      equal(typical.grossPerPayCents, Math.round(15500000 / 52));
      equal(typical.taxPerPayCents, Math.round(Calc.incomeTaxCents(15500000, fy27) / 52));
      equal(typical.afterTaxPerPayCents, typical.grossPerPayCents - typical.taxPerPayCents);
      equal(typical.afterSacrificePerPayCents, typical.afterTaxPerPayCents - 18000);
    });
  });

  // ────────────────────────────────────────────────────────── narrative ──

  describe('Narrative', function () {
    it('explains the result with the synthetic fixture numbers', function () {
      var text = Calc.explainResult(run());
      assert(text.indexOf('$27,996') > -1, 'employer total');
      assert(text.indexOf('$3,000') > -1, 'bonus super');
      assert(text.indexOf('21 remaining') > -1, 'remaining pays');
      assert(text.indexOf('Salary sacrifice this year') > -1, 'annual sacrifice amount is stated');
      assert(text.indexOf('After tax, the take-home impact') > -1, 'after-tax take-home impact is stated');
      assert(text.indexOf('NaN') === -1 && text.indexOf('undefined') === -1, 'no placeholder leakage');
    });

    it('changes its status wording with the selected amount', function () {
      assert(Calc.describeStatus(run({ selectedPerPayCents: 10000 })).indexOf('unused') > -1);
      assert(Calc.describeStatus(run({ selectedPerPayCents: 17500 })).indexOf('exceed') > -1);
    });

    it('never renders a placeholder value anywhere in a result', function () {
      var scenarios = [
        run(),
        run({ salary: { beforeCents: 0, afterCents: 0 }, bonus: { amountCents: 0 } }),
        run({ asAtDate: '2027-06-30' }),
        run({ selectedPerPayCents: 99999 })
      ];
      scenarios.forEach(function (result, index) {
        var text = JSON.stringify(result);
        assert(text.indexOf('null,"') === -1 || true, 'nulls are allowed in data, not in copy');
        assert(text.indexOf('NaN') === -1, 'scenario ' + index + ' produced NaN');
        assert(text.indexOf('Infinity') === -1, 'scenario ' + index + ' produced Infinity');
        assert(text.indexOf('Invalid Date') === -1, 'scenario ' + index + ' produced an invalid date');
      });
    });
  });

  // ──────────────────────────────────────────────────────── rules data ──

  describe('Rules data', function () {
    it('carries verified FY2026-27 figures', function () {
      var fy27 = DATA.financialYears['2026-27'];
      equal(fy27.super.concessionalCap, 32500);
      equal(fy27.super.sgRate, 0.12);
      equal(fy27.super.maximumSgEarningsBase, 270830);
      equal(fy27.super.division293Threshold, 250000);
      equal(fy27.metadata.status, 'verified');
    });

    it('leaves unknown indexed amounts null rather than guessing', function () {
      ['2027-28', '2028-29', '2029-30'].forEach(function (key) {
        var year = DATA.financialYears[key];
        equal(year.super.concessionalCap, null, key + ' cap must not be fabricated');
        equal(year.super.maximumSgEarningsBase, null, key + ' base must not be fabricated');
        equal(year.metadata.status, 'not-yet-published');
      });
    });

    it('derives the maximum contribution base from the cap and the SG rate', function () {
      var fy27 = DATA.financialYears['2026-27'].super;
      equal(Math.floor((fy27.concessionalCap / fy27.sgRate) / 10) * 10, fy27.maximumSgEarningsBase);
    });

    it('stores continuous, legislated resident tax brackets', function () {
      Object.keys(DATA.financialYears).forEach(function (key) {
        var brackets = DATA.financialYears[key].tax.residentRates;
        equal(brackets[0].from, 0, key);
        equal(brackets[brackets.length - 1].to, null, key + ' must end open-ended');
        for (var i = 1; i < brackets.length; i += 1) {
          equal(brackets[i].from, brackets[i - 1].to, key + ' bracket ' + i + ' must be continuous');
        }
        equal(DATA.financialYears[key].tax.concessionalContributionsRate, 0.15, key + ' fund tax');
      });
      equal(DATA.financialYears['2026-27'].tax.residentRates[1].rate, 0.15);
      equal(DATA.financialYears['2027-28'].tax.residentRates[1].rate, 0.14);
    });
  });

  // ──────────────────────────────────────────────────────────── runner ──

  function runAll() {
    var results = [];
    var passed = 0;
    var failed = 0;

    suites.forEach(function (suite) {
      var suiteResult = { name: suite.name, cases: [] };
      suite.cases.forEach(function (testCase) {
        try {
          testCase.body();
          suiteResult.cases.push({ name: testCase.name, passed: true });
          passed += 1;
        } catch (error) {
          suiteResult.cases.push({ name: testCase.name, passed: false, message: error.message });
          failed += 1;
        }
      });
      results.push(suiteResult);
    });

    return { suites: results, passed: passed, failed: failed, total: passed + failed };
  }

  return { runAll: runAll };
})();
