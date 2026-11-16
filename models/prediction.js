const mongoose = require('mongoose');

const predictionSchema = new mongoose.Schema({
    matchDate: {
        type: Date,
        required: true,
        set: function(date) {
            return new Date(date);
        },
        get: function(date) {
            const d = new Date(date);
            d.setHours(12, 0, 0, 0);
            return d;
        }
    },
    homeTeam: { type: String, required: true },
    awayTeam: { type: String, required: true },
    league: {
        name: { type: String, required: true },
        flag: { type: String, required: true }
    },
    prediction: { type: String, required: true },
    status: {
        type: String,
        enum: ['pending', 'win', 'loss'],
        default: 'pending'
    },
    createdAt: { type: Date, default: Date.now }
});

predictionSchema.index({ matchDate: 1 });

module.exports = mongoose.model('Prediction', predictionSchema);
