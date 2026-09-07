/**
 * SuperCap — user interface.
 *
 * The shape of this file is deliberately flat: read inputs into one state object,
 * hand it to SuperCapCalc.calculate(), render the single result object. No component
 * recalculates anything for itself, so no two figures on the page can disagree.
 *
 * All text reaches the DOM through textContent or input.value. Nothing user-supplied
 * is ever assembled into HTML.
 */
(function () {
  'use strict';

  var Calc = window.SuperCapCalc;
  var DATA = window.SUPERCAP_DATA;

  var APP_VERSION = 'v0.1';
  var STORAGE_KEY = 'supercap:v1:state';
  var STORAGE_VERSION = 2;

  var SETUP_STEPS = [
    { id: 'year', label: 'Year' },
    { id: 'salary', label: 'Salary' },
    { id: 'bonus', label: 'Bonus' },
    { id: 'payroll', label: 'Payroll' },
    { id: 'existing', label: 'So far' },
    { id: 'carry', label: 'Carry' }
  ];

  var ICONS = { info: '#i-info', success: '#i-check', warning: '#i-warning', error: '#i-error' };

  var FREQUENCY_WORDS = {
    weekly: 'per week',
    fortnightly: 'per fortnight',
    'per-pay': 'per pay',
    monthly: 'per month',
    annual: 'per year'
  };

  var state = null;
  var email = null;
  var journey = null;
  var pristine = true;
  var result = null;
  var toastTimer = null;

  // ────────────────────────────────────────────────────────── DOM helpers ──

  function field(name) {
    return document.querySelector('[data-field="' + name + '"]');
  }

  function region(name) {
    return document.querySelector('[data-region="' + name + '"]');
  }

  function setText(name, value) {
    var element = field(name);
    if (element) element.textContent = value;
  }

  function show(element, visible) {
    if (element) element.classList.toggle('is-hidden', !visible);
  }

  function clear(element) {
    while (element && element.firstChild) element.removeChild(element.firstChild);
  }

  function template(id) {
    return document.getElementById(id).content.firstElementChild.cloneNode(true);
  }

  function money(cents, decimals) {
    return Calc.formatCurrency(cents, { decimals: decimals === undefined ? 0 : decimals });
  }

  // ────────────────────────────────────────────────────────── state paths ──

  function getPath(object, path) {
    return path.split('.').reduce(function (current, key) {
      return current === null || current === undefined ? undefined : current[key];
    }, object);
  }

  function setPath(object, path, value) {
    var keys = path.split('.');
    var last = keys.pop();
    var target = keys.reduce(function (current, key) {
      return current[key];
    }, object);
    target[last] = value;
  }

  // ────────────────────────────────────────────────────────── persistence ──

  function loadStored() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || (parsed.version !== 1 && parsed.version !== STORAGE_VERSION)) return null;
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function save() {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: STORAGE_VERSION,
          state: state,
          email: email,
          pristine: pristine,
          journey: journey
        })
      );
    } catch (error) {
      // Private browsing or a full quota. The app still works for this session.
    }
  }

  function forget() {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      // Nothing to do — defaults are restored in memory regardless.
    }
  }

  /**
   * Copies stored values over the defaults, but only where the key exists in the
   * defaults and the type still matches. Anything unrecognised or corrupt is dropped,
   * so an old or hand-edited payload degrades to defaults instead of breaking.
   */
  function mergeInto(defaults, stored) {
    if (!stored || typeof stored !== 'object') return defaults;

    Object.keys(defaults).forEach(function (key) {
      var fallback = defaults[key];
      var candidate = stored[key];
      if (candidate === undefined) return;

      if (fallback !== null && typeof fallback === 'object' && !Array.isArray(fallback)) {
        mergeInto(fallback, candidate);
        return;
      }
      if (fallback === null || candidate === null || typeof candidate === typeof fallback) {
        defaults[key] = candidate;
      }
    });

    return defaults;
  }

  function defaultJourney() {
    return {
      phase: 'welcome',
      step: 'year',
      furthest: 0,
      returnToResults: false,
      showAdvanced: false
    };
  }

  function defaultEmail() {
    return {
      amountCents: null, // null follows the slider
      frequency: 'fortnightly',
      effectiveDate: null, // null follows the calculator
      name: '',
      subject: 'Salary sacrifice superannuation change',
      body: '',
      subjectDirty: false,
      bodyDirty: false
    };
  }

  // ─────────────────────────────────────────────────────────── input types ──

  function inputKind(element) {
    if (element.dataset.format) return element.dataset.format;
    if (element.type === 'checkbox') return 'boolean';
    if (element.type === 'date') return 'date';
    if (element.classList.contains('control--money')) return 'money';
    return 'text';
  }

  function readInput(element) {
    var kind = inputKind(element);

    if (kind === 'boolean') return element.checked;

    if (kind === 'money') {
      var cents = Calc.parseCurrency(element.value);
      if (cents === null) return 0;
      return Math.max(0, cents);
    }

    if (kind === 'percent') {
      var percent = Calc.parseCurrency(element.value);
      if (percent === null) return 0;
      return Math.max(0, percent) / 10000; // parseCurrency returns hundredths of a percent
    }

    if (kind === 'date') return Calc.isValidISODate(element.value) ? element.value : null;

    return element.value;
  }

  function writeInput(element, value) {
    // Never fight the user for the caret in the field they are typing into.
    if (document.activeElement === element) return;

    var kind = inputKind(element);

    if (kind === 'boolean') {
      element.checked = Boolean(value);
      return;
    }
    if (kind === 'money') {
      element.value = value === null || value === undefined ? '' : Calc.formatAmount(value);
      return;
    }
    if (kind === 'percent') {
      element.value = value === null || value === undefined ? '' : Calc.formatAmount(Math.round(value * 10000));
      return;
    }
    element.value = value === null || value === undefined ? '' : value;
  }

  // ──────────────────────────────────────────────────────────────── boot ──

  function boot() {
    var stored = loadStored();
    state = mergeInto(Calc.createDefaultState(DATA, Calc.todayISO()), stored && stored.state);
    email = mergeInto(defaultEmail(), stored && stored.email);
    pristine = stored ? Boolean(stored.pristine) : true;
    journey = restoreJourney(stored);

    buildFinancialYearOptions();
    bindInputs();
    bindSlider();
    bindBuffer();
    bindEmail();
    bindActions();
    window.addEventListener('resize', positionSliderMarker);
    render();
  }

  function restoreJourney(stored) {
    if (stored && stored.journey) return mergeInto(defaultJourney(), stored.journey);
    // An older save that already has real figures should land on the recommendation,
    // not send the user back through the setup they have already filled in.
    if (stored && stored.pristine === false) {
      var arrived = defaultJourney();
      arrived.phase = 'results';
      arrived.step = 'carry';
      arrived.furthest = SETUP_STEPS.length - 1;
      return arrived;
    }
    return defaultJourney();
  }

  function buildFinancialYearOptions() {
    var select = document.getElementById('in-financial-year');
    clear(select);

    Object.keys(DATA.financialYears)
      .sort()
      .forEach(function (key) {
        var year = DATA.financialYears[key];
        var option = document.createElement('option');
        option.value = key;
        option.textContent =
          year.label + (year.super.concessionalCap === null ? ' (cap not published)' : '');
        select.appendChild(option);
      });
  }

  function bindInputs() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-input]'), function (element) {
      var path = element.dataset.input;
      var eventName = element.type === 'checkbox' || element.type === 'radio' || element.tagName === 'SELECT'
        ? 'change'
        : 'input';

      element.addEventListener(eventName, function () {
        if (element.type === 'radio' && !element.checked) return;
        markTouched();
        applyInput(element, path);
        render();
        save();
      });

      if (element.classList.contains('control--money')) {
        // Editing is easier against a plain number; formatting returns on blur.
        element.addEventListener('focus', function () {
          prepareMoneyEdit(element);
        });
        element.addEventListener('blur', function () {
          writeInputForced(element, getPath(state, path));
        });
      }
    });
  }

  /**
   * Strip grouping commas for editing. A displayed zero is cleared so the next
   * digit replaces it (otherwise "0" + "150" becomes "0150"). Any other amount
   * is selected so typing overwrites it.
   */
  function prepareMoneyEdit(element) {
    var raw = Calc.parseCurrency(element.value);
    if (raw === 0) {
      element.value = '';
      return;
    }
    if (raw !== null) element.value = String(raw / 100);
    window.setTimeout(function () {
      if (document.activeElement === element) element.select();
    }, 0);
  }

  function writeInputForced(element, value) {
    var active = document.activeElement;
    if (active === element) element.blur();
    writeInput(element, value);
    if (active === element) element.focus();
  }

  function applyInput(element, path) {
    if (element.type === 'radio') {
      if (path === 'payroll.frequency') {
        applyPayrollFrequency(element.value);
        return;
      }
      setPath(state, path, element.value);
      return;
    }

    var value = readInput(element);

    // Rule overrides are optional: an empty box means "use the published figure".
    if (path === 'cap.manualCapCents' || path === 'cap.manualMaxBaseCents') {
      setPath(state, path, value > 0 ? value : null);
      return;
    }

    if (path === 'financialYearKey') {
      switchFinancialYear(value);
      return;
    }

    if (path === 'payroll.anchorDate' && !value) return;
    if (path === 'payroll.newSacrificeEffectiveDate') {
      setPath(state, path, value || null);
      return;
    }

    setPath(state, path, value);
  }

  /**
   * Moving between years rebases anything anchored to the old one, so the user is not
   * left with a bonus date or calculation date stranded outside the year they picked.
   */
  function switchFinancialYear(key) {
    var previous = state.financialYearKey;
    if (key === previous) return;

    var fresh = Calc.createDefaultState(DATA, Calc.getFinancialYearBounds(key).start);
    var offsetYears = Number(key.slice(0, 4)) - Number(previous.slice(0, 4));

    state.financialYearKey = key;
    state.asAtDate = Calc.clampDate(state.asAtDate, fresh.asAtDate, Calc.getFinancialYearBounds(key).end) || fresh.asAtDate;
    state.salary.increaseDate = shiftYears(state.salary.increaseDate, offsetYears) || fresh.salary.increaseDate;
    state.bonus.paymentDate = shiftYears(state.bonus.paymentDate, offsetYears) || fresh.bonus.paymentDate;
    state.payroll.anchorDate = state.payroll.anchorDate || fresh.payroll.anchorDate;
    state.payroll.newSacrificeEffectiveDate = null;
    state.existing.effectiveFrom = shiftYears(state.existing.effectiveFrom, offsetYears) || fresh.existing.effectiveFrom;
    state.employerSuper.sgRate = fresh.employerSuper.sgRate;
    state.selectedPerPayCents = null;
    email.effectiveDate = null;
  }

  function applyPayrollFrequency(frequency) {
    var cadence = Calc.payCadence(frequency);
    var previous = state.payroll.frequency;
    state.payroll.frequency = cadence.frequency;
    state.payroll.intervalDays = cadence.intervalDays;
    state.payroll.newSacrificeEffectiveDate = null;
    state.selectedPerPayCents = null;
    email.effectiveDate = null;
    if (email.frequency === previous || email.frequency === emailFrequencyFor(previous)) {
      email.frequency = emailFrequencyFor(cadence.frequency);
    }
  }

  function emailFrequencyFor(frequency) {
    if (frequency === 'weekly') return 'weekly';
    if (frequency === 'monthly') return 'monthly';
    return 'fortnightly';
  }

  function shiftYears(iso, years) {
    if (!Calc.isValidISODate(iso) || !years) return iso;
    var parts = iso.split('-');
    var shifted = Number(parts[0]) + years + '-' + parts[1] + '-' + parts[2];
    return Calc.isValidISODate(shifted) ? shifted : iso;
  }

  function markTouched() {
    if (!pristine) return;
    pristine = false;
    show(field('example-badge'), false);
  }

  // ─────────────────────────────────────────────────────────────── slider ──

  function bindSlider() {
    var slider = document.getElementById('in-slider');
    var amount = document.getElementById('in-slider-amount');

    slider.addEventListener('input', function () {
      markTouched();
      state.selectedPerPayCents = Number(slider.value);
      render();
      save();
    });

    amount.addEventListener('input', function () {
      var cents = Calc.parseCurrency(amount.value);
      if (cents === null) return;
      markTouched();
      state.selectedPerPayCents = Math.max(0, Math.min(cents, result.slider.maxCents));
      render();
      save();
    });

    amount.addEventListener('focus', function () {
      prepareMoneyEdit(amount);
    });

    amount.addEventListener('blur', function () {
      writeInput(amount, result.projection.selectedPerPayCents);
    });
  }

  function bindBuffer() {
    var custom = document.getElementById('in-buffer-custom');

    Array.prototype.forEach.call(document.querySelectorAll('input[name="buffer"]'), function (radio) {
      radio.addEventListener('change', function () {
        markTouched();
        if (radio.value === 'custom') {
          state.safetyBufferCustom = true;
          show(region('buffer-custom'), true);
          writeInput(custom, state.safetyBufferCents);
          custom.focus();
        } else {
          state.safetyBufferCustom = false;
          show(region('buffer-custom'), false);
          state.safetyBufferCents = Number(radio.value);
          state.selectedPerPayCents = null; // follow the new recommendation
        }
        render();
        save();
      });
    });

    custom.addEventListener('focus', function () {
      prepareMoneyEdit(custom);
    });

    custom.addEventListener('input', function () {
      var cents = Calc.parseCurrency(custom.value);
      if (cents === null) return;
      markTouched();
      state.safetyBufferCustom = true;
      state.safetyBufferCents = Math.max(0, cents);
      state.selectedPerPayCents = null;
      render();
      save();
    });
  }

  // ──────────────────────────────────────────────────────────────── email ──

  function bindEmail() {
    var amount = document.getElementById('in-email-amount');
    var frequency = document.getElementById('in-email-frequency');
    var effective = document.getElementById('in-email-effective');
    var name = document.getElementById('in-email-name');
    var subject = document.getElementById('in-email-subject');
    var body = document.getElementById('in-email-body');

    amount.addEventListener('focus', function () {
      prepareMoneyEdit(amount);
    });

    amount.addEventListener('input', function () {
      var cents = Calc.parseCurrency(amount.value);
      email.amountCents = cents === null ? null : Math.max(0, cents);
      regenerateEmail();
      render();
      save();
    });

    frequency.addEventListener('change', function () {
      email.frequency = frequency.value;
      regenerateEmail();
      render();
      save();
    });

    effective.addEventListener('change', function () {
      email.effectiveDate = effective.value || null;
      regenerateEmail();
      render();
      save();
    });

    name.addEventListener('input', function () {
      email.name = name.value;
      regenerateEmail();
      render();
      save();
    });

    subject.addEventListener('input', function () {
      email.subject = subject.value;
      email.subjectDirty = true;
      save();
    });

    body.addEventListener('input', function () {
      email.body = body.value;
      email.bodyDirty = true;
      save();
    });
  }

  /** Rebuilds the generated text, leaving anything the user has hand-edited alone. */
  function regenerateEmail(force) {
    if (force) {
      email.bodyDirty = false;
      email.subjectDirty = false;
    }
    if (!email.subjectDirty) email.subject = 'Salary sacrifice superannuation change';
    if (!email.bodyDirty) email.body = composeEmailBody();
  }

  function emailAmountCents() {
    return email.amountCents === null ? result.projection.selectedPerPayCents : email.amountCents;
  }

  function emailEffectiveDate() {
    if (email.effectiveDate && result.payroll.paydays.indexOf(email.effectiveDate) !== -1) return email.effectiveDate;
    return result.payroll.effectiveDate;
  }

  function composeEmailBody() {
    var amount = Calc.formatCurrency(emailAmountCents(), { decimals: 'auto' });
    var date = emailEffectiveDate();
    var when = date ? Calc.formatDateLong(date) : '';
    var request;

    if (email.frequency === 'one-off') {
      request =
        'Could you please make a one-off salary sacrifice superannuation contribution of ' +
        amount +
        (when ? ' from the pay dated ' + when : '') +
        '.';
    } else {
      var cadence = FREQUENCY_WORDS[email.frequency] || 'per fortnight';
      var timing =
        email.frequency === 'fortnightly' || email.frequency === 'per-pay' || email.frequency === 'weekly'
          ? 'the pay dated '
          : '';
      request =
        'Could you please update my salary sacrifice superannuation contribution to ' +
        amount +
        ' ' +
        cadence +
        (when ? ', effective from ' + timing + when : '') +
        '.';
    }

    var lines = ['Hi Payroll,', '', request];
    if (emailUsesCarryForward()) {
      lines.push(
        '',
        'I intend to use part of my confirmed unused carry-forward concessional cap. This amount may take my concessional contributions above the general annual cap, so please let me know if you need any additional instruction or arrangement from me.'
      );
    }
    lines.push('', 'Please let me know if you need anything further from me.', '', 'Thanks,');
    var signature = email.name.trim();
    if (signature) lines.push(signature);

    return lines.join('\n');
  }

  function emailUsesCarryForward() {
    if (!result || result.usage.carryForwardCents <= 0 || result.payroll.remainingDeductions <= 0) return false;
    var projected =
      result.usage.usedBeforeFutureSacrificeCents +
      emailAmountCents() * result.payroll.remainingDeductions;
    return emailAmountCents() > 0 && projected > result.usage.generalCapCents;
  }

  // ────────────────────────────────────────────────────────────── actions ──

  function bindActions() {
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('[data-action]');
      if (!trigger) return;

      var actions = {
        'reset-all': resetAll,
        'reset-anchor': resetAnchor,
        'reset-slider': resetSlider,
        'reset-email-amount': resetEmailAmount,
        'copy-email': copyEmail,
        'step-next': goNext,
        'step-back': goBack,
        'skip-bonus': skipBonus,
        'open-advanced': openAdvanced,
        'open-privacy': openPrivacy,
        'start-welcome': startWelcome,
        'edit-setup': editSetup,
        'edit-step': function () {
          goToStep(trigger.dataset.step, true);
        },
        print: function () {
          window.print();
        },
        'scroll-take-home': scrollToTakeHome
      };

      var handler = actions[trigger.dataset.action];
      if (handler) handler();
    });

    bindPrintExpansion();
    bindPrivacyDialog();
  }

  function openPrivacy() {
    var dialog = document.getElementById('privacy-dialog');
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  }

  function bindPrivacyDialog() {
    var dialog = document.getElementById('privacy-dialog');
    if (!dialog) return;

    dialog.addEventListener('keydown', function (event) {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    });

    // Native dialogs do not close when their backdrop is clicked. Treat only a click
    // on the dialog element itself—not its panel contents—as a request to dismiss.
    dialog.addEventListener('click', function (event) {
      if (event.target !== dialog) return;
      if (typeof dialog.close === 'function') dialog.close();
      else dialog.removeAttribute('open');
    });
  }

  /**
   * A collapsed <details> prints as a bare heading, so the methodology is expanded for
   * the duration of the print and put back afterwards.
   */
  function bindPrintExpansion() {
    var methodology = document.getElementById('h-method').closest('details');
    var wasOpen = false;

    window.addEventListener('beforeprint', function () {
      wasOpen = methodology.open;
      methodology.open = true;
    });

    window.addEventListener('afterprint', function () {
      methodology.open = wasOpen;
    });
  }

  function resetAll() {
    var confirmed = window.confirm(
      'Reset SuperCap?\n\nThis clears the figures saved in this browser, restores the example values and returns to the welcome page.'
    );
    if (!confirmed) return;

    forget();
    state = Calc.createDefaultState(DATA, Calc.todayISO());
    email = defaultEmail();
    journey = defaultJourney();
    pristine = true;
    regenerateEmail(true);
    render();
    var welcomeTitle = document.getElementById('welcome-title');
    if (welcomeTitle) welcomeTitle.focus();
    toast('Reset to defaults');
  }

  function startWelcome() {
    journey.phase = 'setup';
    journey.step = 'year';
    render();
    save();
    focusCurrentStep();
  }

  function stepIndex(id) {
    for (var i = 0; i < SETUP_STEPS.length; i += 1) {
      if (SETUP_STEPS[i].id === id) return i;
    }
    return id === 'advanced' ? SETUP_STEPS.length : 0;
  }

  function currentStepId() {
    return journey.step;
  }

  function goToStep(id, fromResults) {
    if (!id) return;
    if (id === 'advanced') journey.showAdvanced = true;
    journey.phase = 'setup';
    journey.step = id;
    journey.returnToResults = Boolean(fromResults);
    var index = stepIndex(id);
    if (index > journey.furthest) journey.furthest = index;
    render();
    save();
    focusCurrentStep();
  }

  function goNext() {
    if (journey.returnToResults && journey.step !== 'carry') {
      showResults();
      return;
    }
    if (journey.step === 'carry' && !journey.showAdvanced) {
      showResults();
      return;
    }
    if (journey.step === 'advanced') {
      showResults();
      return;
    }
    var index = stepIndex(journey.step);
    var next = SETUP_STEPS[index + 1];
    if (next) goToStep(next.id, false);
    else showResults();
  }

  function goBack() {
    if (journey.step === 'advanced') {
      goToStep('carry', journey.returnToResults);
      return;
    }
    var index = stepIndex(journey.step);
    if (index <= 0) return;
    goToStep(SETUP_STEPS[index - 1].id, journey.returnToResults);
  }

  function skipBonus() {
    markTouched();
    state.bonus.amountCents = 0;
    goNext();
  }

  function openAdvanced() {
    goToStep('advanced', journey.returnToResults);
  }

  function editSetup() {
    goToStep('year', false);
  }

  function showResults() {
    journey.phase = 'results';
    journey.returnToResults = false;
    journey.furthest = Math.max(journey.furthest, SETUP_STEPS.length - 1);
    render();
    save();
    var top = region('results');
    if (top) top.scrollIntoView({ block: 'start' });
  }

  function focusCurrentStep() {
    var card = document.querySelector('.step[data-step="' + journey.step + '"]');
    if (card) card.scrollIntoView({ block: 'start' });
  }


  function resetAnchor() {
    markTouched();
    state.payroll.anchorDate = DATA.payrollDefaults.anchorDate;
    state.payroll.newSacrificeEffectiveDate = null;
    render();
    save();
  }

  function resetSlider() {
    markTouched();
    state.selectedPerPayCents = null;
    render();
    save();
  }

  function resetEmailAmount() {
    email.amountCents = null;
    regenerateEmail();
    render();
    save();
  }

  function copyEmail() {
    copyToClipboard(email.body, 'Copied');
  }

  /**
   * The Clipboard API is unavailable in some browsers when a page is opened from
   * file://, so a selection-based fallback keeps copy working offline.
   */
  function copyToClipboard(text, message) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(
        function () {
          toast(message);
        },
        function () {
          legacyCopy(text, message);
        }
      );
      return;
    }
    legacyCopy(text, message);
  }

  function legacyCopy(text, message) {
    var scratch = document.createElement('textarea');
    scratch.value = text;
    scratch.setAttribute('readonly', '');
    scratch.className = 'visually-hidden';
    document.body.appendChild(scratch);
    scratch.select();

    var copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (error) {
      copied = false;
    }
    document.body.removeChild(scratch);

    toast(copied ? message : 'Press Ctrl/Cmd + C to copy');
  }

  function toast(message) {
    var element = region('toast');
    element.textContent = message;
    element.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      element.classList.remove('is-visible');
      element.textContent = '';
    }, 2400);
  }

  // ─────────────────────────────────────────────────────────────── render ──

  function render() {
    result = Calc.calculate(state, DATA);

    if (!email.bodyDirty) email.body = composeEmailBody();

    renderInputs();
    renderConditionalRegions();
    renderResultCard();
    renderSlider();
    renderMeter();
    renderStatus();
    renderIssues();
    renderBreakdown();
    renderSchedule();
    renderEmailControls();
    renderProvenance();
    renderJourney();
  }

  function renderInputs() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-input]'), function (element) {
      var path = element.dataset.input;
      var value = getPath(state, path);

      if (element.type === 'radio') {
        element.checked = element.value === value;
        return;
      }
      if (path === 'payroll.newSacrificeEffectiveDate') return; // rebuilt below with its options
      writeInput(element, value);
    });

    document.getElementById('in-max-base').placeholder = result.rules.maxBaseKnown
      ? Calc.formatAmount(result.rules.maxBaseCents)
      : 'Not published';

    document.getElementById('in-manual-cap').placeholder = result.rules.capCents
      ? Calc.formatAmount(result.rules.capCents)
      : 'Enter the cap';

    renderEffectiveDateOptions();
    renderBufferControls();

    show(field('example-badge'), pristine);
    setText('salary-note', salaryNote());
    setText('existing-note', existingNote());
  }

  function salaryNote() {
    if (!result.salary.increaseWithinYear) {
      return 'Salary is estimated using calendar-day pro-rating. Your employer\u2019s payroll may vary slightly.';
    }
    return (
      'Salary is pro-rated across ' +
      result.salary.oldDays +
      ' days at the old rate and ' +
      result.salary.newDays +
      ' at the new, from ' +
      result.salary.totalDays +
      ' days in ' +
      result.financialYear.shortLabel +
      '. Your employer\u2019s payroll may vary slightly.'
    );
  }

  function renderJourney() {
    var inWelcome = journey.phase === 'welcome';
    var inSetup = journey.phase === 'setup';
    var inResults = journey.phase === 'results';
    document.body.classList.toggle('is-welcome', inWelcome);
    document.body.classList.toggle('is-setup', inSetup);
    document.body.classList.toggle('is-results', inResults);
    show(region('welcome'), inWelcome);
    show(region('setup'), inSetup);
    show(region('results'), inResults);
    show(region('stepper'), inSetup);

    Array.prototype.forEach.call(document.querySelectorAll('[data-step]'), function (card) {
      var active = inSetup && card.getAttribute('data-step') === journey.step;
      card.classList.toggle('is-hidden', !active);
    });

    renderStepper();
    renderStepNav();
    if (!inSetup) renderAnswers();
  }

  function renderStepper() {
    var list = region('stepper-list');
    if (!list) return;
    clear(list);

    var current = stepIndex(journey.step);
    setText(
      'stepper-status',
      journey.step === 'advanced'
        ? 'Optional · Advanced'
        : 'Step ' + (current + 1) + ' of ' + SETUP_STEPS.length
    );

    SETUP_STEPS.forEach(function (step, index) {
      var node = template('tpl-stepper-item');
      var button = node.querySelector('.stepper__button');
      var reachable = index <= journey.furthest;
      node.classList.toggle('is-current', step.id === journey.step);
      node.classList.toggle('is-done', index < current || (journey.step === 'advanced' && index <= journey.furthest));
      node.classList.toggle('is-reachable', reachable && step.id !== journey.step);
      button.querySelector('.stepper__index').textContent = String(index + 1);
      button.querySelector('.stepper__label').textContent = step.label;
      button.disabled = !reachable;
      button.setAttribute('aria-current', step.id === journey.step ? 'step' : 'false');
      if (reachable) {
        button.addEventListener('click', function () {
          goToStep(step.id, journey.returnToResults);
        });
      }
      list.appendChild(node);
    });
  }

  function renderStepNav() {
    var onFirst = journey.step === 'year';
    var finishing = journey.step === 'carry' || journey.step === 'advanced' || journey.returnToResults;
    show(region('step-back'), !onFirst);
    show(region('skip-bonus'), journey.step === 'bonus');
    setText(
      'step-next-label',
      finishing ? (journey.returnToResults ? 'Back to recommendation' : 'See my recommendation') : 'Continue'
    );
  }

  function renderAnswers() {
    var list = region('answers');
    if (!list) return;
    clear(list);

    var rows = answerRows();
    rows.forEach(function (row) {
      var node = template('tpl-answer');
      var button = node.querySelector('.answers__edit');
      button.dataset.step = row.step;
      node.querySelector('.answers__label').textContent = row.label;
      node.querySelector('.answers__value').textContent = row.value;
      list.appendChild(node);
    });
  }

  function answerRows() {
    var salaryValue;
    if (state.salary.hasIncrease && result.salary.increaseWithinYear) {
      salaryValue =
        money(state.salary.beforeCents) +
        ' → ' +
        money(state.salary.afterCents) +
        ' from ' +
        Calc.formatDateShort(state.salary.increaseDate);
    } else {
      salaryValue = money(state.salary.beforeCents);
    }

    var bonusValue =
      state.bonus.amountCents > 0
        ? money(state.bonus.amountCents) +
          (state.bonus.paymentDate ? ' on ' + Calc.formatDateShort(state.bonus.paymentDate) : '') +
          (state.bonus.attractsSuper ? '' : ' · no employer super')
        : 'None this year';

    var existingValue;
    if (result.existing.cents > 0 && state.existing.mode === 'payroll') {
      existingValue =
        money(result.existing.perPayCents) +
        ' × ' +
        result.existing.deductionsCounted +
        ' · ' +
        money(result.existing.cents);
    } else if (result.existing.cents > 0) {
      existingValue = money(result.existing.cents) + ' so far';
    } else {
      existingValue = 'None so far';
    }

    var rows = [
      {
        step: 'year',
        label: 'Financial year',
        value: result.financialYear.label + ' · as at ' + Calc.formatDateShort(result.asAtDate)
      },
      { step: 'salary', label: 'Salary', value: salaryValue },
      { step: 'bonus', label: 'Bonus', value: bonusValue },
      {
        step: 'payroll',
        label: 'Payroll',
        value:
          result.payroll.cadence.adjective.charAt(0).toUpperCase() +
          result.payroll.cadence.adjective.slice(1) +
          ' from ' +
          Calc.formatDateShort(state.payroll.anchorDate) +
          (result.payroll.effectiveDate
            ? ' · starts ' + Calc.formatDateShort(result.payroll.effectiveDate)
            : '')
      },
      { step: 'existing', label: 'Sacrifice so far', value: existingValue },
      {
        step: 'carry',
        label: 'Carry-forward',
        value:
          state.cap.carryForwardCents > 0
            ? money(state.cap.carryForwardCents) + ' unused'
            : 'None entered'
      }
    ];

    var advanced = advancedSummaryParts();
    if (advanced.length > 0) {
      rows.push({ step: 'advanced', label: 'Advanced', value: advanced.join(' · ') });
    }

    return rows;
  }

  function publishedSgRate() {
    var year = DATA.financialYears && DATA.financialYears[state.financialYearKey];
    return year && year.super && Number.isFinite(year.super.sgRate) ? year.super.sgRate : null;
  }

  function hasChangedSgRate() {
    var published = publishedSgRate();
    return Number.isFinite(published) && Math.abs(state.employerSuper.sgRate - published) > 0.000001;
  }

  function formatSgRate(rate) {
    var percent = rate * 100;
    return Calc.formatPercent(rate, Number.isInteger(percent) ? 0 : 2);
  }

  function advancedSummaryParts() {
    var parts = [];

    if (hasChangedSgRate()) parts.push('SG rate ' + formatSgRate(state.employerSuper.sgRate));
    if (state.cap.manualMaxBaseCents > 0) parts.push('Maximum base ' + money(state.cap.manualMaxBaseCents));
    if (!state.employerSuper.applyMaxBase) parts.push('Maximum base not applied');

    if (state.actuals.enabled) {
      parts.push('Using actual fund figures');
      if (state.actuals.employerReceivedCents > 0) {
        parts.push(money(state.actuals.employerReceivedCents) + ' employer received');
      }
      if (state.actuals.salarySacrificeReceivedCents > 0) {
        parts.push(money(state.actuals.salarySacrificeReceivedCents) + ' sacrifice received');
      }
      if (state.actuals.otherReceivedCents > 0) {
        parts.push(money(state.actuals.otherReceivedCents) + ' other received');
      }
      return parts;
    }

    if (state.other.employerConcessionalCents > 0) {
      parts.push(money(state.other.employerConcessionalCents) + ' other employer');
    }
    if (state.other.personalDeductibleCents > 0) {
      parts.push(money(state.other.personalDeductibleCents) + ' personal deductible');
    }
    if (state.other.otherConcessionalCents > 0) {
      parts.push(money(state.other.otherConcessionalCents) + ' other concessional');
    }

    return parts;
  }

  function existingNote() {
    if (state.existing.mode !== 'payroll') return '';
    if (result.existing.deductionsCounted === 0) {
      return 'No deductions fall before your new election, so nothing is counted here.';
    }
    return (
      result.existing.deductionsCounted +
      ' ' +
      (result.existing.deductionsCounted === 1 ? 'deduction' : 'deductions') +
      ' of ' +
      money(result.existing.perPayCents) +
      ' before the new election, ' +
      money(result.existing.cents) +
      ' in total.'
    );
  }

  function renderConditionalRegions() {
    show(region('salary-after'), state.salary.hasIncrease);
    show(region('increase-date'), state.salary.hasIncrease);
    show(region('existing-actual'), state.existing.mode === 'actual');
    show(region('existing-payroll'), state.existing.mode === 'payroll');
    show(region('actuals'), state.actuals.enabled);
    show(region('manual-cap'), result.rules.capCents === null || state.cap.manualCapCents !== null);
    show(field('actual-badge'), result.usingActuals);

    var statusChip = field('rules-status');
    var status = result.financialYear.status;
    statusChip.textContent = status === 'verified' ? 'ATO published' : 'Cap not published';

    var salaryLabel = document.querySelector('[data-label="salary-before"]');
    if (salaryLabel) {
      salaryLabel.textContent = state.salary.hasIncrease ? 'Salary before increase' : 'Annual salary';
    }
    statusChip.classList.toggle('chip--warning', status !== 'verified');
  }

  function renderResultCard() {
    var projection = result.projection;
    var atRecommendation = projection.selectedPerPayCents === result.recommendation.practicalPerPayCents;

    // A missing rule makes every downstream figure meaningless, so the card asks for
    // what it needs rather than projecting confidently against a cap of nothing.
    renderBlockedState();

    document.getElementById('h-result').textContent = atRecommendation
      ? 'Recommended salary sacrifice'
      : 'Your salary sacrifice';

    setText('recommended-amount', result.hasBlockingIssue ? '-' : Calc.formatAmount(projection.selectedPerPayCents));
    setText('readout-unit', result.payroll.cadence.unit);
    setText('slider-label', 'Salary sacrifice ' + result.payroll.cadence.per);
    document.getElementById('in-slider-amount').setAttribute(
      'aria-label',
      'Salary sacrifice ' + result.payroll.cadence.per + ', in dollars'
    );
    setText('existing-perpay-label', 'Current sacrifice ' + result.payroll.cadence.per);
    setText(
      'anchor-hint',
      'Any payday from your normal ' + result.payroll.cadence.adjective + ' cycle. SuperCap works out the rest.'
    );

    var count = result.payroll.remainingDeductions;
    setText('deduction-count', count + (count === 1 ? ' deduction remaining' : ' deductions remaining'));
    setText(
      'deduction-range',
      count > 0
        ? Calc.formatDateShort(result.payroll.firstDeduction) + ' → ' + Calc.formatDateShort(result.payroll.lastDeduction)
        : 'No pays left in ' + result.financialYear.shortLabel
    );

    var takeHome = result.hasBlockingIssue ? null : Calc.describeTakeHomeImpact(result);
    show(region('readout-saving'), Boolean(takeHome));
    if (takeHome) {
      setText('takehome-amount', takeHome.lessLabel);
      setText('takehome-unit', takeHome.lessUnit);
    }
  }

  function scrollToTakeHome() {
    var target = document.getElementById('take-home');
    if (!target || target.classList.contains('is-hidden')) return;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    if (typeof target.focus === 'function') target.focus({ preventScroll: true });
  }

  function renderBlockedState() {
    var blocked = result.hasBlockingIssue;
    var blocker = result.issues.filter(function (item) {
      return item.level === 'error';
    })[0];

    document.getElementById('result').classList.toggle('result--blocked', blocked);
    show(region('result-blocked'), blocked);
    show(region('readout-currency'), !blocked);
    show(region('readout-unit'), !blocked);
    show(region('sacrifice'), !blocked);
    show(region('meter'), !blocked);
    show(region('status'), !blocked);
    if (blocked) show(region('readout-saving'), false);

    if (blocked && blocker) {
      setText('blocked-title', blocker.title);
      setText('blocked-text', blocker.message);
    }
  }

  function renderSlider() {
    if (result.hasBlockingIssue) return;

    var slider = document.getElementById('in-slider');
    var amount = document.getElementById('in-slider-amount');
    var maximum = result.slider.maxCents;

    slider.min = 0;
    slider.max = maximum;
    slider.step = result.slider.stepCents;
    slider.value = result.projection.selectedPerPayCents;
    slider.setAttribute(
      'aria-valuetext',
      money(result.projection.selectedPerPayCents) + ' ' + result.payroll.cadence.per
    );
    slider.style.setProperty('--fill', percentOf(result.projection.selectedPerPayCents, maximum) + '%');

    writeInput(amount, result.projection.selectedPerPayCents);

    setText('slider-min', '$0');
    setText('slider-max', money(maximum));

    positionSliderMarker();
    renderExactTarget();
    renderCarryForwardSliderNote();
    var reset = region('reset-slider');
    var atRecommendation =
      result.projection.selectedPerPayCents === result.recommendation.practicalPerPayCents;
    if (reset) {
      reset.disabled = atRecommendation;
      reset.setAttribute(
        'aria-label',
        atRecommendation ? 'Slider is at the recommendation' : 'Reset slider to recommendation'
      );
    }
  }

  function renderCarryForwardSliderNote() {
    var note = region('carry-forward-slider-note');
    var available = result.usage.carryForwardRemainingBeforeFutureCents;
    show(note, available > 0);
    if (available <= 0) return;
    note.textContent =
      'The recommendation stops at the general cap. You can move the slider higher into your remaining ' +
      money(available) +
      ' of confirmed carry-forward cap.';
  }

  /**
   * Place the recommended mark on the same path the range thumb travels:
   * half a thumb in, then across (width - thumb). Measure the input, not the
   * wrapper, so the label, tick and handle share one centre.
   */
  function positionSliderMarker() {
    var mark = region('slider-marker');
    var slider = document.getElementById('in-slider');
    var wrap = slider && slider.parentElement;
    if (!mark || !slider || !wrap || !result || result.hasBlockingIssue) return;

    var recommended = result.recommendation.practicalPerPayCents;
    var maximum = result.slider.maxCents;
    var awayFromRecommendation =
      result.projection.selectedPerPayCents !== recommended;
    var hasMarker = awayFromRecommendation && recommended > 0 && recommended <= maximum;

    show(mark, hasMarker);
    if (!hasMarker) return;

    setText('marker-label', 'recommended');

    var thumb = 22;
    var wrapBox = wrap.getBoundingClientRect();
    var sliderBox = slider.getBoundingClientRect();
    var travel = Math.max(0, sliderBox.width - thumb);
    var centre =
      sliderBox.left - wrapBox.left + thumb / 2 + (recommended / maximum) * travel;

    mark.style.left = centre + 'px';
  }

  function renderExactTarget() {
    var element = field('exact-target');
    clear(element);

    if (result.payroll.remainingDeductions === 0) return;

    element.appendChild(document.createTextNode('Exact to cap '));
    var exact = document.createElement('b');
    exact.textContent = Calc.formatCurrency(result.recommendation.exactToCapPerPayCents, { decimals: 2 });
    element.appendChild(exact);

    if (result.recommendation.safetyBufferCents > 0) {
      element.appendChild(
        document.createTextNode(
          ' · rounded down to leave a ' + money(result.recommendation.safetyBufferCents) + ' margin for payroll timing'
        )
      );
    } else {
      element.appendChild(document.createTextNode(' · rounded down to the nearest dollar'));
    }
  }

  function percentOf(value, total) {
    if (!total) return 0;
    return Math.max(0, Math.min(100, (value / total) * 100));
  }

  function renderBufferControls() {
    var preset = String(state.safetyBufferCents);
    var custom = Boolean(state.safetyBufferCustom);
    var matched = false;

    Array.prototype.forEach.call(document.querySelectorAll('input[name="buffer"]'), function (radio) {
      if (radio.value === 'custom') return;
      var isPreset = !custom && radio.value === preset;
      radio.checked = isPreset;
      if (isPreset) matched = true;
    });

    var usingCustom = custom || !matched;
    document.getElementById('buffer-custom').checked = usingCustom;
    show(region('buffer-custom'), usingCustom);
    if (usingCustom) writeInput(document.getElementById('in-buffer-custom'), state.safetyBufferCents);
  }

  function renderEffectiveDateOptions() {
    fillPaydayOptions(document.getElementById('in-effective'), result.payroll.effectiveDate);
    fillPaydayOptions(document.getElementById('in-email-effective'), emailEffectiveDate());
  }

  function fillPaydayOptions(select, selected) {
    var eligible = result.payroll.paydays.filter(function (payday) {
      return (
        !result.payroll.firstEligibleDate || Calc.compareDates(payday, result.payroll.firstEligibleDate) >= 0
      );
    });

    clear(select);

    if (eligible.length === 0) {
      var empty = document.createElement('option');
      empty.textContent = 'No pays remaining';
      select.appendChild(empty);
      select.disabled = true;
      return;
    }

    select.disabled = false;
    eligible.forEach(function (payday) {
      var option = document.createElement('option');
      option.value = payday;
      option.textContent = Calc.formatDateShort(payday);
      if (payday === selected) option.selected = true;
      select.appendChild(option);
    });
  }

  function renderMeter() {
    if (result.hasBlockingIssue) return;

    var bar = region('meter-bar');
    var meter = result.meter;

    Array.prototype.forEach.call(bar.querySelectorAll('.meter__segment'), function (node) {
      bar.removeChild(node);
    });

    var capline = region('meter-capline');
    meter.segments.forEach(function (segment) {
      var element = document.createElement('div');
      element.className = 'meter__segment meter__segment--' + segment.key;
      element.style.width = segment.percent + '%';
      element.title = segment.label + ': ' + money(segment.cents);
      bar.insertBefore(element, capline);
    });

    var overflowing = meter.overCents > 0;
    show(region('meter-overflow'), overflowing);
    show(capline, overflowing);
    if (overflowing) {
      capline.style.left = meter.capPercent + '%';
      region('meter-overflow').style.left = meter.capPercent + '%';
      region('meter-overflow').style.width = 100 - meter.capPercent + '%';
    }

    setText('meter-total', money(meter.totalCents));
    setText('meter-cap', money(meter.capCents));

    bar.setAttribute(
      'aria-label',
      'Projected concessional contributions ' +
        money(meter.totalCents) +
        ' of a ' +
        money(meter.capCents) +
        ' cap, ' +
        Calc.formatPercent(result.projection.fractionUsed) +
        ' used.'
    );

    renderLegend();
  }

  function renderLegend() {
    var list = region('legend');
    clear(list);

    var items = result.meter.segments.slice();
    if (result.meter.availableCents > 0) {
      items.push({ key: 'available', label: 'Available', cents: result.meter.availableCents });
    }
    if (result.meter.overCents > 0) {
      items.push({ key: 'over', label: 'Over the cap', cents: result.meter.overCents });
    }

    items.forEach(function (item) {
      var node = template('tpl-legend-item');
      node.querySelector('.legend__swatch').classList.add('legend__swatch--' + item.key);
      node.querySelector('.legend__label').textContent = item.label;
      node.querySelector('.legend__value').textContent = money(item.cents);
      list.appendChild(node);
    });
  }

  function renderStatus() {
    var arrangement = region('carry-forward-arrangement');
    var carryHint = region('carry-forward-hint');
    if (result.hasBlockingIssue) {
      show(arrangement, false);
      show(carryHint, false);
      return;
    }

    var container = region('status');
    var projection = result.projection;
    var tone = projection.status === 'over' || projection.status === 'exceeded' || projection.status === 'carry-forward' ? 'warning'
      : projection.status === 'on-target' || projection.status === 'near' ? 'success'
      : 'info';

    container.className =
      'status status--' + tone +
      (projection.status === 'carry-forward' ? ' status--carry-forward' : '');
    container.querySelector('use').setAttribute('href', ICONS[tone]);

    setText('status-label', Calc.statusLabel(projection.status));
    setText('status-text', Calc.describeStatus(result));
    show(
      arrangement,
      projection.carryForwardUsedCents > 0 && projection.selectedPerPayCents > 0
    );
    show(
      carryHint,
      result.usage.carryForwardCents === 0 &&
        (projection.status === 'over' || projection.status === 'exceeded')
    );
  }

  function renderIssues() {
    var buckets = { result: [], cap: [], salary: [], bonus: [], payroll: [] };

    result.issues.forEach(function (item) {
      // Blocking errors already headline the result card; repeating them beside the
      // input would say the same thing twice.
      if (item.level === 'error' && result.hasBlockingIssue) return;
      (buckets[item.placement] || buckets.result).push(item);
    });

    // Frequency mismatches are a property of the email form, not the calculation.
    var emailIssues = [];
    var emailMatchesPayroll =
      email.frequency === result.payroll.frequency ||
      email.frequency === 'per-pay' ||
      email.frequency === emailFrequencyFor(result.payroll.frequency);
    if (!emailMatchesPayroll) {
      emailIssues.push({
        level: 'info',
        title: 'Different frequency',
        message:
          'The projection above is based on ' +
          result.payroll.cadence.adjective +
          ' payroll. Confirm with Payroll how ' +
          (email.frequency === 'one-off' ? 'a one-off contribution' : 'this frequency') +
          ' is applied.'
      });
    }

    Object.keys(buckets).forEach(function (key) {
      fillIssues(region('issues-' + key), buckets[key]);
    });
    fillIssues(region('issues-email'), emailIssues);
  }

  function fillIssues(container, items) {
    if (!container) return;
    clear(container);

    items.forEach(function (item) {
      var node = template('tpl-infobox');
      node.classList.add('infobox--' + item.level);
      node.querySelector('use').setAttribute('href', ICONS[item.level] || ICONS.info);
      node.querySelector('.infobox__title').textContent = item.title;
      node.querySelector('.infobox__message').textContent = item.message;
      container.appendChild(node);
    });
  }

  function renderBreakdown() {
    var list = region('breakdown');
    clear(list);

    setText('breakdown-year', result.financialYear.label);

    var sgSuffix = hasChangedSgRate() ? ' · ' + formatSgRate(state.employerSuper.sgRate) + ' SG' : '';
    var rows = [];

    if (result.usingActuals) {
      rows.push(
        {
          label: 'Employer contributions received',
          cents: result.actuals.employerReceivedCents,
          omitWhenZero: true
        },
        {
          label: 'Projected employer super remaining' + sgSuffix,
          cents: result.employer.projectedRemainingCents,
          omitWhenZero: true
        },
        {
          label: 'Salary sacrifice received',
          cents: result.actuals.salarySacrificeReceivedCents,
          omitWhenZero: true
        },
        {
          label: 'Current salary sacrifice remaining',
          cents: result.existing.projectedRemainingCents,
          omitWhenZero: true
        },
        {
          label: 'Other concessional contributions received',
          cents: result.actuals.otherReceivedCents,
          omitWhenZero: true
        }
      );
    } else {
      rows.push(
        { label: 'Employer super (salary)' + sgSuffix, cents: result.employer.salarySgCents },
        { label: 'Employer super (bonus)' + sgSuffix, cents: result.employer.bonusSgCents, omitWhenZero: true },
        { label: 'Salary sacrifice so far', cents: result.existing.cents },
        {
          label: 'Other employer contributions',
          cents: result.other.employerConcessionalCents,
          omitWhenZero: true
        },
        {
          label: 'Personal deductible contributions',
          cents: result.other.personalDeductibleCents,
          omitWhenZero: true
        },
        {
          label: 'Other concessional contributions',
          cents: result.other.otherConcessionalCents,
          omitWhenZero: true
        }
      );
    }

    rows.push(
      { label: 'Future salary sacrifice', cents: result.projection.futureSacrificeCents },
      {
        label: 'Projected concessional contributions',
        cents: result.projection.projectedTotalCents,
        kind: 'subtotal'
      }
    );

    if (result.usage.carryForwardCents > 0) {
      rows.push({ label: result.financialYear.shortLabel + ' general cap', cents: result.usage.generalCapCents });
      rows.push({ label: 'Confirmed carry-forward cap', cents: result.usage.carryForwardCents });
      if (result.projection.carryForwardUsedCents > 0) {
        rows.push({ label: 'Carry-forward used', cents: result.projection.carryForwardUsedCents });
      }
      rows.push({ label: 'Your effective cap', cents: result.usage.effectiveCapCents, kind: 'subtotal' });
    } else {
      rows.push({ label: result.financialYear.shortLabel + ' concessional cap', cents: result.usage.effectiveCapCents });
    }

    rows.push(
      result.projection.overCents > 0
        ? { label: 'Over the cap', cents: result.projection.overCents, kind: 'total', tone: 'over' }
        : {
            label: result.usage.carryForwardCents > 0 ? 'Effective cap remaining' : 'Remaining',
            cents: result.projection.headroomCents,
            kind: 'total'
          }
    );

    fillLedger(list, rows);
    renderPayPacket();
    setText('explanation', Calc.explainResult(result));
  }

  function fillLedger(list, rows) {
    if (!list) return;
    rows.forEach(function (row) {
      if (row.omitWhenZero && row.cents === 0) return;
      var node = template('tpl-ledger-row');
      if (row.kind) node.classList.add('ledger__row--' + row.kind);
      if (row.tone) node.classList.add('ledger__row--' + row.tone);
      node.querySelector('.ledger__label').textContent = row.label;
      node.querySelector('.ledger__value').textContent = money(row.cents, 2);
      list.appendChild(node);
    });
  }

  function renderPayPacket() {
    var packet = region('paypacket');
    var rows = region('paypacket-rows');
    var typical = result.typicalPay;
    var tax = result.taxSaving;
    var copy = Calc.describeTakeHomeImpact(result);
    var showPacket =
      !result.hasBlockingIssue &&
      typical &&
      typical.salaryRateCents > 0 &&
      typical.paydayCount > 0 &&
      tax &&
      tax.available;

    show(packet, showPacket);
    if (!rows) return;
    clear(rows);
    if (!showPacket) return;

    var cadence = result.payroll.cadence;
    setText(
      'paypacket-lead',
      'Estimated ' +
        cadence.adjective +
        ' figures at your ' +
        money(typical.salaryRateCents) +
        ' salary, across ' +
        typical.paydayCount +
        ' pays this year. Bonus is not included here.'
    );

    fillLedger(rows, [
      {
        label: 'Salary sacrifice ' + cadence.per,
        cents: typical.selectedPerPayCents,
        kind: 'compare'
      },
      {
        label: 'After-tax take-home impact',
        cents: typical.sacrificeFromTakeHomeCents,
        kind: 'impact'
      },
      { label: 'Before tax', cents: typical.grossPerPayCents },
      { label: 'After tax', cents: typical.afterTaxPerPayCents },
      {
        label: 'Take-home after sacrifice',
        cents: typical.afterSacrificePerPayCents,
        kind: 'result'
      }
    ]);

    if (tax.sacrificeCents > 0 && tax.netSavingCents > 0) {
      fillLedger(rows, [
        {
          label: 'Estimated tax saving this year',
          cents: tax.netSavingCents,
          kind: 'saving'
        }
      ]);
    }

    setText(
      'paypacket-note',
      (copy && copy.note ? copy.note + ' ' : '') +
        'Medicare levy, HELP, offsets and other income are not included. This is an estimate, not tax advice.'
    );
  }

  function renderSchedule() {
    var list = region('schedule');
    clear(list);

    var payroll = result.payroll;
    var bonusDate = result.bonus.withinYear ? result.bonus.paymentDate : null;
    var bonusOnPayday = bonusDate && payroll.paydays.indexOf(bonusDate) !== -1;

    setText(
      'schedule-hint',
      payroll.paydayCount +
        ' pays in ' +
        result.financialYear.shortLabel +
        ' · ' +
        payroll.remainingDeductions +
        ' remaining'
    );

    var entries = payroll.paydays.map(function (payday, index) {
      return { date: payday, index: index + 1, kind: 'payday' };
    });

    // A bonus that does not land on a payday still deserves a place in the ledger.
    if (bonusDate && !bonusOnPayday) {
      entries.push({ date: bonusDate, kind: 'event' });
      entries.sort(function (a, b) {
        return Calc.compareDates(a.date, b.date);
      });
    }

    entries.forEach(function (entry) {
      var node = template('tpl-schedule-row');
      var tags = node.querySelector('.schedule__tags');
      var isPast = Calc.compareDates(entry.date, result.asAtDate) < 0;
      var isToday = Calc.compareDates(entry.date, result.asAtDate) === 0;

      node.classList.toggle('schedule__row--past', isPast);
      node.classList.toggle('schedule__row--event', entry.kind === 'event');

      node.querySelector('.schedule__index').textContent = entry.index ? String(entry.index) : '';
      node.querySelector('.schedule__weekday').textContent = Calc.formatWeekday(entry.date);
      node.querySelector('.schedule__date').textContent = Calc.formatDateTabular(entry.date);

      var startsSacrifice = entry.kind === 'payday' && entry.date === payroll.effectiveDate;

      if (isToday) addTag(tags, 'Today', 'today');
      // "Next pay" is redundant when the new election already starts on that pay.
      if (entry.date === payroll.nextPayday && !isToday && !startsSacrifice) addTag(tags, 'Next pay', 'next');
      if (startsSacrifice) addTag(tags, 'New sacrifice', 'sacrifice');
      if (entry.date === bonusDate) addTag(tags, 'Bonus', 'bonus');

      list.appendChild(node);
    });
  }

  function addTag(container, text, variant) {
    var tag = template('tpl-schedule-tag');
    tag.classList.add('tag--' + variant);
    tag.textContent = text;
    container.appendChild(tag);
  }

  function renderEmailControls() {
    writeInput(document.getElementById('in-email-amount'), emailAmountCents());
    document.getElementById('in-email-frequency').value = email.frequency;
    document.getElementById('in-email-name').value = email.name;

    var subject = document.getElementById('in-email-subject');
    if (document.activeElement !== subject) subject.value = email.subject;

    var body = document.getElementById('in-email-body');
    if (document.activeElement !== body) body.value = email.body;

    var overridden = email.amountCents !== null;
    show(field('custom-amount-badge'), overridden);
    show(region('email-amount-reset'), overridden);
  }

  function renderProvenance() {
    var statusWords = {
      verified: 'Verified against ATO published figures',
      legislated: 'Legislated',
      'current-law-continuing': 'Continuing under current law',
      'not-yet-published': 'Some amounts not yet published'
    };

    setText('prov-year', result.financialYear.label);
    setText('prov-status', statusWords[result.financialYear.status] || 'Unknown');
    setText('prov-verified', Calc.formatDateShort(result.financialYear.verified || DATA.lastVerified));
    setText('prov-source', DATA.source);
    setText('prov-rules', DATA.rulesVersion);
    setText('prov-app', 'SuperCap ' + APP_VERSION);
    setText('prov-note', result.financialYear.note);

    setText('footer-version', 'SuperCap ' + APP_VERSION + ' · rules ' + DATA.rulesVersion);
    setText('footer-generated', 'Generated ' + Calc.formatDateLong(Calc.todayISO()));
  }

  boot();
})();
