document.addEventListener('DOMContentLoaded', () => {
    loadPredictions();
});

function statusBadge(status) {
    const labels = { win: 'Win ✓', loss: 'Loss ✗', pending: 'Pending' };
    const cls = { win: 'status-win', loss: 'status-loss', pending: 'status-pending' };
    return `<span class="status-badge ${cls[status] || 'status-pending'}">${labels[status] || 'Pending'}</span>`;
}

function formatFullDate(date) {
    return date.toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
}

function isToday(date) {
    const t = new Date();
    return date.getDate() === t.getDate() && date.getMonth() === t.getMonth() && date.getFullYear() === t.getFullYear();
}

async function loadPredictions() {
    const container = document.getElementById('predictions-list');
    container.innerHTML = `
        <div class="state-card">
            <div class="icon">⏳</div>
            <div>Loading predictions...</div>
        </div>`;

    try {
        const response = await fetch('/api/predictions');
        if (!response.ok) throw new Error('Failed to load');
        const predictions = await response.json();

        // Статистика
        const wins   = predictions.filter(p => p.status === 'win').length;
        const losses = predictions.filter(p => p.status === 'loss').length;
        const total  = wins + losses;
        const rate   = total > 0 ? Math.round((wins / total) * 100) : 0;

        document.getElementById('stat-total').textContent = predictions.length;
        document.getElementById('stat-wins').textContent  = wins;
        document.getElementById('stat-rate').textContent  = total > 0 ? rate + '%' : '—';

        // Сортиране — най-нови отдолу, днешните отгоре
        predictions.sort((a, b) => new Date(b.matchDate) - new Date(a.matchDate));

        container.innerHTML = '';

        if (predictions.length === 0) {
            container.innerHTML = `
                <div class="state-card">
                    <div class="icon">📋</div>
                    <div>No predictions yet. Check back soon!</div>
                </div>`;
            return;
        }

        // Групиране по дата
        const groups = {};
        predictions.forEach(p => {
            if (!p?.league) return;
            const key = new Date(p.matchDate).toISOString().split('T')[0];
            if (!groups[key]) groups[key] = [];
            groups[key].push(p);
        });

        Object.entries(groups).forEach(([dateKey, preds], groupIdx) => {
            const date = new Date(dateKey);
            const dateLabel = isToday(date) ? '📅 Today' : formatFullDate(date);

            const group = document.createElement('div');
            group.className = 'date-group';
            group.innerHTML = `
                <div class="date-group-header">
                    <span class="date-badge">${dateLabel}</span>
                </div>`;

            preds.forEach((prediction, i) => {
                const card = document.createElement('div');
                const statusClass = prediction.status === 'win' ? 'win' : prediction.status === 'loss' ? 'loss' : '';
                card.className = `match-card ${statusClass}`;
                card.style.animationDelay = `${(groupIdx * preds.length + i) * 40}ms`;
                card.innerHTML = `
                    <div class="match-card-top">
                        <div class="league-info">
                            <span class="league-flag">${prediction.league?.flag || '🌐'}</span>
                            <span>${prediction.league?.name || ''}</span>
                        </div>
                    </div>
                    <div class="match-teams">
                        <div class="team home">${prediction.homeTeam || ''}</div>
                        <div class="vs-badge">VS</div>
                        <div class="team away">${prediction.awayTeam || ''}</div>
                    </div>
                    <div class="match-card-bottom">
                        <div>
                            <span class="prediction-label">Tip</span>
                            <span class="prediction-value">${prediction.prediction || ''}</span>
                        </div>
                        ${statusBadge(prediction.status)}
                    </div>`;
                group.appendChild(card);
            });

            container.appendChild(group);
        });

    } catch (error) {
        console.error('Error loading predictions:', error);
        container.innerHTML = `
            <div class="state-card">
                <div class="icon">⚠️</div>
                <div>Failed to load predictions. Please try again later.</div>
            </div>`;
    }
}