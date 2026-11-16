document.addEventListener('DOMContentLoaded', () => {
    loadAdminPredictions();
    document.getElementById('predictionForm')?.addEventListener('submit', handleAddPrediction);
});

function getStatusBadge(status) {
    const map = { win: 'success', loss: 'danger', pending: 'secondary' };
    const labels = { win: 'Win', loss: 'Loss', pending: 'Pending' };
    return `<span class="badge bg-${map[status] || 'secondary'}">${labels[status] || 'Pending'}</span>`;
}

async function handleAddPrediction(e) {
    e.preventDefault();
    const formData = {
        matchDate: document.getElementById('matchDate').value,
        homeTeam: document.getElementById('homeTeam').value,
        awayTeam: document.getElementById('awayTeam').value,
        league: {
            name: document.getElementById('leagueName').value.trim(),
            flag: document.getElementById('leagueFlag').value.trim()
        },
        prediction: document.getElementById('prediction').value,
        status: document.getElementById('status').value
    };

    try {
        const response = await fetch('api/predictions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(formData)
        });
        const data = await response.json();
        if (response.ok) {
            alert('Prediction added successfully');
            loadAdminPredictions();
            e.target.reset();
        } else if (response.status === 401) {
            window.location.href = 'login';
        } else {
            alert('Failed to add prediction: ' + data.message);
        }
    } catch (error) {
        console.error('Error adding prediction:', error);
        alert('Failed to add prediction');
    }
}

async function loadAdminPredictions() {
    const tbody = document.getElementById('admin-predictions-body');
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-3">
        <div class="spinner-border text-success" role="status"></div></td></tr>`;

    try {
        const response = await fetch('api/predictions', { credentials: 'include' });
        if (response.status === 401) { window.location.href = 'login'; return; }
        if (!response.ok) throw new Error('Failed to load predictions');

        const predictions = await response.json();
        predictions.sort((a, b) => new Date(b.matchDate) - new Date(a.matchDate));

        tbody.innerHTML = '';
        let currentDate = '';

        predictions.forEach(prediction => {
            if (!prediction || !prediction.league) return;

            const date = new Date(prediction.matchDate);
            const formattedDate = date.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
            const dateString = date.toISOString().split('T')[0];

            if (currentDate !== dateString) {
                currentDate = dateString;
                const dateRow = document.createElement('tr');
                dateRow.className = 'date-separator';
                dateRow.innerHTML = `<td colspan="7" style="padding:0.5rem 1rem;font-weight:600;">${formattedDate}</td>`;
                tbody.appendChild(dateRow);
            }

            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${formattedDate}</td>
                <td><span class="team-flag">${prediction.league?.flag || ''}</span></td>
                <td>${prediction.homeTeam || ''}</td>
                <td>${prediction.awayTeam || ''}</td>
                <td>${prediction.prediction || ''}</td>
                <td>${getStatusBadge(prediction.status)}</td>
                <td>
                    <button class="btn btn-sm btn-warning btn-action me-1" onclick="openEditModal(${JSON.stringify(prediction).replace(/"/g, '&quot;')})">Edit</button>
                    <button class="btn btn-sm btn-danger btn-action" onclick="deletePrediction('${prediction._id}')">Delete</button>
                </td>
            `;
            tbody.appendChild(row);
        });

        if (predictions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-3" style="color:rgba(255,255,255,0.5);">No predictions yet.</td></tr>`;
        }
    } catch (error) {
        console.error('Error loading predictions:', error);
        tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-3">Failed to load predictions</td></tr>`;
    }
}

function openEditModal(prediction) {
    document.getElementById('editId').value = prediction._id;
    const d = new Date(prediction.matchDate);
    document.getElementById('editMatchDate').value = d.toISOString().split('T')[0];
    document.getElementById('editLeagueName').value = prediction.league?.name || '';
    document.getElementById('editLeagueFlag').value = prediction.league?.flag || '';
    document.getElementById('editHomeTeam').value = prediction.homeTeam || '';
    document.getElementById('editAwayTeam').value = prediction.awayTeam || '';
    document.getElementById('editPrediction').value = prediction.prediction || '';
    document.getElementById('editStatus').value = prediction.status || 'pending';
    new bootstrap.Modal(document.getElementById('editModal')).show();
}

async function saveEdit() {
    const id = document.getElementById('editId').value;
    const formData = {
        matchDate: document.getElementById('editMatchDate').value,
        homeTeam: document.getElementById('editHomeTeam').value,
        awayTeam: document.getElementById('editAwayTeam').value,
        league: {
            name: document.getElementById('editLeagueName').value.trim(),
            flag: document.getElementById('editLeagueFlag').value.trim()
        },
        prediction: document.getElementById('editPrediction').value,
        status: document.getElementById('editStatus').value
    };

    try {
        const response = await fetch(`api/predictions/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(formData)
        });
        if (response.ok) {
            bootstrap.Modal.getInstance(document.getElementById('editModal')).hide();
            loadAdminPredictions();
        } else if (response.status === 401) {
            window.location.href = 'login';
        } else {
            const data = await response.json();
            alert('Failed to update: ' + data.message);
        }
    } catch (error) {
        console.error('Error updating prediction:', error);
        alert('Failed to update prediction');
    }
}

async function deletePrediction(id) {
    if (!confirm('Are you sure you want to delete this prediction?')) return;
    try {
        const response = await fetch(`api/predictions/${id}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        if (response.ok) {
            loadAdminPredictions();
        } else if (response.status === 401) {
            window.location.href = 'login';
        } else {
            throw new Error('Failed to delete');
        }
    } catch (error) {
        console.error('Error deleting prediction:', error);
        alert('Failed to delete prediction');
    }
}
