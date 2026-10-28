const ProfessionalTaxState = require('../../shared/models/ProfessionalTaxState');
const ProfessionalTaxRule = require('../../shared/models/ProfessionalTaxRule');
const ProfessionalTaxAuditLog = require('../../shared/models/ProfessionalTaxAuditLog');
const { Op } = require('sequelize');

class ProfessionalTaxService {
  /**
   * Evaluates custom mathematical formula safely without eval()
   */
  static evaluateFormula(expression, variables = {}) {
    if (!expression || typeof expression !== 'string') return 0;
    try {
      // Whitelist safe variable names and math operators
      let sanitized = expression;
      const keys = Object.keys(variables);
      for (const k of keys) {
        const val = Number(variables[k]) || 0;
        sanitized = sanitized.replace(new RegExp(`\\b${k}\\b`, 'g'), val);
      }
      
      // Allow only numbers, parentheses, and arithmetic operators: + - * / % . ( )
      if (!/^[0-9+\-*/%().\s]+$/.test(sanitized)) {
        console.warn('Invalid characters in formula expression:', expression);
        return 0;
      }
      
      // Controlled math evaluation via Function with no access to globals
      const result = new Function(`'use strict'; return (${sanitized});`)();
      return isNaN(result) ? 0 : Math.max(0, Number(result));
    } catch (err) {
      console.error('Error evaluating PT formula expression:', err.message);
      return 0;
    }
  }

  /**
   * Main calculation engine method
   */
  static async calculateProfessionalTax({
    employee,
    grossSalary = 0,
    basicSalary = 0,
    taxableSalary = 0,
    totalEarnings = 0,
    payrollDate = new Date().toISOString().split('T')[0],
    ytdPt = 0,
    attendanceRatio = 1
  }) {
    // 1. Employee Exemption / Eligibility Check
    if (!employee || employee.ptEligible === false || employee.ptExemption === true) {
      return {
        applicable: false,
        reason: employee?.ptExemption ? (employee.ptExemptionReason || 'Employee is configured as exempt from PT') : 'PT not eligible',
        ptAmount: 0,
        unproratedPt: 0
      };
    }

    // If a manual override is specified on employee profile
    if (employee.ptAmount !== undefined && employee.ptAmount !== null && employee.ptAmount !== '' && !isNaN(Number(employee.ptAmount))) {
      const overrideAmount = Number(employee.ptAmount);
      const prorated = Math.round(overrideAmount * attendanceRatio);
      return {
        applicable: true,
        isOverride: true,
        ptAmount: prorated,
        unproratedPt: overrideAmount,
        reason: 'Manual employee profile override applied'
      };
    }

    // 2. Resolve Active State Configuration
    // The state code is what HR selects on the employee profile; pt_state_id is never set by the UI and can be stale
    const stateIdentifier = employee.ptStateCode || employee.ptStateId;
    let state = null;

    if (stateIdentifier) {
      // Only compare against the UUID primary key when the identifier is a UUID (Postgres rejects 'TN' = uuid)
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(stateIdentifier));
      state = await ProfessionalTaxState.findOne({
        where: {
          [Op.or]: isUuid
            ? [{ id: stateIdentifier }]
            : [{ stateCode: stateIdentifier }, { stateName: stateIdentifier }],
          isEnabled: true
        }
      });
    }

    // Fallback: If no state selected, try finding default state (e.g. MH or first enabled state)
    if (!state) {
      state = await ProfessionalTaxState.findOne({
        where: { isEnabled: true },
        order: [['effectiveFrom', 'DESC']]
      });
    }

    if (!state) {
      return {
        applicable: false,
        reason: 'No active Professional Tax state configuration found',
        ptAmount: 0,
        unproratedPt: 0
      };
    }

    // Check effective date boundaries for state
    if (state.effectiveFrom && state.effectiveFrom > payrollDate) {
      return {
        applicable: false,
        reason: `State PT configuration is scheduled for future (${state.effectiveFrom})`,
        ptAmount: 0,
        unproratedPt: 0
      };
    }
    if (state.effectiveTo && state.effectiveTo < payrollDate) {
      return {
        applicable: false,
        reason: `State PT configuration expired on ${state.effectiveTo}`,
        ptAmount: 0,
        unproratedPt: 0
      };
    }

    // 3. Determine Salary Basis
    let salaryValue = grossSalary;
    if (state.salaryBasis === 'BASIC_SALARY') salaryValue = basicSalary;
    else if (state.salaryBasis === 'TAXABLE_SALARY') salaryValue = taxableSalary;
    else if (state.salaryBasis === 'TOTAL_EARNINGS') salaryValue = totalEarnings;

    salaryValue = Math.max(0, Number(salaryValue) || 0);

    // 4. Fetch Active Rules for State
    const rules = await ProfessionalTaxRule.findAll({
      where: {
        stateId: state.id,
        isActive: true,
        status: { [Op.in]: ['ACTIVE', 'SCHEDULED'] }
      },
      order: [
        ['priority', 'DESC'],
        ['salaryFrom', 'DESC']
      ]
    });

    const empGender = String(employee.gender || 'ALL').toUpperCase();
    const empCategory = String(employee.category || 'EMPLOYEE').toUpperCase();
    const payrollDateObj = new Date(payrollDate);
    const payrollMonth = payrollDateObj.getMonth() + 1; // 1-12
    const payrollYear = payrollDateObj.getFullYear();

    let matchedRule = null;

    for (const rule of rules) {
      // Check effective dates
      if (rule.effectiveFrom && rule.effectiveFrom > payrollDate) continue;
      if (rule.effectiveTo && rule.effectiveTo < payrollDate) continue;

      // Check gender
      const rGender = String(rule.gender || 'ALL').toUpperCase();
      if (rGender !== 'ALL' && rGender !== empGender) continue;

      // Check employee category
      const rCat = String(rule.employeeCategory || 'ALL').toUpperCase();
      if (rCat !== 'ALL' && rCat !== empCategory) continue;

      // Check salary range
      const sFrom = Number(rule.salaryFrom) || 0;
      const sTo = Number(rule.salaryTo) || 999999999;

      if (salaryValue >= sFrom && salaryValue <= sTo) {
        matchedRule = rule;
        break;
      }
    }

    if (!matchedRule) {
      return {
        applicable: true,
        stateId: state.id,
        stateName: state.stateName,
        stateCode: state.stateCode,
        salaryBasis: state.salaryBasis,
        salaryEvaluated: salaryValue,
        ptAmount: 0,
        unproratedPt: 0,
        reason: 'Salary falls outside configured taxable slabs'
      };
    }

    // 5. Calculate Raw Amount
    let rawAmount = 0;

    // Check if exemption rule is matched
    if (matchedRule.isExemption) {
      rawAmount = 0;
    } else if (matchedRule.calculationType === 'PERCENTAGE') {
      rawAmount = (salaryValue * (Number(matchedRule.ptAmount) || 0)) / 100;
    } else if (matchedRule.calculationType === 'FORMULA') {
      rawAmount = this.evaluateFormula(matchedRule.formulaExpression, {
        gross_salary: grossSalary,
        basic_salary: basicSalary,
        taxable_salary: taxableSalary,
        total_earnings: totalEarnings,
        salary: salaryValue,
        month: payrollMonth,
        year: payrollYear,
        ytd_pt: ytdPt
      });
    } else {
      // Default: FIXED amount
      rawAmount = Number(matchedRule.ptAmount) || 0;

      // Check month-specific adjustments (e.g. Feb/March special amounts)
      if (matchedRule.monthSpecificRules) {
        try {
          const monthRules = typeof matchedRule.monthSpecificRules === 'string'
            ? JSON.parse(matchedRule.monthSpecificRules)
            : matchedRule.monthSpecificRules;
          if (monthRules && monthRules[String(payrollMonth)] !== undefined) {
            rawAmount = Number(monthRules[String(payrollMonth)]) || rawAmount;
          }
        } catch (e) {
          console.warn('Error parsing monthSpecificRules:', e.message);
        }
      }
    }

    // 6. Statutory Professional Tax is fixed monthly deduction based on monthly gross (no attendance proration)
    let finalAmount = rawAmount;

    // 7. Enforce Annual and Monthly Max Limits
    if (state.maxMonthlyPt && finalAmount > state.maxMonthlyPt) {
      finalAmount = state.maxMonthlyPt;
    }

    if (state.maxAnnualPt && ytdPt !== undefined && ytdPt !== null) {
      const remainingAnnualCap = Math.max(0, state.maxAnnualPt - Number(ytdPt));
      finalAmount = Math.min(finalAmount, remainingAnnualCap);
    }

    return {
      applicable: true,
      stateId: state.id,
      stateName: state.stateName,
      stateCode: state.stateCode,
      ruleId: matchedRule.id,
      ruleName: matchedRule.ruleName,
      salaryBasis: state.salaryBasis,
      salaryEvaluated: salaryValue,
      salaryRange: { from: matchedRule.salaryFrom, to: matchedRule.salaryTo },
      ptAmount: finalAmount,
      unproratedPt: rawAmount,
      calculationType: matchedRule.calculationType,
      periodType: matchedRule.periodType,
      effectiveFrom: matchedRule.effectiveFrom,
      effectiveTo: matchedRule.effectiveTo
    };
  }

  /**
   * Validates slab boundary overlaps and gaps
   */
  static validateSlabs(slabs = []) {
    const errors = [];
    const warnings = [];

    if (!Array.isArray(slabs) || slabs.length === 0) {
      return { valid: false, errors: ['At least one tax slab is required.'], warnings: [] };
    }

    // Group by Gender and Employee Category
    const groups = {};
    slabs.forEach((slab, index) => {
      const from = Number(slab.salaryFrom);
      const to = Number(slab.salaryTo);

      if (isNaN(from) || isNaN(to)) {
        errors.push(`Row ${index + 1}: Salary From and Salary To must be valid numbers.`);
        return;
      }
      if (from < 0) {
        errors.push(`Row ${index + 1}: Salary From cannot be negative.`);
      }
      if (from > to) {
        errors.push(`Row ${index + 1}: Salary From (₹${from}) cannot be greater than Salary To (₹${to}).`);
      }

      const key = `${slab.gender || 'ALL'}_${slab.employeeCategory || 'ALL'}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push({ ...slab, from, to, index: index + 1 });
    });

    // Check for overlaps and gaps within each group
    Object.keys(groups).forEach(key => {
      const groupList = groups[key].sort((a, b) => a.from - b.from);

      for (let i = 0; i < groupList.length; i++) {
        const current = groupList[i];
        const next = groupList[i + 1];

        if (next) {
          // Overlap check
          if (current.to >= next.from) {
            errors.push(`Overlapping slabs detected between Row ${current.index} (₹${current.from} - ₹${current.to}) and Row ${next.index} (₹${next.from} - ₹${next.to}).`);
          }
          // Gap check
          else if (next.from > current.to + 1) {
            warnings.push(`Gap detected in salary range: ₹${current.to + 1} to ₹${next.from - 1} is not covered.`);
          }
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Seeds baseline standard state tax slabs for production
   */
  static async seedBaselineStates(force = false) {
    if (!force) {
      const existingCount = await ProfessionalTaxState.count();
      if (existingCount > 0) {
        // Upsert states that might need baseline refresh
      }
    }

    console.log('Seeding standard state Professional Tax configurations...');

    const baselineData = [
      {
        stateCode: 'MH',
        stateName: 'Maharashtra',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2500,
        effectiveFrom: '2026-04-01',
        description: 'Standard Maharashtra PT with Feb ₹300 adjustment',
        slabs: [
          { ruleName: 'Slab 0 - 7.5K (Male)', salaryFrom: 0, salaryTo: 7500, ptAmount: 0, gender: 'MALE' },
          { ruleName: 'Slab 7.5K - 10K (Male)', salaryFrom: 7501, salaryTo: 10000, ptAmount: 175, gender: 'MALE' },
          { ruleName: 'Slab 10K+ (Male)', salaryFrom: 10001, salaryTo: 999999999, ptAmount: 200, monthSpecificRules: '{"2":300}', gender: 'MALE' },
          { ruleName: 'Slab 0 - 25K (Female Exemption)', salaryFrom: 0, salaryTo: 25000, ptAmount: 0, gender: 'FEMALE' },
          { ruleName: 'Slab 25K+ (Female)', salaryFrom: 25001, salaryTo: 999999999, ptAmount: 200, monthSpecificRules: '{"2":300}', gender: 'FEMALE' },
        ]
      },
      {
        stateCode: 'KA',
        stateName: 'Karnataka',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2400,
        effectiveFrom: '2026-04-01',
        description: 'Karnataka State PT Slabs',
        slabs: [
          { ruleName: 'Up to 15,000', salaryFrom: 0, salaryTo: 14999, ptAmount: 0 },
          { ruleName: '15,000 and above', salaryFrom: 15000, salaryTo: 999999999, ptAmount: 200 }
        ]
      },
      {
        stateCode: 'GJ',
        stateName: 'Gujarat',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2400,
        effectiveFrom: '2026-04-01',
        description: 'Gujarat State PT Slabs',
        slabs: [
          { ruleName: 'Below 6,000', salaryFrom: 0, salaryTo: 5999, ptAmount: 0 },
          { ruleName: '6,000 to 8,999', salaryFrom: 6000, salaryTo: 8999, ptAmount: 80 },
          { ruleName: '9,000 to 11,999', salaryFrom: 9000, salaryTo: 11999, ptAmount: 150 },
          { ruleName: '12,000 and above', salaryFrom: 12000, salaryTo: 999999999, ptAmount: 200 }
        ]
      },
      {
        stateCode: 'WB',
        stateName: 'West Bengal',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2500,
        effectiveFrom: '2026-04-01',
        description: 'West Bengal PT Slabs',
        slabs: [
          { ruleName: 'Up to 10,000', salaryFrom: 0, salaryTo: 10000, ptAmount: 0 },
          { ruleName: '10,001 to 15,000', salaryFrom: 10001, salaryTo: 15000, ptAmount: 110 },
          { ruleName: '15,001 to 25,000', salaryFrom: 15001, salaryTo: 25000, ptAmount: 130 },
          { ruleName: '25,001 to 40,000', salaryFrom: 25001, salaryTo: 40000, ptAmount: 150 },
          { ruleName: '40,001 and above', salaryFrom: 40001, salaryTo: 999999999, ptAmount: 200 }
        ]
      },
      {
        stateCode: 'TS',
        stateName: 'Telangana',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2500,
        effectiveFrom: '2026-04-01',
        description: 'Telangana PT Slabs',
        slabs: [
          { ruleName: 'Up to 15,000', salaryFrom: 0, salaryTo: 15000, ptAmount: 0 },
          { ruleName: '15,001 to 20,000', salaryFrom: 15001, salaryTo: 20000, ptAmount: 150 },
          { ruleName: '20,001 and above', salaryFrom: 20001, salaryTo: 999999999, ptAmount: 200 }
        ]
      },
      {
        stateCode: 'AP',
        stateName: 'Andhra Pradesh',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2500,
        effectiveFrom: '2026-04-01',
        description: 'Andhra Pradesh PT Slabs',
        slabs: [
          { ruleName: 'Up to 15,000', salaryFrom: 0, salaryTo: 15000, ptAmount: 0 },
          { ruleName: '15,001 to 20,000', salaryFrom: 15001, salaryTo: 20000, ptAmount: 150 },
          { ruleName: '20,001 and above', salaryFrom: 20001, salaryTo: 999999999, ptAmount: 200 }
        ]
      },
      {
        stateCode: 'TN',
        stateName: 'Tamil Nadu',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2500,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Tamil Nadu PT Slabs (Monthly Statutory PT)',
        slabs: [
          { ruleName: '0 to 3,500', salaryFrom: 0, salaryTo: 3500, ptAmount: 0 },
          { ruleName: '3,501 to 5,000', salaryFrom: 3501, salaryTo: 5000, ptAmount: 20 },
          { ruleName: '5,001 to 7,500', salaryFrom: 5001, salaryTo: 7500, ptAmount: 50 },
          { ruleName: '7,501 to 10,000', salaryFrom: 7501, salaryTo: 10000, ptAmount: 100 },
          { ruleName: '10,001 to 12,500', salaryFrom: 10001, salaryTo: 12500, ptAmount: 150 },
          { ruleName: '12,501 and above', salaryFrom: 12501, salaryTo: 999999999, ptAmount: 208 }
        ]
      },
      {
        stateCode: 'MP',
        stateName: 'Madhya Pradesh',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2500,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Madhya Pradesh PT Slabs',
        slabs: [
          { ruleName: 'Up to 18,750', salaryFrom: 0, salaryTo: 18750, ptAmount: 0 },
          { ruleName: '18,751 to 25,000', salaryFrom: 18751, salaryTo: 25000, ptAmount: 125 },
          { ruleName: '25,001 to 33,333', salaryFrom: 25001, salaryTo: 33333, ptAmount: 167 },
          { ruleName: '33,334 and above', salaryFrom: 33334, salaryTo: 999999999, ptAmount: 208 }
        ]
      },
      {
        stateCode: 'UP',
        stateName: 'Uttar Pradesh (Exempt)',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 0,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Uttar Pradesh does not levy Professional Tax (0 PT)',
        slabs: [
          { ruleName: 'All Salaries (Exempt)', salaryFrom: 0, salaryTo: 999999999, ptAmount: 0 }
        ]
      },
      {
        stateCode: 'HR',
        stateName: 'Haryana (Exempt)',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 0,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Haryana does not levy Professional Tax (0 PT)',
        slabs: [
          { ruleName: 'All Salaries (Exempt)', salaryFrom: 0, salaryTo: 999999999, ptAmount: 0 }
        ]
      },
      {
        stateCode: 'RJ',
        stateName: 'Rajasthan (Exempt)',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 0,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Rajasthan does not levy Professional Tax (0 PT)',
        slabs: [
          { ruleName: 'All Salaries (Exempt)', salaryFrom: 0, salaryTo: 999999999, ptAmount: 0 }
        ]
      },
      {
        stateCode: 'PB',
        stateName: 'Punjab (Exempt / Optional)',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2400,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Punjab State PT Slabs',
        slabs: [
          { ruleName: 'Income tax non-payees', salaryFrom: 0, salaryTo: 25000, ptAmount: 0 },
          { ruleName: 'Income tax payees', salaryFrom: 25001, salaryTo: 999999999, ptAmount: 200 }
        ]
      },
      {
        stateCode: 'HP',
        stateName: 'Himachal Pradesh (Exempt)',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 0,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Himachal Pradesh does not levy Professional Tax (0 PT)',
        slabs: [
          { ruleName: 'All Salaries (Exempt)', salaryFrom: 0, salaryTo: 999999999, ptAmount: 0 }
        ]
      },
      {
        stateCode: 'UK',
        stateName: 'Uttarakhand (Exempt)',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 0,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Uttarakhand does not levy Professional Tax (0 PT)',
        slabs: [
          { ruleName: 'All Salaries (Exempt)', salaryFrom: 0, salaryTo: 999999999, ptAmount: 0 }
        ]
      },
      {
        stateCode: 'KL',
        stateName: 'Kerala',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2500,
        frequency: 'HALF_YEARLY',
        effectiveFrom: '2026-04-01',
        description: 'Kerala PT Slabs (Half-yearly)',
        slabs: [
          { ruleName: 'Up to 2,000/mo', salaryFrom: 0, salaryTo: 2000, ptAmount: 0 },
          { ruleName: '2,001 to 3,000/mo', salaryFrom: 2001, salaryTo: 3000, ptAmount: 20 },
          { ruleName: '3,001 to 5,000/mo', salaryFrom: 3001, salaryTo: 5000, ptAmount: 37 },
          { ruleName: '5,001 to 7,500/mo', salaryFrom: 5001, salaryTo: 7500, ptAmount: 75 },
          { ruleName: '7,501 to 10,000/mo', salaryFrom: 7501, salaryTo: 10000, ptAmount: 125 },
          { ruleName: '10,001 to 12,500/mo', salaryFrom: 10001, salaryTo: 12500, ptAmount: 167 },
          { ruleName: '12,501 and above/mo', salaryFrom: 12501, salaryTo: 999999999, ptAmount: 208 }
        ]
      },
      {
        stateCode: 'OD',
        stateName: 'Odisha',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2500,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Odisha State PT Slabs',
        slabs: [
          { ruleName: 'Up to 13,333', salaryFrom: 0, salaryTo: 13333, ptAmount: 0 },
          { ruleName: '13,334 to 25,000', salaryFrom: 13334, salaryTo: 25000, ptAmount: 125 },
          { ruleName: '25,001 and above', salaryFrom: 25001, salaryTo: 999999999, ptAmount: 200, monthSpecificRules: '{"2":300}' }
        ]
      },
      {
        stateCode: 'BR',
        stateName: 'Bihar',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2500,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Bihar State PT Slabs',
        slabs: [
          { ruleName: 'Up to 25,000', salaryFrom: 0, salaryTo: 25000, ptAmount: 0 },
          { ruleName: '25,001 to 41,666', salaryFrom: 25001, salaryTo: 41666, ptAmount: 83 },
          { ruleName: '41,667 to 66,666', salaryFrom: 41667, salaryTo: 66666, ptAmount: 125 },
          { ruleName: '66,667 to 83,333', salaryFrom: 66667, salaryTo: 83333, ptAmount: 166 },
          { ruleName: '83,334 and above', salaryFrom: 83334, salaryTo: 999999999, ptAmount: 208 }
        ]
      },
      {
        stateCode: 'JH',
        stateName: 'Jharkhand',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2500,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Jharkhand State PT Slabs',
        slabs: [
          { ruleName: 'Up to 25,000', salaryFrom: 0, salaryTo: 25000, ptAmount: 0 },
          { ruleName: '25,001 to 41,666', salaryFrom: 25001, salaryTo: 41666, ptAmount: 83 },
          { ruleName: '41,667 to 66,666', salaryFrom: 41667, salaryTo: 66666, ptAmount: 125 },
          { ruleName: '66,667 to 83,333', salaryFrom: 66667, salaryTo: 83333, ptAmount: 166 },
          { ruleName: '83,334 and above', salaryFrom: 83334, salaryTo: 999999999, ptAmount: 208 }
        ]
      },
      {
        stateCode: 'AS',
        stateName: 'Assam',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2500,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Assam State PT Slabs',
        slabs: [
          { ruleName: 'Up to 10,000', salaryFrom: 0, salaryTo: 10000, ptAmount: 0 },
          { ruleName: '10,001 to 15,000', salaryFrom: 10001, salaryTo: 15000, ptAmount: 150 },
          { ruleName: '15,001 to 25,000', salaryFrom: 15001, salaryTo: 25000, ptAmount: 180 },
          { ruleName: '25,001 and above', salaryFrom: 25001, salaryTo: 999999999, ptAmount: 208 }
        ]
      },
      {
        stateCode: 'CG',
        stateName: 'Chhattisgarh',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 2500,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Chhattisgarh State PT Slabs',
        slabs: [
          { ruleName: 'Up to 16,666', salaryFrom: 0, salaryTo: 16666, ptAmount: 0 },
          { ruleName: '16,667 to 25,000', salaryFrom: 16667, salaryTo: 25000, ptAmount: 125 },
          { ruleName: '25,001 to 33,333', salaryFrom: 25001, salaryTo: 33333, ptAmount: 167 },
          { ruleName: '33,334 and above', salaryFrom: 33334, salaryTo: 999999999, ptAmount: 208 }
        ]
      },
      {
        stateCode: 'GA',
        stateName: 'Goa (Exempt)',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 0,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Goa does not levy employee monthly payroll PT (0 PT)',
        slabs: [
          { ruleName: 'All Salaries (Exempt)', salaryFrom: 0, salaryTo: 999999999, ptAmount: 0 }
        ]
      },
      {
        stateCode: 'CH',
        stateName: 'Chandigarh (Exempt)',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 0,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Chandigarh does not levy Professional Tax (0 PT)',
        slabs: [
          { ruleName: 'All Salaries (Exempt)', salaryFrom: 0, salaryTo: 999999999, ptAmount: 0 }
        ]
      },
      {
        stateCode: 'JK',
        stateName: 'Jammu & Kashmir (Exempt)',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 0,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Jammu & Kashmir does not levy Professional Tax (0 PT)',
        slabs: [
          { ruleName: 'All Salaries (Exempt)', salaryFrom: 0, salaryTo: 999999999, ptAmount: 0 }
        ]
      },
      {
        stateCode: 'DL',
        stateName: 'Delhi (Exempt)',
        countryCode: 'IN',
        taxName: 'Professional Tax',
        salaryBasis: 'GROSS_SALARY',
        maxAnnualPt: 0,
        frequency: 'MONTHLY',
        effectiveFrom: '2026-04-01',
        description: 'Delhi does not levy Professional Tax (0 PT)',
        slabs: [
          { ruleName: 'All Salaries (Exempt)', salaryFrom: 0, salaryTo: 999999999, ptAmount: 0 }
        ]
      }
    ];

    for (const item of baselineData) {
      const { slabs, ...stateFields } = item;
      let stateObj = await ProfessionalTaxState.findOne({ where: { stateCode: item.stateCode } });
      if (!stateObj) {
        stateObj = await ProfessionalTaxState.create(stateFields);
      } else {
        await stateObj.update(stateFields);
        await ProfessionalTaxRule.destroy({ where: { stateId: stateObj.id } });
      }
      
      for (let i = 0; i < slabs.length; i++) {
        const s = slabs[i];
        await ProfessionalTaxRule.create({
          stateId: stateObj.id,
          ruleName: s.ruleName,
          salaryFrom: s.salaryFrom,
          salaryTo: s.salaryTo,
          ptAmount: s.ptAmount,
          calculationType: s.calculationType || 'FIXED',
          periodType: s.periodType || 'MONTHLY',
          monthSpecificRules: s.monthSpecificRules || null,
          gender: s.gender || 'ALL',
          employeeCategory: s.employeeCategory || 'ALL',
          effectiveFrom: stateFields.effectiveFrom,
          isActive: true,
          status: 'ACTIVE',
          priority: i
        });
      }
    }

    console.log('Successfully seeded standard state Professional Tax configurations!');
  }
}

module.exports = ProfessionalTaxService;
