const express = require('express');
const router = express.Router();
const Rule = require('../../../../shared/models/Rule');

// GET /api/rules - Get all rules
router.get('/', async (req, res) => {
  try {
    const rules = await Rule.findAll({
      order: [['category', 'ASC'], ['key', 'ASC']]
    });
    return res.status(200).json(rules);
  } catch (error) {
    console.error('Error fetching system rules:', error);
    return res.status(500).json({ error: error.message });
  }
});

// PUT /api/rules - Update rules in bulk
router.put('/', async (req, res) => {
  try {
    const { rules } = req.body;
    if (!rules || !Array.isArray(rules)) {
      return res.status(400).json({ error: 'Invalid payload format. Expected rules array.' });
    }

    // Perform updates inside a transaction or sequentially
    for (const r of rules) {
      if (r.key && r.value !== undefined) {
        const ruleItem = await Rule.findByPk(r.key);
        if (ruleItem) {
          ruleItem.value = String(r.value);
          await ruleItem.save();
        }
      }
    }

    const updatedRules = await Rule.findAll({
      order: [['category', 'ASC'], ['key', 'ASC']]
    });
    return res.status(200).json(updatedRules);
  } catch (error) {
    console.error('Error updating system rules:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
