const MODULES = ['Dashboard', 'Drivers', 'Jobs', 'Dispatch', 'Finances', 'Commissions', 'Customers', 'Reviews'];
const ROLES = ['super_admin', 'admin', 'dispatcher', 'finance', 'support', 'read_only'];
const ROLE_LABELS = { super_admin: 'Super Admin', admin: 'Admin', dispatcher: 'Dispatcher', finance: 'Finance', support: 'Support', read_only: 'Read Only' };

let integrationSettings = {};
let staffAccounts = [];
let rolePermissions = [];
let auditLogs = [];
let currentPermRole = 'super_admin';

document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireSession('admin-login.html');
    if (!user) return;

    const profile = await getProfile(user.id);
    if (!profile || profile.role !== 'admin') {
        await supabase.auth.signOut();
        window.location.href = 'admin-login.html';
        return;
    }
    window.currentAdminName = profile.full_name || profile.email || 'Admin';
    window.currentStaffRole = profile.staff_role || 'super_admin';

    document.getElementById('logoutBtn').addEventListener('click', async function () {
        await supabase.auth.signOut();
        window.location.href = 'login.html';
    });
    document.getElementById('refreshBtn').addEventListener('click', loadAll);

    document.querySelectorAll('.settings-nav-item').forEach(function (item) {
        item.addEventListener('click', function () { switchSection(item.dataset.section); });
    });

    document.getElementById('saveCompanyBtn').addEventListener('click', saveCompany);
    document.getElementById('companyLogoFile').addEventListener('change', uploadCompanyLogo);
    document.getElementById('saveDeliveryBtn').addEventListener('click', saveDelivery);
    document.getElementById('saveDriversBtn').addEventListener('click', saveDrivers);
    document.getElementById('saveCustomersBtn').addEventListener('click', saveCustomers);
    document.getElementById('saveNotificationsBtn').addEventListener('click', saveNotifications);
    document.getElementById('saveIntegrationsBtn').addEventListener('click', saveIntegrations);
    document.getElementById('saveAppearanceBtn').addEventListener('click', saveAppearance);
    document.getElementById('permRoleSelect').addEventListener('change', function () { currentPermRole = this.value; renderPermTable(); });
    document.getElementById('savePermsBtn').addEventListener('click', savePermissions);
    document.getElementById('auditSearch').addEventListener('input', renderAuditLogs);
    document.getElementById('auditModuleFilter').addEventListener('change', renderAuditLogs);

    populateAuditModuleFilter();

    await loadAll();
});

function switchSection(section) {
    document.querySelectorAll('.settings-nav-item').forEach(function (i) { i.classList.toggle('active', i.dataset.section === section); });
    document.querySelectorAll('.settings-section').forEach(function (s) { s.classList.toggle('active', s.id === 'section-' + section); });
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s || '';
    return d.innerHTML;
}

function formatTime(iso) { return iso ? new Date(iso).toLocaleString('en-ZA', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'; }

async function loadAll() {
    await loadAppSettings();
    populateGeneralFields();

    const { data: integrations } = await supabase.from('integration_settings').select('*');
    integrationSettings = {};
    (integrations || []).forEach(function (row) { integrationSettings[row.key] = row.value; });
    populateIntegrationFields();

    const { data: staff } = await supabase.from('profiles').select('*').eq('role', 'admin');
    staffAccounts = staff || [];
    renderStaffAccounts();

    const { data: perms } = await supabase.from('role_permissions').select('*');
    rolePermissions = perms || [];
    renderPermTable();

    const { data: logs } = await supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(200);
    auditLogs = logs || [];
    renderAuditLogs();
}

function populateGeneralFields() {
    document.getElementById('companyName').value = appSetting('company_name', '');
    document.getElementById('companyRegNumber').value = appSetting('company_reg_number', '');
    document.getElementById('companyVatNumber').value = appSetting('company_vat_number', '');
    document.getElementById('companyEmail').value = appSetting('company_email', '');
    document.getElementById('companyPhone').value = appSetting('company_phone', '');
    document.getElementById('companyAddress').value = appSetting('company_address', '');
    document.getElementById('companyWebsite').value = appSetting('company_website', '');
    const logoUrl = appSetting('company_logo_url', '');
    document.getElementById('companyLogoPreview').innerHTML = logoUrl ? '<img src="' + escapeHtml(logoUrl) + '" style="height:48px;">' : '<span class="meta">No logo uploaded.</span>';

    document.getElementById('minDeliveryFee').value = appSetting('min_delivery_fee', '0');
    document.getElementById('maxDeliveryRadius').value = appSetting('max_delivery_radius_km', '0');
    document.getElementById('waitingFee').value = appSetting('waiting_fee', '0');
    document.getElementById('cancellationFee').value = appSetting('cancellation_fee', '0');

    document.getElementById('driverRegistrationEnabled').checked = appSetting('driver_registration_enabled', 'true') === 'true';
    document.getElementById('driverManualApproval').checked = appSetting('driver_manual_approval', 'true') === 'true';
    document.getElementById('driverMaxActiveJobs').value = appSetting('driver_max_active_jobs', '1');
    document.getElementById('driverMinRating').value = appSetting('driver_min_rating', '0');
    document.getElementById('driverMaxRadius').value = appSetting('driver_max_radius_km', '0');

    document.getElementById('customerRegistrationEnabled').checked = appSetting('customer_registration_enabled', 'true') === 'true';
    document.getElementById('customerPhoneVerification').checked = appSetting('customer_phone_verification', 'false') === 'true';
    document.getElementById('customerEmailVerification').checked = appSetting('customer_email_verification', 'false') === 'true';
    document.getElementById('customerMaxActiveOrders').value = appSetting('customer_max_active_orders', '0');

    document.getElementById('notifySms').checked = appSetting('notify_sms_enabled', 'false') === 'true';
    document.getElementById('notifyEmail').checked = appSetting('notify_email_enabled', 'false') === 'true';
    document.getElementById('notifyPush').checked = appSetting('notify_push_enabled', 'false') === 'true';
    document.getElementById('notifyWhatsapp').checked = appSetting('notify_whatsapp_enabled', 'true') === 'true';
    document.getElementById('eventJobAssigned').checked = appSetting('notify_event_job_assigned', 'true') === 'true';
    document.getElementById('eventPickup').checked = appSetting('notify_event_pickup', 'true') === 'true';
    document.getElementById('eventDelivered').checked = appSetting('notify_event_delivered', 'true') === 'true';
    document.getElementById('eventCancelled').checked = appSetting('notify_event_cancelled', 'true') === 'true';

    document.getElementById('timezone').value = appSetting('timezone', 'Africa/Johannesburg');
    document.getElementById('currency').value = appSetting('currency', 'ZAR');
    document.getElementById('dateFormat').value = appSetting('date_format', 'DD/MM/YYYY');
    document.getElementById('distanceUnit').value = appSetting('distance_unit', 'km');
}

function populateIntegrationFields() {
    document.getElementById('googleMapsKey').value = integrationSettings.google_maps_api_key || '';
    document.getElementById('smsProvider').value = integrationSettings.sms_provider || '';
    document.getElementById('smsApiKey').value = integrationSettings.sms_api_key || '';
    document.getElementById('smtpHost').value = integrationSettings.smtp_host || '';
    document.getElementById('smtpPort').value = integrationSettings.smtp_port || '';
    document.getElementById('smtpUsername').value = integrationSettings.smtp_username || '';
    document.getElementById('smtpPassword').value = integrationSettings.smtp_password || '';
    document.getElementById('paymentProvider').value = integrationSettings.payment_gateway_provider || '';
    document.getElementById('paymentApiKey').value = integrationSettings.payment_gateway_api_key || '';
}

function showMsg(elId, type, text) {
    document.getElementById(elId).innerHTML = '<div class="msg ' + type + '">' + text + '</div>';
}

async function saveSetting(key, value) {
    await supabase.from('settings').update({ value: String(value) }).eq('key', key);
}

async function saveCompany() {
    await saveSetting('company_name', document.getElementById('companyName').value.trim());
    await saveSetting('company_reg_number', document.getElementById('companyRegNumber').value.trim());
    await saveSetting('company_vat_number', document.getElementById('companyVatNumber').value.trim());
    await saveSetting('company_email', document.getElementById('companyEmail').value.trim());
    await saveSetting('company_phone', document.getElementById('companyPhone').value.trim());
    await saveSetting('company_address', document.getElementById('companyAddress').value.trim());
    await saveSetting('company_website', document.getElementById('companyWebsite').value.trim());
    await logAudit('Updated company settings', 'Settings');
    showMsg('companyMsg', 'success', 'Company settings saved.');
    loadAppSettings();
}

async function uploadCompanyLogo() {
    const file = document.getElementById('companyLogoFile').files[0];
    if (!file) return;
    const session = await supabase.auth.getSession();
    const uid = session.data.session.user.id;
    const path = uid + '/company-logo-' + Date.now() + '-' + file.name;
    const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file);
    if (uploadError) { showMsg('companyMsg', 'error', 'Failed to upload logo: ' + uploadError.message); return; }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path);
    await saveSetting('company_logo_url', data.publicUrl);
    document.getElementById('companyLogoPreview').innerHTML = '<img src="' + escapeHtml(data.publicUrl) + '" style="height:48px;">';
    await logAudit('Updated company logo', 'Settings');
    showMsg('companyMsg', 'success', 'Logo uploaded.');
}

async function saveDelivery() {
    await saveSetting('min_delivery_fee', parseFloat(document.getElementById('minDeliveryFee').value) || 0);
    await saveSetting('max_delivery_radius_km', parseFloat(document.getElementById('maxDeliveryRadius').value) || 0);
    await saveSetting('waiting_fee', parseFloat(document.getElementById('waitingFee').value) || 0);
    await saveSetting('cancellation_fee', parseFloat(document.getElementById('cancellationFee').value) || 0);
    await logAudit('Updated delivery settings', 'Settings');
    showMsg('deliveryMsg', 'success', 'Delivery settings saved.');
    loadAppSettings();
}

async function saveDrivers() {
    await saveSetting('driver_registration_enabled', document.getElementById('driverRegistrationEnabled').checked);
    await saveSetting('driver_manual_approval', document.getElementById('driverManualApproval').checked);
    await saveSetting('driver_max_active_jobs', parseInt(document.getElementById('driverMaxActiveJobs').value, 10) || 1);
    await saveSetting('driver_min_rating', parseFloat(document.getElementById('driverMinRating').value) || 0);
    await saveSetting('driver_max_radius_km', parseFloat(document.getElementById('driverMaxRadius').value) || 0);
    await logAudit('Updated driver settings', 'Settings');
    showMsg('driversMsg', 'success', 'Driver settings saved — Dispatch and auto-assign will use these limits immediately.');
    loadAppSettings();
}

async function saveCustomers() {
    await saveSetting('customer_registration_enabled', document.getElementById('customerRegistrationEnabled').checked);
    await saveSetting('customer_max_active_orders', parseInt(document.getElementById('customerMaxActiveOrders').value, 10) || 0);
    await logAudit('Updated customer settings', 'Settings');
    showMsg('customersMsg', 'success', 'Customer settings saved.');
    loadAppSettings();
}

async function saveNotifications() {
    await saveSetting('notify_sms_enabled', document.getElementById('notifySms').checked);
    await saveSetting('notify_email_enabled', document.getElementById('notifyEmail').checked);
    await saveSetting('notify_push_enabled', document.getElementById('notifyPush').checked);
    await saveSetting('notify_whatsapp_enabled', document.getElementById('notifyWhatsapp').checked);
    await saveSetting('notify_event_job_assigned', document.getElementById('eventJobAssigned').checked);
    await saveSetting('notify_event_pickup', document.getElementById('eventPickup').checked);
    await saveSetting('notify_event_delivered', document.getElementById('eventDelivered').checked);
    await saveSetting('notify_event_cancelled', document.getElementById('eventCancelled').checked);
    await logAudit('Updated notification settings', 'Settings');
    showMsg('notificationsMsg', 'success', 'Notification preferences saved.');
    loadAppSettings();
}

async function saveAppearance() {
    await saveSetting('timezone', document.getElementById('timezone').value.trim());
    await saveSetting('currency', document.getElementById('currency').value.trim());
    await saveSetting('date_format', document.getElementById('dateFormat').value);
    await saveSetting('distance_unit', document.getElementById('distanceUnit').value);
    await logAudit('Updated appearance settings', 'Settings');
    showMsg('appearanceMsg', 'success', 'Appearance settings saved.');
    loadAppSettings();
}

async function saveIntegrations() {
    const fields = {
        google_maps_api_key: document.getElementById('googleMapsKey').value.trim(),
        sms_provider: document.getElementById('smsProvider').value.trim(),
        sms_api_key: document.getElementById('smsApiKey').value.trim(),
        smtp_host: document.getElementById('smtpHost').value.trim(),
        smtp_port: document.getElementById('smtpPort').value.trim(),
        smtp_username: document.getElementById('smtpUsername').value.trim(),
        smtp_password: document.getElementById('smtpPassword').value.trim(),
        payment_gateway_provider: document.getElementById('paymentProvider').value.trim(),
        payment_gateway_api_key: document.getElementById('paymentApiKey').value.trim(),
    };
    for (const key of Object.keys(fields)) {
        await supabase.from('integration_settings').update({ value: fields[key] || null }).eq('key', key);
    }
    await logAudit('Updated integration credentials', 'Settings');
    showMsg('integrationsMsg', 'success', 'Integration settings saved.');
    loadAll();
}

function renderStaffAccounts() {
    const el = document.getElementById('staffAccountsList');
    if (!staffAccounts.length) { el.innerHTML = '<div class="empty">No admin accounts found.</div>'; return; }

    el.innerHTML = staffAccounts.map(function (a) {
        return '<div class="kv-row"><span>' + escapeHtml(a.full_name || a.email || a.id) + '</span>' +
            '<span><select class="field-plain" style="width:auto; display:inline-block;" data-admin="' + a.id + '">' +
                ROLES.map(function (r) { return '<option value="' + r + '"' + (a.staff_role === r ? ' selected' : '') + '>' + ROLE_LABELS[r] + '</option>'; }).join('') +
            '</select></span></div>';
    }).join('');

    el.querySelectorAll('select[data-admin]').forEach(function (sel) {
        sel.addEventListener('change', function () { setStaffRole(sel.dataset.admin, sel.value); });
    });
}

async function setStaffRole(adminId, role) {
    const { error } = await supabase.from('profiles').update({ staff_role: role }).eq('id', adminId);
    if (error) { alert('Failed to update: ' + error.message); return; }
    await logAudit('Set staff role to ' + ROLE_LABELS[role] + ' (' + adminId.slice(0, 8) + ')', 'Settings');
    loadAll();
}

function renderPermTable() {
    const wrap = document.getElementById('permTableWrap');
    wrap.innerHTML =
        '<table class="simple-table perm-table"><thead><tr><th>Module</th><th>View</th><th>Create</th><th>Edit</th><th>Delete</th><th>Export</th></tr></thead><tbody>' +
        MODULES.map(function (m) {
            const existing = rolePermissions.find(function (p) { return p.role === currentPermRole && p.module === m; });
            const perm = existing || { can_view: currentPermRole === 'super_admin', can_create: currentPermRole === 'super_admin', can_edit: currentPermRole === 'super_admin', can_delete: currentPermRole === 'super_admin', can_export: currentPermRole === 'super_admin' };
            return '<tr data-module="' + m + '"><td>' + m + '</td>' +
                ['can_view', 'can_create', 'can_edit', 'can_delete', 'can_export'].map(function (f) {
                    return '<td><input type="checkbox" data-field="' + f + '" ' + (perm[f] ? 'checked' : '') + '></td>';
                }).join('') +
                '</tr>';
        }).join('') +
        '</tbody></table>';
}

async function savePermissions() {
    const rows = document.querySelectorAll('#permTableWrap tr[data-module]');
    for (const row of rows) {
        const module = row.dataset.module;
        const fields = { role: currentPermRole, module: module };
        row.querySelectorAll('input[data-field]').forEach(function (input) { fields[input.dataset.field] = input.checked; });
        await supabase.from('role_permissions').upsert(fields, { onConflict: 'role,module' });
    }
    await logAudit('Updated permissions for ' + ROLE_LABELS[currentPermRole], 'Settings');
    alert('Permissions saved for ' + ROLE_LABELS[currentPermRole] + '.');
    loadAll();
}

function populateAuditModuleFilter() {
    const sel = document.getElementById('auditModuleFilter');
    sel.innerHTML = '<option value="">All modules</option>' + MODULES.concat(['Settings']).map(function (m) {
        return '<option value="' + m + '">' + m + '</option>';
    }).join('');
}

function renderAuditLogs() {
    const wrap = document.getElementById('auditTableWrap');
    const q = document.getElementById('auditSearch').value.trim().toLowerCase();
    const moduleFilter = document.getElementById('auditModuleFilter').value;

    let rows = auditLogs;
    if (moduleFilter) rows = rows.filter(function (l) { return l.module === moduleFilter; });
    if (q) rows = rows.filter(function (l) { return ((l.admin_name || '') + ' ' + l.action + ' ' + l.module).toLowerCase().indexOf(q) !== -1; });

    if (!rows.length) { wrap.innerHTML = '<div class="empty">No audit log entries yet.</div>'; return; }

    wrap.innerHTML =
        '<table class="simple-table"><thead><tr><th>User</th><th>Action</th><th>Module</th><th>Date</th><th>Time</th></tr></thead><tbody>' +
        rows.map(function (l) {
            const dt = new Date(l.created_at);
            return '<tr><td>' + escapeHtml(l.admin_name || '—') + '</td><td>' + escapeHtml(l.action) + '</td>' +
                '<td>' + escapeHtml(l.module) + '</td><td>' + dt.toLocaleDateString('en-ZA') + '</td><td>' + dt.toLocaleTimeString('en-ZA') + '</td></tr>';
        }).join('') +
        '</tbody></table>';
}
