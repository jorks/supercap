/**
 * GENERATED FILE. Do not edit.
 *
 * Produced from dev/data.json by dev/sync-data.mjs.
 * Edit data.json, re-run the script, and commit both files.
 *
 * Rules version: 2026.09.01
 * Last verified: 2026-09-01
 */
window.SUPERCAP_DATA = {
  "schemaVersion": 1,
  "rulesVersion": "2026.09.01",
  "country": "AU",
  "currency": "AUD",
  "lastVerified": "2026-09-01",
  "source": "Australian Taxation Office",
  "sourceUrls": [
    "https://www.ato.gov.au/tax-rates-and-codes/key-superannuation-rates-and-thresholds",
    "https://www.ato.gov.au/businesses-and-organisations/super-for-employers/payday-super/paying-super-on-payday/what-payments-are-qualifying-earnings/maximum-contributions-base",
    "https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents"
  ],
  "notes": [
    "SuperCap ships a static rules dataset. Nothing updates automatically.",
    "Values that are indexed each year (such as the concessional cap) are null until the ATO publishes them. Never substitute the previous year's amount.",
    "From 1 July 2026 the maximum contribution base is an annual figure rather than a quarterly one, as a result of Payday Super."
  ],
  "payrollDefaults": {
    "frequency": "fortnightly",
    "anchorDate": "2026-09-11",
    "daysBetweenPays": 14,
    "salaryIncreaseMonth": 9,
    "salaryIncreaseDay": 1
  },
  "exampleFigures": {
    "description": "Neutral, obviously-illustrative figures shown on first load so the calculator is not empty. Not anyone's real numbers.",
    "salaryBefore": 150000,
    "salaryAfter": 155000,
    "bonus": 10000,
    "existingSacrificePerPay": 0,
    "safetyBuffer": 50
  },
  "financialYears": {
    "2026-27": {
      "label": "FY2026-27",
      "shortLabel": "FY27",
      "start": "2026-07-01",
      "end": "2027-06-30",
      "super": {
        "sgRate": 0.12,
        "concessionalCap": 32500,
        "maximumSgEarningsBase": 270830,
        "division293Threshold": 250000
      },
      "tax": {
        "residentRates": [
          {
            "from": 0,
            "to": 18200,
            "rate": 0
          },
          {
            "from": 18200,
            "to": 45000,
            "rate": 0.15
          },
          {
            "from": 45000,
            "to": 135000,
            "rate": 0.3
          },
          {
            "from": 135000,
            "to": 190000,
            "rate": 0.37
          },
          {
            "from": 190000,
            "to": null,
            "rate": 0.45
          }
        ]
      },
      "defaults": {
        "salaryIncreaseDate": "2026-09-01",
        "bonusPaymentDate": "2026-09-11"
      },
      "metadata": {
        "status": "verified",
        "source": "Australian Taxation Office",
        "verified": "2026-09-01",
        "note": "Concessional cap indexed to $32,500 from 1 July 2026. Maximum contribution base is $270,830 for the full year (cap x 100 / 12), replacing the previous quarterly basis."
      }
    },
    "2027-28": {
      "label": "FY2027-28",
      "shortLabel": "FY28",
      "start": "2027-07-01",
      "end": "2028-06-30",
      "super": {
        "sgRate": 0.12,
        "concessionalCap": null,
        "maximumSgEarningsBase": null,
        "division293Threshold": 250000
      },
      "tax": {
        "residentRates": [
          {
            "from": 0,
            "to": 18200,
            "rate": 0
          },
          {
            "from": 18200,
            "to": 45000,
            "rate": 0.14
          },
          {
            "from": 45000,
            "to": 135000,
            "rate": 0.3
          },
          {
            "from": 135000,
            "to": 190000,
            "rate": 0.37
          },
          {
            "from": 190000,
            "to": null,
            "rate": 0.45
          }
        ]
      },
      "defaults": {
        "salaryIncreaseDate": "2027-09-01",
        "bonusPaymentDate": null
      },
      "metadata": {
        "status": "not-yet-published",
        "source": "Australian Taxation Office",
        "verified": "2026-09-01",
        "note": "The concessional cap is indexed to AWOTE and had not been published for this year. The maximum contribution base is derived from the cap, so it is also unknown. The SG rate is 12% under current law and the resident tax rates are legislated. The Division 293 threshold is not indexed."
      }
    },
    "2028-29": {
      "label": "FY2028-29",
      "shortLabel": "FY29",
      "start": "2028-07-01",
      "end": "2029-06-30",
      "super": {
        "sgRate": 0.12,
        "concessionalCap": null,
        "maximumSgEarningsBase": null,
        "division293Threshold": 250000
      },
      "tax": {
        "residentRates": [
          {
            "from": 0,
            "to": 18200,
            "rate": 0
          },
          {
            "from": 18200,
            "to": 45000,
            "rate": 0.14
          },
          {
            "from": 45000,
            "to": 135000,
            "rate": 0.3
          },
          {
            "from": 135000,
            "to": 190000,
            "rate": 0.37
          },
          {
            "from": 190000,
            "to": null,
            "rate": 0.45
          }
        ]
      },
      "defaults": {
        "salaryIncreaseDate": "2028-09-01",
        "bonusPaymentDate": null
      },
      "metadata": {
        "status": "not-yet-published",
        "source": "Australian Taxation Office",
        "verified": "2026-09-01",
        "note": "Indexed super amounts are unknown this far ahead. Resident tax rates continue under current law."
      }
    },
    "2029-30": {
      "label": "FY2029-30",
      "shortLabel": "FY30",
      "start": "2029-07-01",
      "end": "2030-06-30",
      "super": {
        "sgRate": 0.12,
        "concessionalCap": null,
        "maximumSgEarningsBase": null,
        "division293Threshold": 250000
      },
      "tax": {
        "residentRates": [
          {
            "from": 0,
            "to": 18200,
            "rate": 0
          },
          {
            "from": 18200,
            "to": 45000,
            "rate": 0.14
          },
          {
            "from": 45000,
            "to": 135000,
            "rate": 0.3
          },
          {
            "from": 135000,
            "to": 190000,
            "rate": 0.37
          },
          {
            "from": 190000,
            "to": null,
            "rate": 0.45
          }
        ]
      },
      "defaults": {
        "salaryIncreaseDate": "2029-09-01",
        "bonusPaymentDate": null
      },
      "metadata": {
        "status": "not-yet-published",
        "source": "Australian Taxation Office",
        "verified": "2026-09-01",
        "note": "Indexed super amounts are unknown this far ahead. Resident tax rates continue under current law."
      }
    }
  }
};
