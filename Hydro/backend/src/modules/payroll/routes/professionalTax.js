const express = require('express');
const router = express.Router();
const ProfessionalTaxState = require('../../../shared/models/ProfessionalTaxState');
const ProfessionalTaxRule = require('../../../shared/models/ProfessionalTaxRule');
const ProfessionalTaxAuditLog = require('../../../shared/models/ProfessionalTaxAuditLog');
const ProfessionalTaxService = require('../../../core/utils/ProfessionalTaxService');
const { Op } = require('sequelize');
const sequelize = require('../../../config/database');

// GET /api/payroll/professional-tax/states - List all states with active rule counts
router.get('/states', async (req, res) => {
  try {
    const states = await ProfessionalTaxState.findAll({
      order: [['stateName', 'ASC']]
    });

    const statesWithRules = await Promise.all(states.map(async (st) => {
      const stateJson = st.toJSON();
      const rules = await ProfessionalTaxRule.findAll({
        where: { stateId: st.id, isActive: true },
        order: [['priority', 'ASC'], ['salaryFrom', 'ASC']]
      });
      stateJson.activeRulesCount = rules.length;
      stateJson.rules = rules;
      return stateJson;
    }));

    return res.status(200).json(statesWithRules);
  } catch (error) {
    console.error('Error fetching PT states:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/payroll/professional-tax/states - Create a new state
router.post('/states', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const {
      stateCode,
      stateName,
      countryCode,
      taxName,
      salaryBasis,
      maxAnnualPt,
      maxMonthlyPt,
      frequency,
      effectiveFrom,
      effectiveTo,
      description,
      slabs
    } = req.body;

    if (!stateCode || !stateName) {
      await t.rollback();
      return res.status(400).json({ error: 'State Code and State Name are required.' });
    }

    const existing = await ProfessionalTaxState.findOne({
      where: { stateCode: stateCode.trim().toUpperCase() }
    });

    if (existing) {
      await t.rollback();
      return res.status(400).json({ error: `State with code '${stateCode}' already exists.` });
    }

    const state = await ProfessionalTaxState.create({
      stateCode: stateCode.trim().toUpperCase(),
      stateName: stateName.trim(),
      countryCode: countryCode || 'IN',
      taxName: taxName || 'Professional Tax',
      salaryBasis: salaryBasis || 'GROSS_SALARY',
      maxAnnualPt: maxAnnualPt !== undefined && maxAnnualPt !== '' ? Number(maxAnnualPt) : 2500,
      maxMonthlyPt: maxMonthlyPt !== undefined && maxMonthlyPt !== '' ? Number(maxMonthlyPt) : null,
      frequency: frequency || 'MONTHLY',
      effectiveFrom: effectiveFrom || '2026-04-01',
      effectiveTo: effectiveTo || null,
      description: description || null,
      createdBy: req.user?.id || 'ADMIN',
      isEnabled: true
    }, { transaction: t });

    // If slabs were provided with creation
    if (Array.isArray(slabs) && slabs.length > 0) {
      const validation = ProfessionalTaxService.validateSlabs(slabs);
      if (!validation.valid) {
        await t.rollback();
        return res.status(400).json({ error: validation.errors.join(' ') });
      }

      for (let i = 0; i < slabs.length; i++) {
        const s = slabs[i];
        await ProfessionalTaxRule.create({
          stateId: state.id,
          ruleName: s.ruleName || `Slab ${s.salaryFrom} - ${s.salaryTo}`,
          salaryFrom: Number(s.salaryFrom) || 0,
          salaryTo: Number(s.salaryTo) || 999999999,
          ptAmount: Number(s.ptAmount) || 0,
          calculationType: s.calculationType || 'FIXED',
          formulaExpression: s.formulaExpression || null,
          periodType: s.periodType || state.frequency || 'MONTHLY',
          monthSpecificRules: s.monthSpecificRules ? (typeof s.monthSpecificRules === 'string' ? s.monthSpecificRules : JSON.stringify(s.monthSpecificRules)) : null,
          gender: s.gender || 'ALL',
          employeeCategory: s.employeeCategory || 'ALL',
          isExemption: s.isExemption || false,
          exemptionType: s.exemptionType || 'NONE',
          exemptionValue: s.exemptionValue || null,
          effectiveFrom: s.effectiveFrom || state.effectiveFrom || '2026-04-01',
          effectiveTo: s.effectiveTo || state.effectiveTo || null,
          isActive: true,
          status: s.status || 'ACTIVE',
          priority: i,
          createdBy: req.user?.id || 'ADMIN'
        }, { transaction: t });
      }
    }

    // Audit log
    await ProfessionalTaxAuditLog.create({
      userId: req.user?.id || 'ADMIN',
      userName: req.user?.name || 'Admin',
      action: 'CREATE',
      stateId: state.id,
      stateCode: state.stateCode,
      newValue: JSON.stringify({ state, slabsCount: slabs?.length || 0 }),
      reason: 'State created via Admin UI',
      ipAddress: req.ip || req.connection?.remoteAddress
    }, { transaction: t });

    await t.commit();
    return res.status(201).json(state);
  } catch (error) {
    await t.rollback();
    console.error('Error creating PT state:', error);
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/payroll/professional-tax/states/:id - State details + all rules
router.get('/states/:id', async (req, res) => {
  try {
    const state = await ProfessionalTaxState.findByPk(req.params.id);
    if (!state) {
      return res.status(404).json({ error: 'State not found' });
    }

    const rules = await ProfessionalTaxRule.findAll({
      where: { stateId: state.id },
      order: [['priority', 'ASC'], ['salaryFrom', 'ASC']]
    });

    const result = state.toJSON();
    result.rules = rules;
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// PUT /api/payroll/professional-tax/states/:id - Update state metadata
router.put('/states/:id', async (req, res) => {
  try {
    const state = await ProfessionalTaxState.findByPk(req.params.id);
    if (!state) {
      return res.status(404).json({ error: 'State not found' });
    }

    const oldValue = JSON.stringify(state.toJSON());
    const fields = [
      'stateName', 'taxName', 'salaryBasis', 'maxAnnualPt', 'maxMonthlyPt',
      'frequency', 'effectiveFrom', 'effectiveTo', 'description', 'isEnabled'
    ];

    fields.forEach(f => {
      if (req.body[f] !== undefined) state[f] = req.body[f];
    });

    state.updatedBy = req.user?.id || 'ADMIN';
    await state.save();

    await ProfessionalTaxAuditLog.create({
      userId: req.user?.id || 'ADMIN',
      userName: req.user?.name || 'Admin',
      action: req.body.isEnabled !== undefined && req.body.isEnabled !== state.isEnabled ? (state.isEnabled ? 'ACTIVATE' : 'DISABLE') : 'UPDATE',
      stateId: state.id,
      stateCode: state.stateCode,
      oldValue,
      newValue: JSON.stringify(state.toJSON()),
      reason: 'State metadata updated via Admin UI',
      ipAddress: req.ip || req.connection?.remoteAddress
    });

    return res.status(200).json(state);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/payroll/professional-tax/states/:id - Disable / Soft-delete state
router.delete('/states/:id', async (req, res) => {
  try {
    const state = await ProfessionalTaxState.findByPk(req.params.id);
    if (!state) {
      return res.status(404).json({ error: 'State not found' });
    }

    state.isEnabled = false;
    state.updatedBy = req.user?.id || 'ADMIN';
    await state.save();

    await ProfessionalTaxAuditLog.create({
      userId: req.user?.id || 'ADMIN',
      userName: req.user?.name || 'Admin',
      action: 'DISABLE',
      stateId: state.id,
      stateCode: state.stateCode,
      reason: 'State disabled via Admin UI',
      ipAddress: req.ip || req.connection?.remoteAddress
    });

    return res.status(200).json({ message: `State ${state.stateName} has been disabled.`, state });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/payroll/professional-tax/states/:id/rules - Get all rules for state
router.get('/states/:id/rules', async (req, res) => {
  try {
    const rules = await ProfessionalTaxRule.findAll({
      where: { stateId: req.params.id },
      order: [['priority', 'ASC'], ['salaryFrom', 'ASC']]
    });
    return res.status(200).json(rules);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/payroll/professional-tax/states/:id/rules - Batch save / publish slabs for a state
router.post('/states/:id/rules', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const state = await ProfessionalTaxState.findByPk(req.params.id);
    if (!state) {
      await t.rollback();
      return res.status(404).json({ error: 'State not found' });
    }

    const { slabs, effectiveFrom, effectiveTo, status = 'ACTIVE' } = req.body;

    if (!Array.isArray(slabs) || slabs.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: 'At least one slab is required.' });
    }

    const validation = ProfessionalTaxService.validateSlabs(slabs);
    if (!validation.valid) {
      await t.rollback();
      return res.status(400).json({ error: validation.errors.join(' ') });
    }

    const oldRules = await ProfessionalTaxRule.findAll({
      where: { stateId: state.id, isActive: true }
    });

    // Mark previous active rules as EXPIRED / historical if replacing active rule set
    if (status === 'ACTIVE') {
      await ProfessionalTaxRule.update({
        isActive: false,
        status: 'EXPIRED',
        effectiveTo: effectiveFrom ? new Date(new Date(effectiveFrom).getTime() - 86400000).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]
      }, {
        where: { stateId: state.id, isActive: true },
        transaction: t
      });
    }

    const createdRules = [];
    for (let i = 0; i < slabs.length; i++) {
      const s = slabs[i];
      const created = await ProfessionalTaxRule.create({
        stateId: state.id,
        ruleName: s.ruleName || `Slab ${s.salaryFrom} - ${s.salaryTo}`,
        salaryFrom: Number(s.salaryFrom) || 0,
        salaryTo: Number(s.salaryTo) || 999999999,
        ptAmount: Number(s.ptAmount) || 0,
        calculationType: s.calculationType || 'FIXED',
        formulaExpression: s.formulaExpression || null,
        periodType: s.periodType || state.frequency || 'MONTHLY',
        monthSpecificRules: s.monthSpecificRules ? (typeof s.monthSpecificRules === 'string' ? s.monthSpecificRules : JSON.stringify(s.monthSpecificRules)) : null,
        gender: s.gender || 'ALL',
        employeeCategory: s.employeeCategory || 'ALL',
        isExemption: s.isExemption || false,
        exemptionType: s.exemptionType || 'NONE',
        exemptionValue: s.exemptionValue || null,
        effectiveFrom: effectiveFrom || s.effectiveFrom || state.effectiveFrom || '2026-04-01',
        effectiveTo: effectiveTo || s.effectiveTo || null,
        isActive: status === 'ACTIVE',
        status,
        priority: i,
        version: (oldRules.length > 0 ? (oldRules[0].version || 1) + 1 : 1),
        createdBy: req.user?.id || 'ADMIN'
      }, { transaction: t });
      createdRules.push(created);
    }

    // Audit log
    await ProfessionalTaxAuditLog.create({
      userId: req.user?.id || 'ADMIN',
      userName: req.user?.name || 'Admin',
      action: status === 'SCHEDULED' ? 'SCHEDULE' : 'UPDATE',
      stateId: state.id,
      stateCode: state.stateCode,
      oldValue: JSON.stringify(oldRules),
      newValue: JSON.stringify(createdRules),
      reason: `Published ${createdRules.length} slabs (Version ${createdRules[0].version})`,
      ipAddress: req.ip || req.connection?.remoteAddress
    }, { transaction: t });

    await t.commit();
    return res.status(200).json({
      message: `Successfully saved ${createdRules.length} slabs for ${state.stateName}.`,
      rules: createdRules,
      warnings: validation.warnings
    });
  } catch (error) {
    await t.rollback();
    console.error('Error saving PT rules:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/payroll/professional-tax/test - Interactive Sandbox Calculator Tester
router.post('/test', async (req, res) => {
  try {
    const {
      stateId,
      grossSalary = 0,
      basicSalary = 0,
      taxableSalary = 0,
      totalEarnings = 0,
      gender = 'ALL',
      employeeCategory = 'EMPLOYEE',
      payrollDate = new Date().toISOString().split('T')[0],
      ytdPt = 0,
      attendanceRatio = 1
    } = req.body;

    const dummyEmployee = {
      ptEligible: true,
      ptStateId: stateId,
      gender,
      category: employeeCategory
    };

    const result = await ProfessionalTaxService.calculateProfessionalTax({
      employee: dummyEmployee,
      grossSalary: Number(grossSalary),
      basicSalary: Number(basicSalary),
      taxableSalary: Number(taxableSalary),
      totalEarnings: Number(totalEarnings),
      payrollDate,
      ytdPt: Number(ytdPt),
      attendanceRatio: Number(attendanceRatio)
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error testing PT calculation:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/payroll/professional-tax/validate - Validate slab ranges and gaps
router.post('/validate', (req, res) => {
  try {
    const { slabs } = req.body;
    const result = ProfessionalTaxService.validateSlabs(slabs);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/payroll/professional-tax/history/:stateId - Audit history log
router.get('/history/:stateId', async (req, res) => {
  try {
    const logs = await ProfessionalTaxAuditLog.findAll({
      where: { stateId: req.params.stateId },
      order: [['timestamp', 'DESC']],
      limit: 100
    });
    return res.status(200).json(logs);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/payroll/professional-tax/import - Import states & rules configuration with validation
router.post('/import', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { data } = req.body;
    if (!Array.isArray(data) || data.length === 0) {
      await t.rollback();
      return res.status(400).json({ error: 'Import payload must contain a valid array of state configurations.' });
    }

    const importedStates = [];
    for (const item of data) {
      if (!item.stateCode || !item.stateName) {
        await t.rollback();
        return res.status(400).json({ error: 'Each state must have stateCode and stateName.' });
      }

      // Upsert state
      let state = await ProfessionalTaxState.findOne({
        where: { stateCode: item.stateCode.trim().toUpperCase() },
        transaction: t
      });

      if (state) {
        state.stateName = item.stateName;
        state.countryCode = item.countryCode || state.countryCode || 'IN';
        state.taxName = item.taxName || state.taxName || 'Professional Tax';
        state.salaryBasis = item.salaryBasis || state.salaryBasis || 'GROSS_SALARY';
        state.maxAnnualPt = item.maxAnnualPt !== undefined ? item.maxAnnualPt : state.maxAnnualPt;
        state.maxMonthlyPt = item.maxMonthlyPt !== undefined ? item.maxMonthlyPt : state.maxMonthlyPt;
        state.frequency = item.frequency || state.frequency || 'MONTHLY';
        state.effectiveFrom = item.effectiveFrom || state.effectiveFrom || '2026-04-01';
        state.effectiveTo = item.effectiveTo || state.effectiveTo || null;
        state.description = item.description || state.description;
        state.isEnabled = item.isEnabled !== undefined ? item.isEnabled : state.isEnabled;
        state.updatedBy = req.user?.id || 'ADMIN';
        await state.save({ transaction: t });
      } else {
        state = await ProfessionalTaxState.create({
          stateCode: item.stateCode.trim().toUpperCase(),
          stateName: item.stateName.trim(),
          countryCode: item.countryCode || 'IN',
          taxName: item.taxName || 'Professional Tax',
          salaryBasis: item.salaryBasis || 'GROSS_SALARY',
          maxAnnualPt: item.maxAnnualPt !== undefined ? item.maxAnnualPt : 2500,
          maxMonthlyPt: item.maxMonthlyPt !== undefined ? item.maxMonthlyPt : null,
          frequency: item.frequency || 'MONTHLY',
          effectiveFrom: item.effectiveFrom || '2026-04-01',
          effectiveTo: item.effectiveTo || null,
          description: item.description || null,
          isEnabled: item.isEnabled !== undefined ? item.isEnabled : true,
          createdBy: req.user?.id || 'ADMIN'
        }, { transaction: t });
      }

      // If slabs / rules are included in the state import
      if (Array.isArray(item.rules) && item.rules.length > 0) {
        // Mark existing rules as inactive
        await ProfessionalTaxRule.update({ isActive: false, status: 'EXPIRED' }, {
          where: { stateId: state.id },
          transaction: t
        });

        for (let i = 0; i < item.rules.length; i++) {
          const s = item.rules[i];
          await ProfessionalTaxRule.create({
            stateId: state.id,
            ruleName: s.ruleName || `Slab ${s.salaryFrom} - ${s.salaryTo}`,
            salaryFrom: Number(s.salaryFrom) || 0,
            salaryTo: Number(s.salaryTo) || 999999999,
            ptAmount: Number(s.ptAmount) || 0,
            calculationType: s.calculationType || 'FIXED',
            formulaExpression: s.formulaExpression || null,
            periodType: s.periodType || state.frequency || 'MONTHLY',
            monthSpecificRules: s.monthSpecificRules ? (typeof s.monthSpecificRules === 'string' ? s.monthSpecificRules : JSON.stringify(s.monthSpecificRules)) : null,
            gender: s.gender || 'ALL',
            employeeCategory: s.employeeCategory || 'ALL',
            isExemption: s.isExemption || false,
            exemptionType: s.exemptionType || 'NONE',
            exemptionValue: s.exemptionValue || null,
            effectiveFrom: s.effectiveFrom || state.effectiveFrom || '2026-04-01',
            effectiveTo: s.effectiveTo || state.effectiveTo || null,
            isActive: s.isActive !== undefined ? s.isActive : true,
            status: s.status || 'ACTIVE',
            priority: i,
            version: s.version || 1,
            createdBy: req.user?.id || 'ADMIN'
          }, { transaction: t });
        }
      }

      await ProfessionalTaxAuditLog.create({
        userId: req.user?.id || 'ADMIN',
        userName: req.user?.name || 'Admin',
        action: 'IMPORT',
        stateId: state.id,
        stateCode: state.stateCode,
        newValue: JSON.stringify({ state, rulesCount: item.rules?.length || 0 }),
        reason: 'Imported via Admin UI Configuration Import',
        ipAddress: req.ip || req.connection?.remoteAddress
      }, { transaction: t });

      importedStates.push(state);
    }

    await t.commit();
    return res.status(200).json({
      message: `Successfully imported ${importedStates.length} states.`,
      states: importedStates
    });
  } catch (error) {
    await t.rollback();
    console.error('Error importing PT config:', error);
    return res.status(500).json({ error: error.message });
  }
});

// POST /api/payroll/professional-tax/states/:id/duplicate - Duplicate an existing state and rules
router.post('/states/:id/duplicate', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const originalState = await ProfessionalTaxState.findByPk(req.params.id);
    if (!originalState) {
      await t.rollback();
      return res.status(404).json({ error: 'Source state not found' });
    }

    const { newStateCode, newStateName } = req.body;
    if (!newStateCode || !newStateName) {
      await t.rollback();
      return res.status(400).json({ error: 'New State Code and New State Name are required.' });
    }

    const existing = await ProfessionalTaxState.findOne({
      where: { stateCode: newStateCode.trim().toUpperCase() }
    });
    if (existing) {
      await t.rollback();
      return res.status(400).json({ error: `State with code '${newStateCode}' already exists.` });
    }

    const newState = await ProfessionalTaxState.create({
      stateCode: newStateCode.trim().toUpperCase(),
      stateName: newStateName.trim(),
      countryCode: originalState.countryCode,
      taxName: originalState.taxName,
      salaryBasis: originalState.salaryBasis,
      maxAnnualPt: originalState.maxAnnualPt,
      maxMonthlyPt: originalState.maxMonthlyPt,
      frequency: originalState.frequency,
      effectiveFrom: originalState.effectiveFrom,
      effectiveTo: originalState.effectiveTo,
      description: `Cloned from ${originalState.stateName} (${originalState.stateCode})`,
      isEnabled: true,
      createdBy: req.user?.id || 'ADMIN'
    }, { transaction: t });

    const originalRules = await ProfessionalTaxRule.findAll({
      where: { stateId: originalState.id, isActive: true }
    });

    for (let i = 0; i < originalRules.length; i++) {
      const r = originalRules[i];
      await ProfessionalTaxRule.create({
        stateId: newState.id,
        ruleName: r.ruleName,
        salaryFrom: r.salaryFrom,
        salaryTo: r.salaryTo,
        ptAmount: r.ptAmount,
        calculationType: r.calculationType,
        formulaExpression: r.formulaExpression,
        periodType: r.periodType,
        monthSpecificRules: r.monthSpecificRules,
        gender: r.gender,
        employeeCategory: r.employeeCategory,
        isExemption: r.isExemption,
        exemptionType: r.exemptionType,
        exemptionValue: r.exemptionValue,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        isActive: true,
        status: 'ACTIVE',
        priority: i,
        version: 1,
        createdBy: req.user?.id || 'ADMIN'
      }, { transaction: t });
    }

    await ProfessionalTaxAuditLog.create({
      userId: req.user?.id || 'ADMIN',
      userName: req.user?.name || 'Admin',
      action: 'CREATE',
      stateId: newState.id,
      stateCode: newState.stateCode,
      newValue: JSON.stringify(newState),
      reason: `Duplicated from ${originalState.stateName}`,
      ipAddress: req.ip || req.connection?.remoteAddress
    }, { transaction: t });

    await t.commit();
    return res.status(201).json(newState);
  } catch (error) {
    await t.rollback();
    return res.status(500).json({ error: error.message });
  }
});

// PUT /api/payroll/professional-tax/rules/:ruleId - Single rule update
router.put('/rules/:ruleId', async (req, res) => {
  try {
    const rule = await ProfessionalTaxRule.findByPk(req.params.ruleId);
    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    const fields = [
      'ruleName', 'salaryFrom', 'salaryTo', 'ptAmount', 'calculationType',
      'formulaExpression', 'periodType', 'monthSpecificRules', 'gender',
      'employeeCategory', 'isExemption', 'exemptionType', 'exemptionValue',
      'effectiveFrom', 'effectiveTo', 'isActive', 'status', 'priority'
    ];

    fields.forEach(f => {
      if (req.body[f] !== undefined) rule[f] = req.body[f];
    });

    rule.updatedBy = req.user?.id || 'ADMIN';
    await rule.save();

    await ProfessionalTaxAuditLog.create({
      userId: req.user?.id || 'ADMIN',
      userName: req.user?.name || 'Admin',
      action: 'UPDATE',
      stateId: rule.stateId,
      ruleId: rule.id,
      newValue: JSON.stringify(rule),
      reason: 'Single rule updated via Admin UI',
      ipAddress: req.ip || req.connection?.remoteAddress
    });

    return res.status(200).json(rule);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// DELETE /api/payroll/professional-tax/rules/:ruleId - Soft-delete / deactivate rule
router.delete('/rules/:ruleId', async (req, res) => {
  try {
    const rule = await ProfessionalTaxRule.findByPk(req.params.ruleId);
    if (!rule) {
      return res.status(404).json({ error: 'Rule not found' });
    }

    rule.isActive = false;
    rule.status = 'DISABLED';
    rule.updatedBy = req.user?.id || 'ADMIN';
    await rule.save();

    await ProfessionalTaxAuditLog.create({
      userId: req.user?.id || 'ADMIN',
      userName: req.user?.name || 'Admin',
      action: 'DELETE',
      stateId: rule.stateId,
      ruleId: rule.id,
      reason: 'Rule deactivated via Admin UI',
      ipAddress: req.ip || req.connection?.remoteAddress
    });

    return res.status(200).json({ message: 'Rule deactivated successfully.', rule });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// GET /api/payroll/professional-tax/export - Export all states & rules as JSON
router.get('/export', async (req, res) => {
  try {
    const states = await ProfessionalTaxState.findAll({
      include: [{ model: ProfessionalTaxRule, as: 'rules' }],
      order: [['stateName', 'ASC']]
    });
    return res.status(200).json({
      exportDate: new Date().toISOString(),
      version: '1.0',
      data: states
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;

