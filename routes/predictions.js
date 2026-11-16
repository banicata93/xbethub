const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const Prediction = require('../models/prediction');

// GET /api/predictions  (публично)
router.get('/', async (req, res) => {
    try {
        const predictions = await Prediction.find();
        const formatted = predictions.map(p => {
            const obj = p.toObject();
            const date = new Date(obj.matchDate);
            obj.matchDate = new Date(date.getTime() - (date.getTimezoneOffset() * 60000));
            return obj;
        });
        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// POST /api/predictions  (защитено)
router.post('/', auth, async (req, res) => {
    try {
        const { matchDate, homeTeam, awayTeam, league, prediction, status } = req.body;
        if (!matchDate || !homeTeam || !awayTeam || !league || !league.flag || !prediction) {
            return res.status(400).json({ message: 'All fields are required' });
        }
        const newPrediction = new Prediction({
            matchDate: new Date(matchDate),
            homeTeam,
            awayTeam,
            league,
            prediction,
            status: status || 'pending'
        });
        const saved = await newPrediction.save();
        res.status(201).json(saved);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// PUT /api/predictions/:id  (защитено — само позволени полета)
router.put('/:id', auth, async (req, res) => {
    try {
        const { matchDate, homeTeam, awayTeam, league, prediction, status } = req.body;
        const updated = await Prediction.findByIdAndUpdate(
            req.params.id,
            { matchDate, homeTeam, awayTeam, league, prediction, status },
            { new: true, runValidators: true }
        );
        if (!updated) return res.status(404).json({ message: 'Prediction not found' });
        res.json(updated);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
});

// DELETE /api/predictions/:id  (защитено)
router.delete('/:id', auth, async (req, res) => {
    try {
        const deleted = await Prediction.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ message: 'Prediction not found' });
        res.json({ message: 'Prediction deleted' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

module.exports = router;
