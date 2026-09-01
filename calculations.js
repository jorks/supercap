/**
 * SuperCap — calculation engine.
 *
 * Pure functions only: data in, data out. Nothing here touches the DOM, reads
 * globals other than the rules dataset passed to it, or knows that a UI exists.
 * app.js owns rendering; tests.js exercises this file directly.
 *
 * Two conventions run through the whole engine:
 *
 *   Money is integer cents. Dollars only appear at the formatting boundary.
 *   Dates are 'YYYY-MM-DD' strings treated as calendar dates, never timestamps,
 *   so nothing can drift across a timezone or daylight-saving boundary.
 */
window.SuperCapCalc = (function () {
  'use strict';

  var MS_PER_DAY = 86400000;

  var MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  var MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  /** Headroom at or under this counts as "near the cap" rather than comfortably under. */
  var NEAR_CAP_CENTS = 2500;

  /** Widest the slider will ever be squeezed to, so a tiny recommendation still has usable travel. */
  var MIN_SLIDER_MAX_CENTS = 20000;

  // ───────────────────────────────────────────────────────────── money ──

  function nonNegative(cents) {
    return Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0;
  }

  function toCents(dollars) {
    return Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
  }

  function fromCents(cents) {
    return Number.isFinite(cents) ? cents / 100 : 0;
  }

  var currencyFormatters = {};

  function currencyFormatter(decimals) {
    if (!currencyFormatters[decimals]) {
      currencyFormatters[decimals] = new Intl.NumberFormat('en-AU', {
        style: 'currency',
        currency: 'AUD',
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
    }
    return currencyFormatters[decimals];
  }

  var numberFormatters = {};

  function numberFormatter(decimals) {
    if (!numberFormatters[decimals]) {
      numberFormatters[decimals] = new Intl.NumberFormat('en-AU', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      });
    }
    return numberFormatters[decimals];
  }

  /**
   * @param {number} cents
   * @param {{decimals?: number|'auto'}} [options] 'auto' shows cents only when there are any.
   */
  function formatCurrency(cents, options) {
    var opts = options || {};
    var safe = Number.isFinite(cents) ? Math.round(cents) : 0;
    if (safe === 0) safe = 0; // collapses -0, which would otherwise format as "-$0"
    var decimals = opts.decimals === undefined ? 0 : opts.decimals;
    if (decimals === 'auto') decimals = safe % 100 === 0 ? 0 : 2;
    return currencyFormatter(decimals).format(safe / 100);
  }

  /** Bare number for text inputs — no currency symbol, since the field draws its own. */
  function formatAmount(cents, options) {
    var opts = options || {};
    var safe = Number.isFinite(cents) ? Math.round(cents) : 0;
    var decimals = opts.decimals === undefined ? 'auto' : opts.decimals;
    if (decimals === 'auto') decimals = safe % 100 === 0 ? 0 : 2;
    return numberFormatter(decimals).format(safe / 100);
  }

  /**
   * Reads a money value typed by a human: '$1,234.50', '1234.5', ' 1 234 ' all work.
   * @returns {number|null} cents, or null when the text is empty or not a number.
   */
  function parseCurrency(text) {
    if (typeof text === 'number') return Number.isFinite(text) ? Math.round(text * 100) : null;
    var cleaned = String(text === null || text === undefined ? '' : text).replace(/[\s,$_]/g, '');
    if (cleaned === '' || cleaned === '-' || cleaned === '.') return null;
    var value = Number(cleaned);
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }

  function formatPercent(fraction, decimals) {
    var places = decimals === undefined ? 1 : decimals;
    var safe = Number.isFinite(fraction) ? fraction : 0;
    return numberFormatter(places).format(safe * 100) + '%';
  }

  // ───────────────────────────────────────────────────────────── dates ──

  function pad(value, length) {
    var text = String(Math.abs(value));
    while (text.length < length) text = '0' + text;
    return text;
  }

  function daysInMonth(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function isValidISODate(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
    var parts = iso.split('-');
    var year = Number(parts[0]);
    var month = Number(parts[1]);
    var day = Number(parts[2]);
    if (month < 1 || month > 12 || day < 1) return false;
    return day <= daysInMonth(year, month);
  }

  /**
   * Days since the epoch. Built on Date.UTC so the result is a plain integer with no
   * timezone or DST component — all date arithmetic in SuperCap goes through this.
   */
  function dayNumber(iso) {
    if (!isValidISODate(iso)) return NaN;
    var parts = iso.split('-');
    return Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])) / MS_PER_DAY;
  }

  function fromDayNumber(number) {
    if (!Number.isFinite(number)) return null;
    var date = new Date(number * MS_PER_DAY);
    return pad(date.getUTCFullYear(), 4) + '-' + pad(date.getUTCMonth() + 1, 2) + '-' + pad(date.getUTCDate(), 2);
  }

  function addDays(iso, days) {
    var base = dayNumber(iso);
    return Number.isFinite(base) ? fromDayNumber(base + days) : null;
  }

  /** Same calendar day in another month, clamped to the last day when needed (31 Jan → 28 Feb). */
  function addMonths(iso, months) {
    var parts = dateParts(iso);
    if (!parts || !Number.isFinite(months)) return null;
    var index = parts.year * 12 + (parts.month - 1) + Math.round(months);
    var year = Math.floor(index / 12);
    var month = index - year * 12 + 1;
    var day = Math.min(parts.day, daysInMonth(year, month));
    return pad(year, 4) + '-' + pad(month, 2) + '-' + pad(day, 2);
  }

  function payCadence(frequency) {
    if (frequency === 'weekly') {
      return { frequency: 'weekly', intervalDays: 7, per: 'per week', adjective: 'weekly', unit: '/ week' };
    }
    if (frequency === 'monthly') {
      return { frequency: 'monthly', intervalDays: 30, per: 'per month', adjective: 'monthly', unit: '/ month' };
    }
    return { frequency: 'fortnightly', intervalDays: 14, per: 'per fortnight', adjective: 'fortnightly', unit: '/ fortnight' };
  }

  /** Negative when a is earlier, positive when later, 0 when the same day. */
  function compareDates(a, b) {
    return dayNumber(a) - dayNumber(b);
  }

  function daysInclusive(from, to) {
    var span = dayNumber(to) - dayNumber(from);
    return Number.isFinite(span) ? span + 1 : 0;
  }

  function clampDate(iso, earliest, latest) {
    if (!isValidISODate(iso)) return null;
    if (compareDates(iso, earliest) < 0) return earliest;
    if (compareDates(iso, latest) > 0) return latest;
    return iso;
  }

  /** Today in the browser's local calendar, not UTC. */
  function todayISO() {
    var now = new Date();
    return pad(now.getFullYear(), 4) + '-' + pad(now.getMonth() + 1, 2) + '-' + pad(now.getDate(), 2);
  }

  function dateParts(iso) {
    if (!isValidISODate(iso)) return null;
    var bits = iso.split('-');
    return { year: Number(bits[0]), month: Number(bits[1]), day: Number(bits[2]) };
  }

  /** '11 September 2026' — the form used in prose and in the payroll email. */
  function formatDateLong(iso) {
    var parts = dateParts(iso);
    if (!parts) return '';
    return parts.day + ' ' + MONTH_NAMES[parts.month - 1] + ' ' + parts.year;
  }

  /** '11 Sep 2026' — the form used in tables and labels. */
  function formatDateShort(iso) {
    var parts = dateParts(iso);
    if (!parts) return '';
    return parts.day + ' ' + MONTH_ABBR[parts.month - 1] + ' ' + parts.year;
  }

  /** '11 Sep' — for dense lists where the year is already established. */
  function formatDateCompact(iso) {
    var parts = dateParts(iso);
    if (!parts) return '';
    return parts.day + ' ' + MONTH_ABBR[parts.month - 1];
  }

  function formatWeekday(iso) {
    var number = dayNumber(iso);
    if (!Number.isFinite(number)) return '';
    return WEEKDAY_ABBR[new Date(number * MS_PER_DAY).getUTCDay()];
  }

  // ────────────────────────────────────────────────── financial years ──

  function financialYearKey(startYear) {
    return startYear + '-' + pad((startYear + 1) % 100, 2);
  }

  /** Australian financial years run 1 July to 30 June. */
  function getFinancialYearForDate(iso) {
    var parts = dateParts(iso);
    if (!parts) return null;
    return financialYearKey(parts.month >= 7 ? parts.year : parts.year - 1);
  }

  function getFinancialYearBounds(key) {
    if (!/^\d{4}-\d{2}$/.test(String(key))) return null;
    var startYear = Number(String(key).slice(0, 4));
    var start = startYear + '-07-01';
    var end = startYear + 1 + '-06-30';
    return { key: key, start: start, end: end, days: daysInclusive(start, end) };
  }

  function isWithinFinancialYear(iso, bounds) {
    if (!isValidISODate(iso) || !bounds) return false;
    return compareDates(iso, bounds.start) >= 0 && compareDates(iso, bounds.end) <= 0;
  }

  // ─────────────────────────────────────────────────────────── payroll ──

  /**
   * Every payday in [startDate, endDate], derived from a single known payday by
   * stepping a fixed interval. The anchor may sit outside the range in either
   * direction; the first in-range payday is found arithmetically, not by looping.
   */
  function generatePaydays(anchorDate, intervalDays, startDate, endDate, frequency) {
    if (frequency === 'monthly') return generateMonthlyPaydays(anchorDate, startDate, endDate);
    if (!isValidISODate(anchorDate) || !isValidISODate(startDate) || !isValidISODate(endDate)) return [];
    var interval = Math.max(1, Math.round(intervalDays) || 0);
    var anchor = dayNumber(anchorDate);
    var start = dayNumber(startDate);
    var end = dayNumber(endDate);
    if (end < start) return [];

    var paydays = [];
    var first = anchor + Math.ceil((start - anchor) / interval) * interval;
    for (var day = first; day <= end; day += interval) {
      paydays.push(fromDayNumber(day));
    }
    return paydays;
  }

  function generateMonthlyPaydays(anchorDate, startDate, endDate) {
    if (!isValidISODate(anchorDate) || !isValidISODate(startDate) || !isValidISODate(endDate)) return [];
    if (compareDates(endDate, startDate) < 0) return [];

    var cursor = anchorDate;
    var hops = 0;
    while (compareDates(cursor, startDate) > 0 && hops < 60) {
      cursor = addMonths(cursor, -1);
      hops += 1;
    }
    while (compareDates(cursor, startDate) < 0 && hops < 120) {
      cursor = addMonths(cursor, 1);
      hops += 1;
    }

    var paydays = [];
    hops = 0;
    while (cursor && compareDates(cursor, endDate) <= 0 && hops < 24) {
      paydays.push(cursor);
      var next = addMonths(cursor, 1);
      if (!next || compareDates(next, cursor) <= 0) break;
      cursor = next;
      hops += 1;
    }
    return paydays;
  }

  /**
   * The first payday a new election could realistically reach.
   * A payday falling exactly on the calculation date is assumed to be already
   * processed unless the user says otherwise.
   */
  function findFirstEligiblePayday(paydays, asAtDate, includeTodaysPayroll) {
    for (var i = 0; i < paydays.length; i += 1) {
      var difference = compareDates(paydays[i], asAtDate);
      if (difference > 0 || (difference === 0 && includeTodaysPayroll)) return paydays[i];
    }
    return null;
  }

  function countRemainingPays(paydays, effectiveDate) {
    if (!isValidISODate(effectiveDate)) return 0;
    var count = 0;
    for (var i = 0; i < paydays.length; i += 1) {
      if (compareDates(paydays[i], effectiveDate) >= 0) count += 1;
    }
    return count;
  }

  // ──────────────────────────────────────────────────────────── salary ──

  /**
   * Splits a financial year into days before and from a pay increase.
   * Returns whole calendar days; an increase outside the year collapses to a single segment.
   */
  function splitSalaryByEffectiveDate(options) {
    var fyStart = options.fyStart;
    var fyEnd = options.fyEnd;
    var totalDays = Math.max(0, daysInclusive(fyStart, fyEnd));
    var single = { oldDays: 0, newDays: totalDays, totalDays: totalDays, increaseWithinYear: false };

    if (!options.hasIncrease || !isValidISODate(options.increaseDate) || totalDays === 0) return single;

    var increase = dayNumber(options.increaseDate);
    var start = dayNumber(fyStart);
    var end = dayNumber(fyEnd);

    if (increase <= start) return single;
    if (increase > end) return { oldDays: totalDays, newDays: 0, totalDays: totalDays, increaseWithinYear: false };

    var oldDays = increase - start;
    return { oldDays: oldDays, newDays: totalDays - oldDays, totalDays: totalDays, increaseWithinYear: true };
  }

  /**
   * Calendar-day pro-rating. `denominatorDays` lets a partial period (say, the year
   * so far) be expressed as a fraction of the full financial year.
   */
  function calculateProjectedSalary(options) {
    var split = options.split;
    var denominator = options.denominatorDays || split.totalDays;
    if (!denominator) return { oldComponentCents: 0, newComponentCents: 0, totalCents: 0 };

    var oldComponentCents = Math.round((nonNegative(options.oldSalaryCents) * split.oldDays) / denominator);
    var newComponentCents = Math.round((nonNegative(options.newSalaryCents) * split.newDays) / denominator);
    return {
      oldComponentCents: oldComponentCents,
      newComponentCents: newComponentCents,
      totalCents: oldComponentCents + newComponentCents
    };
  }

  // ────────────────────────────────────────────────────── employer super ──

  /**
   * Statutory employer super on qualifying earnings.
   *
   * Salary sacrifice is deliberately absent from the inputs: it must not reduce the
   * earnings base used for the normal SG entitlement.
   *
   * When the maximum contribution base binds, the total is authoritative and the
   * salary/bonus split is a proportional estimate — which dollar of earnings crossed
   * the line depends on payroll timing SuperCap cannot know.
   */
  function calculateEmployerSuper(options) {
    var salaryEarnings = nonNegative(options.salaryEarningsCents);
    var bonusEarnings = nonNegative(options.bonusEarningsCents);
    var qualifying = salaryEarnings + bonusEarnings;
    var rate = Number.isFinite(options.sgRate) && options.sgRate > 0 ? options.sgRate : 0;

    var maxBase = options.maxBaseCents;
    var maxBaseUsable = options.applyMaxBase && Number.isFinite(maxBase) && maxBase > 0;
    var maxBaseApplied = maxBaseUsable && qualifying > maxBase;

    if (!maxBaseApplied) {
      var salarySgCents = Math.round(salaryEarnings * rate);
      var bonusSgCents = Math.round(bonusEarnings * rate);
      return {
        salarySgCents: salarySgCents,
        bonusSgCents: bonusSgCents,
        totalSgCents: salarySgCents + bonusSgCents,
        qualifyingEarningsCents: qualifying,
        contributingEarningsCents: qualifying,
        maxBaseApplied: false
      };
    }

    var totalSgCents = Math.round(maxBase * rate);
    var cappedSalarySg = qualifying > 0 ? Math.round((totalSgCents * salaryEarnings) / qualifying) : 0;
    return {
      salarySgCents: cappedSalarySg,
      bonusSgCents: totalSgCents - cappedSalarySg,
      totalSgCents: totalSgCents,
      qualifyingEarningsCents: qualifying,
      contributingEarningsCents: maxBase,
      maxBaseApplied: true
    };
  }

  // ────────────────────────────────────────────── existing sacrifice ──

  /**
   * Salary sacrifice under the arrangement being replaced: every payday in the year
   * from when it started until the new election takes over.
   */
  function calculateExistingSacrifice(options) {
    var paydays = options.paydays || [];
    var perPay = nonNegative(options.perPayCents);
    var from = isValidISODate(options.effectiveFrom) ? options.effectiveFrom : null;
    var until = options.until;

    var counted = [];
    for (var i = 0; i < paydays.length; i += 1) {
      var payday = paydays[i];
      var startedByThen = !from || compareDates(payday, from) >= 0;
      var beforeNewElection = !isValidISODate(until) || compareDates(payday, until) < 0;
      var afterFloor = !isValidISODate(options.notBefore) || compareDates(payday, options.notBefore) > 0;
      if (startedByThen && beforeNewElection && afterFloor) counted.push(payday);
    }

    return {
      cents: perPay * counted.length,
      deductionsCounted: counted.length,
      paydaysCounted: counted
    };
  }

  // ─────────────────────────────────────────────── cap and recommendation ──

  function calculateConcessionalUsage(parts) {
    return (
      nonNegative(parts.employerSalarySgCents) +
      nonNegative(parts.employerBonusSgCents) +
      nonNegative(parts.otherEmployerConcessionalCents) +
      nonNegative(parts.existingSacrificeCents) +
      nonNegative(parts.personalDeductibleCents) +
      nonNegative(parts.otherConcessionalCents)
    );
  }

  function calculateRemainingCap(options) {
    var effectiveCapCents = nonNegative(options.generalCapCents) + nonNegative(options.carryForwardCents);
    var rawRemainingCents = effectiveCapCents - nonNegative(options.usedCents);
    return {
      effectiveCapCents: effectiveCapCents,
      rawRemainingCents: rawRemainingCents,
      remainingCents: Math.max(0, rawRemainingCents),
      alreadyOverCap: rawRemainingCents < 0
    };
  }

  /**
   * Two figures, deliberately: the amount that lands exactly on the cap, and the
   * practical whole-dollar amount to give Payroll. Rounding is always down, so the
   * rounding itself can never push the projection past the target.
   */
  function calculateRecommendation(options) {
    var remaining = Math.max(0, options.remainingCents);
    var deductions = Math.max(0, Math.round(options.remainingDeductions) || 0);
    var buffer = nonNegative(options.safetyBufferCents);
    var safeRemainingCents = Math.max(0, remaining - buffer);

    if (deductions === 0) {
      return {
        remainingDeductions: 0,
        safetyBufferCents: buffer,
        safeRemainingCents: safeRemainingCents,
        exactToCapPerPayCents: 0,
        exactAfterBufferPerPayCents: 0,
        practicalPerPayCents: 0
      };
    }

    var exactToCapPerPayCents = remaining / deductions;
    var exactAfterBufferPerPayCents = safeRemainingCents / deductions;

    return {
      remainingDeductions: deductions,
      safetyBufferCents: buffer,
      safeRemainingCents: safeRemainingCents,
      exactToCapPerPayCents: exactToCapPerPayCents,
      exactAfterBufferPerPayCents: exactAfterBufferPerPayCents,
      practicalPerPayCents: Math.floor(exactAfterBufferPerPayCents / 100) * 100
    };
  }

  function roundUpToNiceCents(cents) {
    var dollars = Math.max(0, cents) / 100;
    var step = dollars <= 500 ? 50 : dollars <= 2000 ? 100 : 500;
    return Math.ceil(dollars / step) * step * 100;
  }

  /**
   * The slider must reach past the cap so an over-cap election is explorable,
   * but the ceiling is derived from the recommendation — never from the current
   * thumb position, which would grow without bound as the user dragged right.
   */
  function calculateSliderMax(options) {
    var candidates = [
      nonNegative(options.practicalPerPayCents) * 1.5,
      nonNegative(options.exactToCapPerPayCents) * 1.25,
      MIN_SLIDER_MAX_CENTS
    ];
    return roundUpToNiceCents(Math.max.apply(null, candidates));
  }

  /**
   * Projects a chosen per-pay amount onto the cap.
   * @returns {{status: 'under'|'on-target'|'near'|'over'|'exceeded'}} plus the money.
   */
  function calculateSliderProjection(options) {
    var perPay = nonNegative(options.selectedPerPayCents);
    var deductions = Math.max(0, Math.round(options.remainingDeductions) || 0);
    var futureSacrificeCents = perPay * deductions;
    var projectedTotalCents = nonNegative(options.usedCents) + futureSacrificeCents;
    var capCents = Math.max(0, options.effectiveCapCents);
    var difference = capCents - projectedTotalCents;

    var status;
    if (options.alreadyOverCap) status = 'exceeded';
    else if (difference < 0) status = 'over';
    else if (difference <= NEAR_CAP_CENTS) status = 'near';
    else if (perPay >= nonNegative(options.practicalPerPayCents) && perPay > 0) status = 'on-target';
    else status = 'under';

    return {
      selectedPerPayCents: perPay,
      remainingDeductions: deductions,
      futureSacrificeCents: futureSacrificeCents,
      projectedTotalCents: projectedTotalCents,
      headroomCents: Math.max(0, difference),
      overCents: Math.max(0, -difference),
      fractionUsed: capCents > 0 ? projectedTotalCents / capCents : 0,
      status: status
    };
  }

  // ───────────────────────────────────────────────────────────── issues ──

  function issue(level, code, title, message, placement) {
    return { level: level, code: code, title: title, message: message, placement: placement || 'result' };
  }

  // ────────────────────────────────────────────────────── rules lookup ──

  /**
   * Resolves the rules for a financial year, folding in any values the user supplied
   * manually because the ATO had not published them yet.
   */
  function resolveRules(dataset, financialYearKey, overrides) {
    var years = (dataset && dataset.financialYears) || {};
    var year = years[financialYearKey] || null;
    var bounds = getFinancialYearBounds(financialYearKey);
    var supplied = overrides || {};

    var sourceSuper = (year && year.super) || {};
    var capFromData = Number.isFinite(sourceSuper.concessionalCap) ? toCents(sourceSuper.concessionalCap) : null;
    var baseFromData = Number.isFinite(sourceSuper.maximumSgEarningsBase)
      ? toCents(sourceSuper.maximumSgEarningsBase)
      : null;
    var thresholdFromData = Number.isFinite(sourceSuper.division293Threshold)
      ? toCents(sourceSuper.division293Threshold)
      : null;

    var manualCap = Number.isFinite(supplied.manualCapCents) && supplied.manualCapCents > 0 ? supplied.manualCapCents : null;
    var manualBase = Number.isFinite(supplied.manualMaxBaseCents) && supplied.manualMaxBaseCents > 0
      ? supplied.manualMaxBaseCents
      : null;

    return {
      key: financialYearKey,
      known: Boolean(year),
      label: (year && year.label) || 'FY' + financialYearKey,
      shortLabel: (year && year.shortLabel) || 'FY' + String(financialYearKey).slice(-2),
      bounds: bounds,
      sgRate: Number.isFinite(supplied.sgRate) && supplied.sgRate > 0
        ? supplied.sgRate
        : Number.isFinite(sourceSuper.sgRate) ? sourceSuper.sgRate : 0,
      capCents: manualCap !== null ? manualCap : capFromData,
      capIsManual: manualCap !== null && capFromData === null,
      capIsOverridden: manualCap !== null && capFromData !== null && manualCap !== capFromData,
      capFromDataCents: capFromData,
      maxBaseCents: manualBase !== null ? manualBase : baseFromData,
      maxBaseIsManual: manualBase !== null && baseFromData === null,
      division293ThresholdCents: thresholdFromData,
      defaults: (year && year.defaults) || {},
      metadata: (year && year.metadata) || {}
    };
  }

  // ───────────────────────────────────────────────────── default state ──

  /**
   * Picks the financial year to open on: this year if the dataset knows about it
   * (even with gaps in its rules), otherwise the nearest year it does know.
   */
  function chooseFinancialYear(dataset, today) {
    var available = Object.keys((dataset && dataset.financialYears) || {}).sort();
    var current = getFinancialYearForDate(today);
    if (!available.length) return current;
    if (available.indexOf(current) !== -1) return current;

    var currentStart = Number(String(current).slice(0, 4));
    return available.reduce(function (best, key) {
      var distance = Math.abs(Number(key.slice(0, 4)) - currentStart);
      var bestDistance = Math.abs(Number(best.slice(0, 4)) - currentStart);
      return distance < bestDistance ? key : best;
    }, available[0]);
  }

  /** A complete, valid state object. All money in cents, all dates ISO. */
  function createDefaultState(dataset, today) {
    var todayDate = isValidISODate(today) ? today : todayISO();
    var key = chooseFinancialYear(dataset, todayDate);
    var bounds = getFinancialYearBounds(key);
    var year = ((dataset && dataset.financialYears) || {})[key] || {};
    var payrollDefaults = (dataset && dataset.payrollDefaults) || {};
    var example = (dataset && dataset.exampleFigures) || {};

    var startYear = Number(String(key).slice(0, 4));
    var cadence = payCadence(payrollDefaults.frequency || 'fortnightly');
    var intervalDays = cadence.intervalDays;
    var anchorDate = isValidISODate(payrollDefaults.anchorDate) ? payrollDefaults.anchorDate : bounds.start;

    var increaseMonth = payrollDefaults.salaryIncreaseMonth || 9;
    var increaseDay = payrollDefaults.salaryIncreaseDay || 1;
    var increaseDate =
      (year.defaults && year.defaults.salaryIncreaseDate) ||
      startYear + '-' + pad(increaseMonth, 2) + '-' + pad(increaseDay, 2);

    // Where the dataset has no bonus date for a year, fall back to the first payday
    // on or after the usual increase date rather than inventing an arbitrary one.
    var bonusPaymentDate = (year.defaults && year.defaults.bonusPaymentDate) || null;
    if (!isValidISODate(bonusPaymentDate)) {
      var paydays = generatePaydays(anchorDate, intervalDays, bounds.start, bounds.end, cadence.frequency);
      bonusPaymentDate = findFirstEligiblePayday(paydays, increaseDate, true) || paydays[0] || increaseDate;
    }

    return {
      financialYearKey: key,
      asAtDate: clampDate(todayDate, bounds.start, bounds.end) || bounds.start,

      salary: {
        hasIncrease: true,
        beforeCents: toCents(example.salaryBefore || 0),
        afterCents: toCents(example.salaryAfter || example.salaryBefore || 0),
        increaseDate: increaseDate
      },

      bonus: {
        amountCents: toCents(example.bonus || 0),
        paymentDate: bonusPaymentDate,
        attractsSuper: true
      },

      employerSuper: {
        sgRate: (year.super && year.super.sgRate) || 0.12,
        applyMaxBase: true
      },

      cap: {
        manualCapCents: null,
        manualMaxBaseCents: null,
        carryForwardCents: 0
      },

      payroll: {
        frequency: cadence.frequency,
        anchorDate: anchorDate,
        intervalDays: intervalDays,
        includeTodaysPayroll: false,
        newSacrificeEffectiveDate: null
      },

      existing: {
        mode: 'actual',
        actualCents: 0,
        perPayCents: toCents(example.existingSacrificePerPay || 0),
        effectiveFrom: bounds.start
      },

      other: {
        employerConcessionalCents: 0,
        personalDeductibleCents: 0,
        otherConcessionalCents: 0
      },

      actuals: {
        enabled: false,
        employerReceivedCents: 0,
        salarySacrificeReceivedCents: 0,
        otherReceivedCents: 0
      },

      safetyBufferCents: toCents(example.safetyBuffer === undefined ? 50 : example.safetyBuffer),
      safetyBufferCustom: false,
      selectedPerPayCents: null
    };
  }

  // ────────────────────────────────────────────────────── main pipeline ──

  /**
   * The single derived-state model. Everything the UI shows comes from this one call,
   * so no two parts of the interface can disagree about a number.
   *
   * @param {object} state user inputs, all money in cents and all dates ISO strings
   * @param {object} dataset window.SUPERCAP_DATA
   */
  function calculate(state, dataset) {
    var issues = [];

    var rules = resolveRules(dataset, state.financialYearKey, {
      manualCapCents: state.cap.manualCapCents,
      manualMaxBaseCents: state.cap.manualMaxBaseCents,
      sgRate: state.employerSuper.sgRate
    });

    var bounds = rules.bounds;
    var asAtDate = clampDate(state.asAtDate, bounds.start, bounds.end) || bounds.start;
    var asAtOutsideYear = isValidISODate(state.asAtDate) && !isWithinFinancialYear(state.asAtDate, bounds);

    // ── payroll calendar ──
    var cadence = payCadence(state.payroll.frequency);
    var paydays = generatePaydays(
      state.payroll.anchorDate,
      cadence.intervalDays,
      bounds.start,
      bounds.end,
      cadence.frequency
    );
    var firstEligible = findFirstEligiblePayday(paydays, asAtDate, state.payroll.includeTodaysPayroll);

    var effectiveDate = state.payroll.newSacrificeEffectiveDate;
    if (!effectiveDate || paydays.indexOf(effectiveDate) === -1) effectiveDate = firstEligible;

    var remainingDeductions = countRemainingPays(paydays, effectiveDate);
    var firstDeduction = effectiveDate;
    var lastDeduction = remainingDeductions > 0 ? paydays[paydays.length - 1] : null;
    var nextPayday = findFirstEligiblePayday(paydays, asAtDate, false);

    if (paydays.length === 0) {
      issues.push(
        issue(
          'error',
          'no-paydays',
          'No paydays found',
          'Check the known payday and pay cycle length. SuperCap could not generate any paydays inside ' +
            rules.label +
            '.',
          'payroll'
        )
      );
    } else if (remainingDeductions === 0) {
      issues.push(
        issue(
          'warning',
          'no-remaining-pays',
          'No pays left this year',
          'There are no more paydays in ' +
            rules.label +
            ' after ' +
            formatDateLong(asAtDate) +
            ', so a new ' +
            cadence.adjective +
            ' election cannot contribute anything this year. A one-off contribution may still be possible. Check with Payroll.',
          'result'
        )
      );
    }

    // ── salary ──
    var fullYearSplit = splitSalaryByEffectiveDate({
      fyStart: bounds.start,
      fyEnd: bounds.end,
      increaseDate: state.salary.increaseDate,
      hasIncrease: state.salary.hasIncrease
    });

    var salary = calculateProjectedSalary({
      oldSalaryCents: state.salary.beforeCents,
      newSalaryCents: state.salary.hasIncrease ? state.salary.afterCents : state.salary.beforeCents,
      split: fullYearSplit
    });

    if (state.salary.hasIncrease && isValidISODate(state.salary.increaseDate) && !fullYearSplit.increaseWithinYear) {
      issues.push(
        issue(
          'info',
          'increase-outside-year',
          'Pay increase outside this year',
          formatDateLong(state.salary.increaseDate) +
            ' falls outside ' +
            rules.label +
            ', so a single salary rate applies for the whole year.',
          'salary'
        )
      );
    }

    // ── bonus ──
    var bonusCents = nonNegative(state.bonus.amountCents);
    var bonusDate = state.bonus.paymentDate;
    var bonusInYear = bonusCents > 0 && isWithinFinancialYear(bonusDate, bounds);
    var bonusEarningsCents = bonusInYear && state.bonus.attractsSuper ? bonusCents : 0;
    var bonusAlreadyPaid = bonusInYear && compareDates(bonusDate, asAtDate) <= 0;

    if (bonusCents > 0 && isValidISODate(bonusDate) && !bonusInYear) {
      issues.push(
        issue(
          'info',
          'bonus-outside-year',
          'Bonus falls outside this year',
          'A bonus paid on ' +
            formatDateLong(bonusDate) +
            ' counts towards ' +
            (getFinancialYearForDate(bonusDate) || 'another financial year') +
            ', not ' +
            rules.label +
            '. SuperCap uses the payment date, not the performance period, so it is excluded here.',
          'bonus'
        )
      );
    }

    // ── employer super ──
    var employer = calculateEmployerSuper({
      salaryEarningsCents: salary.totalCents,
      bonusEarningsCents: bonusEarningsCents,
      sgRate: rules.sgRate,
      applyMaxBase: state.employerSuper.applyMaxBase,
      maxBaseCents: rules.maxBaseCents
    });

    if (state.employerSuper.applyMaxBase && !Number.isFinite(rules.maxBaseCents)) {
      issues.push(
        issue(
          'warning',
          'max-base-unknown',
          'Maximum contribution base unknown',
          'SuperCap does not have a maximum contribution base for ' +
            rules.label +
            ', so employer super has been estimated on all qualifying earnings.',
          'result'
        )
      );
    } else if (employer.maxBaseApplied) {
      issues.push(
        issue(
          'info',
          'max-base-applied',
          'Maximum contribution base applied',
          'Your estimated qualifying earnings of ' +
            formatCurrency(employer.qualifyingEarningsCents) +
            ' exceed the ' +
            rules.label +
            ' maximum contribution base of ' +
            formatCurrency(rules.maxBaseCents) +
            ', so the statutory employer super estimate has been capped at ' +
            formatCurrency(employer.totalSgCents) +
            '. If your employer pays super above the statutory minimum, turn this off in Advanced.',
          'result'
        )
      );
    }

    // ── contributions already received, when actual figures are in play ──
    var usingActuals = Boolean(state.actuals.enabled);
    var employerSalarySgCents = employer.salarySgCents;
    var employerBonusSgCents = employer.bonusSgCents;
    var actualEmployerCents = 0;
    var projectedRemainingEmployerCents = 0;

    if (usingActuals) {
      var elapsedSplit = splitSalaryByEffectiveDate({
        fyStart: bounds.start,
        fyEnd: asAtDate,
        increaseDate: state.salary.increaseDate,
        hasIncrease: state.salary.hasIncrease
      });
      var salaryToDate = calculateProjectedSalary({
        oldSalaryCents: state.salary.beforeCents,
        newSalaryCents: state.salary.hasIncrease ? state.salary.afterCents : state.salary.beforeCents,
        split: elapsedSplit,
        denominatorDays: fullYearSplit.totalDays
      });

      var earningsToDate = salaryToDate.totalCents + (bonusAlreadyPaid ? bonusEarningsCents : 0);
      var estimatedSgToDate =
        employer.qualifyingEarningsCents > 0
          ? Math.round((employer.totalSgCents * earningsToDate) / employer.qualifyingEarningsCents)
          : 0;

      actualEmployerCents = nonNegative(state.actuals.employerReceivedCents);
      projectedRemainingEmployerCents = Math.max(0, employer.totalSgCents - estimatedSgToDate);

      var blendedEmployerTotal = actualEmployerCents + projectedRemainingEmployerCents;
      // Keep the salary/bonus split proportional to the estimate so the meter still adds up.
      employerSalarySgCents =
        employer.totalSgCents > 0
          ? Math.round((blendedEmployerTotal * employer.salarySgCents) / employer.totalSgCents)
          : blendedEmployerTotal;
      employerBonusSgCents = blendedEmployerTotal - employerSalarySgCents;

      issues.push(
        issue(
          'info',
          'using-actuals',
          'Using actual fund figures',
          'Contributions received up to ' +
            formatDateLong(asAtDate) +
            ' come from the actual amounts you entered. Everything after that date is still a SuperCap estimate.',
          'result'
        )
      );
    }

    // ── existing salary sacrifice ──
    var existing;
    if (state.existing.mode === 'payroll') {
      existing = calculateExistingSacrifice({
        paydays: paydays,
        perPayCents: state.existing.perPayCents,
        effectiveFrom: state.existing.effectiveFrom,
        until: effectiveDate,
        notBefore: usingActuals ? asAtDate : null
      });
    } else {
      existing = { cents: nonNegative(state.existing.actualCents), deductionsCounted: 0, paydaysCounted: [] };
    }

    var existingSacrificeCents = usingActuals
      ? nonNegative(state.actuals.salarySacrificeReceivedCents) + (state.existing.mode === 'payroll' ? existing.cents : 0)
      : existing.cents;

    // ── other concessional contributions ──
    var otherEmployerCents = usingActuals ? 0 : nonNegative(state.other.employerConcessionalCents);
    var personalDeductibleCents = usingActuals ? 0 : nonNegative(state.other.personalDeductibleCents);
    var otherConcessionalCents = usingActuals
      ? nonNegative(state.actuals.otherReceivedCents)
      : nonNegative(state.other.otherConcessionalCents);
    var otherTotalCents = otherEmployerCents + personalDeductibleCents + otherConcessionalCents;

    // ── cap ──
    var capIsKnown = Number.isFinite(rules.capCents);

    if (!capIsKnown) {
      issues.push(
        issue(
          'error',
          'cap-unknown',
          'Concessional cap not available',
          'The concessional contributions cap for ' +
            rules.label +
            ' is indexed and had not been published when this rules data was compiled. Enter the cap manually to continue.',
          'cap'
        )
      );
    } else if (rules.capIsManual) {
      issues.push(
        issue(
          'info',
          'cap-manual',
          'Manually entered cap',
          'You entered the ' + rules.label + ' concessional cap yourself. SuperCap has not verified this figure.',
          'cap'
        )
      );
    } else if (rules.capIsOverridden) {
      issues.push(
        issue(
          'info',
          'cap-overridden',
          'Cap overridden',
          'You are using ' +
            formatCurrency(rules.capCents) +
            ' instead of the published ' +
            rules.label +
            ' cap of ' +
            formatCurrency(rules.capFromDataCents) +
            '.',
          'cap'
        )
      );
    }

    var usedCents = calculateConcessionalUsage({
      employerSalarySgCents: employerSalarySgCents,
      employerBonusSgCents: employerBonusSgCents,
      otherEmployerConcessionalCents: otherEmployerCents,
      existingSacrificeCents: existingSacrificeCents,
      personalDeductibleCents: personalDeductibleCents,
      otherConcessionalCents: otherConcessionalCents
    });

    var capState = calculateRemainingCap({
      generalCapCents: capIsKnown ? rules.capCents : 0,
      carryForwardCents: state.cap.carryForwardCents,
      usedCents: usedCents
    });

    // Without a cap there is nothing to be over: the zero standing in for the unknown
    // figure would otherwise report every contribution as an overshoot.
    if (capState.alreadyOverCap && capIsKnown) {
      issues.push(
        issue(
          'warning',
          'already-over-cap',
          'Cap already exceeded',
          'Your projected contributions before any new salary sacrifice are ' +
            formatCurrency(-capState.rawRemainingCents) +
            ' above your ' +
            rules.label +
            ' cap. SuperCap recommends no additional salary sacrifice.',
          'result'
        )
      );
    }

    // ── recommendation ──
    var recommendation = calculateRecommendation({
      remainingCents: capState.remainingCents,
      remainingDeductions: remainingDeductions,
      safetyBufferCents: state.safetyBufferCents
    });

    var sliderMaxCents = calculateSliderMax({
      practicalPerPayCents: recommendation.practicalPerPayCents,
      exactToCapPerPayCents: recommendation.exactToCapPerPayCents
    });

    var selectedPerPayCents = Number.isFinite(state.selectedPerPayCents)
      ? Math.max(0, Math.round(state.selectedPerPayCents))
      : recommendation.practicalPerPayCents;
    selectedPerPayCents = Math.min(selectedPerPayCents, sliderMaxCents);

    var projection = calculateSliderProjection({
      selectedPerPayCents: selectedPerPayCents,
      remainingDeductions: remainingDeductions,
      usedCents: usedCents,
      effectiveCapCents: capState.effectiveCapCents,
      practicalPerPayCents: recommendation.practicalPerPayCents,
      alreadyOverCap: capState.alreadyOverCap
    });

    // ── Division 293 ──
    var incomeProxyCents = salary.totalCents + (bonusInYear ? bonusCents : 0) + projection.projectedTotalCents;
    var division293Applies =
      Number.isFinite(rules.division293ThresholdCents) && incomeProxyCents >= rules.division293ThresholdCents;

    if (division293Applies) {
      issues.push(
        issue(
          'info',
          'division-293',
          'You may be affected by Division 293 tax',
          'Your income plus concessional contributions is around ' +
            formatCurrency(incomeProxyCents) +
            ', which is at or above the ' +
            formatCurrency(rules.division293ThresholdCents) +
            ' Division 293 threshold. High-income earners pay an extra 15% tax on some concessional contributions. SuperCap does not calculate this. Check with the ATO or your adviser.',
          'result'
        )
      );
    }

    if (asAtOutsideYear) {
      issues.push(
        issue(
          'info',
          'as-at-outside-year',
          'Calculation date adjusted',
          formatDateLong(state.asAtDate) +
            ' is outside ' +
            rules.label +
            ', so SuperCap has calculated as at ' +
            formatDateLong(asAtDate) +
            '.',
          'result'
        )
      );
    }

    var meter = buildMeter({
      capCents: capState.effectiveCapCents,
      projectedTotalCents: projection.projectedTotalCents,
      segments: [
        { key: 'salary-sg', label: 'Employer super (salary)', cents: employerSalarySgCents },
        { key: 'bonus-sg', label: 'Employer super (bonus)', cents: employerBonusSgCents },
        { key: 'existing', label: 'Salary sacrifice so far', cents: existingSacrificeCents },
        { key: 'other', label: 'Other concessional', cents: otherTotalCents },
        { key: 'future', label: 'Future salary sacrifice', cents: projection.futureSacrificeCents }
      ]
    });

    return {
      hasBlockingIssue: issues.some(function (item) {
        return item.level === 'error';
      }),
      issues: issues,

      financialYear: {
        key: rules.key,
        label: rules.label,
        shortLabel: rules.shortLabel,
        start: bounds.start,
        end: bounds.end,
        days: bounds.days,
        known: rules.known,
        status: rules.metadata.status || 'unknown',
        verified: rules.metadata.verified || null,
        note: rules.metadata.note || ''
      },

      rules: {
        sgRate: rules.sgRate,
        capCents: rules.capCents,
        capIsManual: rules.capIsManual,
        capIsOverridden: rules.capIsOverridden,
        maxBaseCents: rules.maxBaseCents,
        maxBaseKnown: Number.isFinite(rules.maxBaseCents),
        division293ThresholdCents: rules.division293ThresholdCents
      },

      asAtDate: asAtDate,

      salary: {
        hasIncrease: state.salary.hasIncrease,
        increaseDate: state.salary.increaseDate,
        increaseWithinYear: fullYearSplit.increaseWithinYear,
        oldDays: fullYearSplit.oldDays,
        newDays: fullYearSplit.newDays,
        totalDays: fullYearSplit.totalDays,
        oldComponentCents: salary.oldComponentCents,
        newComponentCents: salary.newComponentCents,
        projectedCents: salary.totalCents
      },

      bonus: {
        amountCents: bonusCents,
        paymentDate: bonusDate,
        withinYear: bonusInYear,
        attractsSuper: state.bonus.attractsSuper,
        qualifyingEarningsCents: bonusEarningsCents,
        alreadyPaid: bonusAlreadyPaid
      },

      employer: {
        salarySgCents: employerSalarySgCents,
        bonusSgCents: employerBonusSgCents,
        totalSgCents: employerSalarySgCents + employerBonusSgCents,
        estimateOnlyTotalCents: employer.totalSgCents,
        qualifyingEarningsCents: employer.qualifyingEarningsCents,
        contributingEarningsCents: employer.contributingEarningsCents,
        maxBaseApplied: employer.maxBaseApplied,
        actualReceivedCents: actualEmployerCents,
        projectedRemainingCents: projectedRemainingEmployerCents
      },

      payroll: {
        paydays: paydays,
        paydayCount: paydays.length,
        frequency: cadence.frequency,
        cadence: cadence,
        anchorDate: state.payroll.anchorDate,
        intervalDays: cadence.intervalDays,
        effectiveDate: effectiveDate,
        firstEligibleDate: firstEligible,
        nextPayday: nextPayday,
        remainingDeductions: remainingDeductions,
        firstDeduction: remainingDeductions > 0 ? firstDeduction : null,
        lastDeduction: lastDeduction,
        includeTodaysPayroll: Boolean(state.payroll.includeTodaysPayroll)
      },

      existing: {
        mode: state.existing.mode,
        cents: existingSacrificeCents,
        deductionsCounted: existing.deductionsCounted,
        paydaysCounted: existing.paydaysCounted,
        perPayCents: nonNegative(state.existing.perPayCents)
      },

      other: {
        employerConcessionalCents: otherEmployerCents,
        personalDeductibleCents: personalDeductibleCents,
        otherConcessionalCents: otherConcessionalCents,
        totalCents: otherTotalCents
      },

      usage: {
        usedBeforeFutureSacrificeCents: usedCents,
        generalCapCents: Number.isFinite(rules.capCents) ? rules.capCents : 0,
        carryForwardCents: nonNegative(state.cap.carryForwardCents),
        effectiveCapCents: capState.effectiveCapCents,
        rawRemainingCents: capState.rawRemainingCents,
        remainingCents: capState.remainingCents,
        alreadyOverCap: capState.alreadyOverCap
      },

      recommendation: recommendation,

      slider: {
        minCents: 0,
        maxCents: sliderMaxCents,
        stepCents: 100,
        valueCents: selectedPerPayCents,
        isRecommendation: selectedPerPayCents === recommendation.practicalPerPayCents
      },

      projection: projection,
      meter: meter,

      division293: {
        applies: division293Applies,
        thresholdCents: rules.division293ThresholdCents,
        incomeProxyCents: incomeProxyCents
      },

      usingActuals: usingActuals
    };
  }

  /**
   * Lays the cap meter out against whichever is larger — the cap or the projection —
   * so an over-cap election extends past a visible cap line instead of silently
   * clipping. Percentages are of that same scale, so segments always tile exactly.
   */
  function buildMeter(options) {
    var capCents = Math.max(0, options.capCents);
    var scaleCents = Math.max(capCents, options.projectedTotalCents, 1);

    var segments = options.segments
      .filter(function (segment) {
        return segment.cents > 0;
      })
      .map(function (segment) {
        return {
          key: segment.key,
          label: segment.label,
          cents: segment.cents,
          percent: (segment.cents / scaleCents) * 100
        };
      });

    var availableCents = Math.max(0, capCents - options.projectedTotalCents);

    return {
      capCents: capCents,
      scaleCents: scaleCents,
      totalCents: options.projectedTotalCents,
      segments: segments,
      availableCents: availableCents,
      availablePercent: (availableCents / scaleCents) * 100,
      capPercent: (capCents / scaleCents) * 100,
      overCents: Math.max(0, options.projectedTotalCents - capCents)
    };
  }

  // ─────────────────────────────────────────────────────── narrative ──

  var STATUS_LABELS = {
    under: 'Under target',
    'on-target': 'On target',
    near: 'Near the cap',
    over: 'Over the cap',
    exceeded: 'Cap already exceeded'
  };

  function describeStatus(result) {
    var projection = result.projection;
    var perPay = formatCurrency(projection.selectedPerPayCents, { decimals: 'auto' });
    var per = (result.payroll && result.payroll.cadence && result.payroll.cadence.per) || 'per fortnight';

    if (projection.status === 'exceeded') {
      return 'Your projected contributions already exceed your ' + result.financialYear.shortLabel + ' cap.';
    }
    if (projection.status === 'over') {
      return (
        perPay +
        ' ' +
        per +
        ' is projected to exceed your cap by about ' +
        formatCurrency(projection.overCents) +
        '.'
      );
    }
    if (projection.status === 'near') {
      return (
        perPay +
        ' ' +
        per +
        ' projects to within ' +
        formatCurrency(projection.headroomCents) +
        ' of the cap.'
      );
    }
    if (projection.status === 'on-target') {
      return (
        perPay +
        ' ' +
        per +
        ' projects to ' +
        formatCurrency(projection.projectedTotalCents) +
        ', about ' +
        formatCurrency(projection.headroomCents) +
        ' below the cap.'
      );
    }
    return (
      perPay +
      ' ' +
      per +
      ' leaves about ' +
      formatCurrency(projection.headroomCents) +
      ' of your cap unused.'
    );
  }

  /** Plain-English walk-through of the actual numbers, assembled from real values only. */
  function explainResult(result) {
    var sentences = [];
    var year = result.financialYear.shortLabel;

    var employerSentence =
      'Your employer is estimated to contribute ' +
      formatCurrency(result.employer.totalSgCents) +
      ' to super during ' +
      year;
    if (result.bonus.withinYear && result.bonus.attractsSuper && result.employer.bonusSgCents > 0) {
      employerSentence +=
        ', including about ' +
        formatCurrency(result.employer.bonusSgCents) +
        ' from your bonus paid on ' +
        formatDateLong(result.bonus.paymentDate);
    }
    sentences.push(employerSentence + '.');

    if (result.usage.alreadyOverCap) {
      sentences.push(
        'That already puts you about ' +
          formatCurrency(-result.usage.rawRemainingCents) +
          ' past your ' +
          year +
          ' cap of ' +
          formatCurrency(result.usage.effectiveCapCents) +
          ', so no further salary sacrifice is recommended.'
      );
      return sentences.join(' ');
    }

    var capSentence = 'After ';
    if (result.existing.cents > 0) {
      capSentence += 'the ' + formatCurrency(result.existing.cents) + ' already salary sacrificed';
      if (result.other.totalCents > 0) {
        capSentence += ' and ' + formatCurrency(result.other.totalCents) + ' of other concessional contributions';
      }
    } else if (result.other.totalCents > 0) {
      capSentence += formatCurrency(result.other.totalCents) + ' of other concessional contributions';
    } else {
      capSentence += 'employer contributions';
    }
    capSentence +=
      ', about ' +
      formatCurrency(result.usage.remainingCents) +
      ' of your ' +
      formatCurrency(result.usage.effectiveCapCents) +
      ' ' +
      year +
      ' cap remains.';
    sentences.push(capSentence);

    if (result.payroll.remainingDeductions > 0) {
      sentences.push(
        'Across ' +
          result.payroll.remainingDeductions +
          ' remaining ' +
          result.payroll.cadence.adjective +
          ' ' +
          (result.payroll.remainingDeductions === 1 ? 'pay' : 'pays') +
          ', that is about ' +
          formatCurrency(result.recommendation.exactToCapPerPayCents, { decimals: 2 }) +
          ' per pay, or ' +
          formatCurrency(result.recommendation.practicalPerPayCents) +
          ' once a ' +
          formatCurrency(result.recommendation.safetyBufferCents) +
          ' buffer is left in reserve.'
      );
    }

    sentences.push(describeStatus(result));
    return sentences.join(' ');
  }

  return {
    // money
    toCents: toCents,
    fromCents: fromCents,
    formatCurrency: formatCurrency,
    formatAmount: formatAmount,
    parseCurrency: parseCurrency,
    formatPercent: formatPercent,

    // dates
    isValidISODate: isValidISODate,
    dayNumber: dayNumber,
    fromDayNumber: fromDayNumber,
    addDays: addDays,
    addMonths: addMonths,
    payCadence: payCadence,
    compareDates: compareDates,
    daysInclusive: daysInclusive,
    clampDate: clampDate,
    todayISO: todayISO,
    formatDateLong: formatDateLong,
    formatDateShort: formatDateShort,
    formatDateCompact: formatDateCompact,
    formatWeekday: formatWeekday,

    // financial years
    financialYearKey: financialYearKey,
    getFinancialYearForDate: getFinancialYearForDate,
    getFinancialYearBounds: getFinancialYearBounds,
    isWithinFinancialYear: isWithinFinancialYear,

    // payroll
    generatePaydays: generatePaydays,
    findFirstEligiblePayday: findFirstEligiblePayday,
    countRemainingPays: countRemainingPays,

    // components
    splitSalaryByEffectiveDate: splitSalaryByEffectiveDate,
    calculateProjectedSalary: calculateProjectedSalary,
    calculateEmployerSuper: calculateEmployerSuper,
    calculateExistingSacrifice: calculateExistingSacrifice,
    calculateConcessionalUsage: calculateConcessionalUsage,
    calculateRemainingCap: calculateRemainingCap,
    calculateRecommendation: calculateRecommendation,
    calculateSliderMax: calculateSliderMax,
    calculateSliderProjection: calculateSliderProjection,
    resolveRules: resolveRules,

    // pipeline
    createDefaultState: createDefaultState,
    chooseFinancialYear: chooseFinancialYear,
    calculate: calculate,
    describeStatus: describeStatus,
    explainResult: explainResult,
    statusLabel: function (status) {
      return STATUS_LABELS[status] || '';
    }
  };
})();
