let currentUser = null;
let currentProfile = null;

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}
function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('driver-login.html');
    if (!currentUser) return;
    currentProfile = await getProfile(currentUser.id);
    if (!currentProfile || currentProfile.role !== 'driver') { window.location.href = 'driver-login.html'; return; }

    document.getElementById('pNewJob').checked = currentProfile.dnotif_new_job !== false;
    document.getElementById('pJobCancelled').checked = currentProfile.dnotif_job_cancelled !== false;
    document.getElementById('pPaymentReceived').checked = currentProfile.dnotif_payment_received !== false;
    document.getElementById('pWeeklySummary').checked = currentProfile.dnotif_weekly_summary !== false;
    document.getElementById('pSupportReply').checked = currentProfile.dnotif_support_reply !== false;
    document.getElementById('pPromotion').checked = currentProfile.dnotif_promotion !== false;
    document.getElementById('pMaintenance').checked = currentProfile.dnotif_maintenance_reminder !== false;
    document.getElementById('pDocExpiring').checked = currentProfile.dnotif_document_expiring !== false;
    document.getElementById('pAccountStatus').checked = currentProfile.dnotif_account_status !== false;

    document.getElementById('savePrefsBtn').addEventListener('click', savePrefs);

    await renderNotifications();
});

async function savePrefs() {
    const msg = document.getElementById('prefsMsg');
    const fields = {
        dnotif_new_job: document.getElementById('pNewJob').checked,
        dnotif_job_cancelled: document.getElementById('pJobCancelled').checked,
        dnotif_payment_received: document.getElementById('pPaymentReceived').checked,
        dnotif_weekly_summary: document.getElementById('pWeeklySummary').checked,
        dnotif_support_reply: document.getElementById('pSupportReply').checked,
        dnotif_promotion: document.getElementById('pPromotion').checked,
        dnotif_maintenance_reminder: document.getElementById('pMaintenance').checked,
        dnotif_document_expiring: document.getElementById('pDocExpiring').checked,
        dnotif_account_status: document.getElementById('pAccountStatus').checked,
    };
    msg.textContent = 'Saving...';
    const { error } = await supabase.from('profiles').update(fields).eq('id', currentUser.id);
    msg.textContent = error ? 'Could not save: ' + error.message : 'Preferences saved.';
    if (!error) { currentProfile = Object.assign(currentProfile, fields); renderNotifications(); }
}

async function renderNotifications() {
    const notifs = [];
    const dayAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const { data: jobs } = await supabase.from('jobs').select('*').eq('driver_id', currentUser.id).order('created_at', { ascending: false }).limit(50);
    (jobs || []).forEach(function (j) {
        if (currentProfile.dnotif_new_job !== false && j.status === 'offered' && j.assigned_at && new Date(j.assigned_at).getTime() >= dayAgo) {
            notifs.push({ time: j.assigned_at, label: 'New job assigned: ' + j.pickup + ' → ' + j.dropoff });
        }
        if (currentProfile.dnotif_job_cancelled !== false && j.status === 'cancelled' && j.cancelled_at && new Date(j.cancelled_at).getTime() >= dayAgo) {
            notifs.push({ time: j.cancelled_at, label: 'Job cancelled: ' + j.pickup + ' → ' + j.dropoff });
        }
        if (currentProfile.dnotif_payment_received !== false && j.status === 'delivered' && j.payment_status === 'paid' && j.delivered_at && new Date(j.delivered_at).getTime() >= dayAgo) {
            notifs.push({ time: j.delivered_at, label: 'Payment received for job ' + j.id.slice(0, 8) });
        }
    });

    if (currentProfile.dnotif_document_expiring !== false) {
        [['insurance_expiry', 'Insurance'], ['license_disc_expiry', 'Licence Disc'], ['roadworthy_expiry', 'Roadworthy'], ['license_expiry', 'Driving Licence']].forEach(function (pair) {
            const val = currentProfile[pair[0]];
            if (val) {
                const days = Math.round((new Date(val) - new Date()) / 86400000);
                if (days <= 30) notifs.push({ time: new Date().toISOString(), label: pair[1] + (days < 0 ? ' has expired' : ' expires in ' + days + ' days') });
            }
        });
    }

    if (currentProfile.dnotif_support_reply !== false) {
        const { data: msgs } = await supabase.from('support_ticket_messages').select('*, support_tickets!inner(driver_id)').eq('sender_type', 'staff').eq('support_tickets.driver_id', currentUser.id).order('created_at', { ascending: false }).limit(10);
        (msgs || []).forEach(function (m) {
            if (new Date(m.created_at).getTime() >= dayAgo) notifs.push({ time: m.created_at, label: 'Support replied to your ticket' });
        });
    }

    notifs.sort(function (a, b) { return new Date(b.time) - new Date(a.time); });

    const wrap = document.getElementById('notifList');
    const empty = document.getElementById('emptyState');
    if (!notifs.length) { wrap.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    wrap.innerHTML = notifs.map(function (n) {
        return '<div class="notif-item">' + escapeHtml(n.label) + '<div class="notif-time">' + formatTime(n.time) + '</div></div>';
    }).join('');
}
