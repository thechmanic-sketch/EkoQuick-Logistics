document.addEventListener('DOMContentLoaded', function () {
    // Password visibility toggles — any button.field-toggle flips the
    // type of the input inside the same .field wrapper.
    document.querySelectorAll('.field-toggle').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var input = btn.closest('.field').querySelector('input');
            if (!input) return;
            var isHidden = input.type === 'password';
            input.type = isHidden ? 'text' : 'password';
            btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
        });
    });

    // Role tile selection on the login screen (customer stays inline,
    // admin/driver tiles are plain links so this only matters for the
    // customer tile, which is a <button>).
    var customerTile = document.querySelector('.role-tile[data-role="customer"]');
    if (customerTile) {
        customerTile.addEventListener('click', function () {
            document.querySelectorAll('.role-tile').forEach(function (t) {
                t.classList.remove('role-tile-selected');
            });
            customerTile.classList.add('role-tile-selected');
        });
    }

    var vehicleSelect = document.getElementById('vehicleClass');
    if (vehicleSelect && typeof VEHICLES !== 'undefined') {
        VEHICLES.forEach(function (v) {
            var opt = document.createElement('option');
            opt.value = v.id;
            opt.textContent = v.icon + ' ' + v.label;
            vehicleSelect.appendChild(opt);
        });
    }

    wireCustomerLogin();
    wireAdminLogin();
    wireDriverLogin();
    wireSignup();
    wireDriverSignup();
    wireForgotPassword();
    wireResetPassword();
});

function fieldValue(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
}

function showFormError(form, message) {
    var existing = form.querySelector('.form-error');
    if (existing) existing.remove();
    var div = document.createElement('div');
    div.className = 'msg error form-error';
    div.textContent = message;
    form.appendChild(div);
}

function setBusy(button, busyText, originalText) {
    button.disabled = !!busyText;
    button.textContent = busyText || originalText;
}

async function loginWithUsername(username, password) {
    var { data: email, error } = await supabase.rpc('get_email_by_username', { uname: username });
    if (error || !email) return { error: { message: 'Invalid username or password' } };
    return supabase.auth.signInWithPassword({ email: email, password: password });
}

function wireCustomerLogin() {
    var form = document.getElementById('customerLoginForm');
    if (!form) return;
    var btn = form.querySelector('button[type="submit"]');
    var btnText = btn.textContent;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var username = fieldValue('username');
        var password = fieldValue('password');
        if (!username || !password) { showFormError(form, 'Please fill in all fields'); return; }

        setBusy(btn, 'Logging in...');
        try {
            var { data, error } = await loginWithUsername(username, password);
            if (error) { showFormError(form, error.message); return; }

            var profile = await getProfile(data.user.id);
            if (!profile || profile.role !== 'customer') {
                await supabase.auth.signOut();
                showFormError(form, 'This account is not a customer account.');
                return;
            }
            if (profile.account_status !== 'active') {
                await supabase.auth.signOut();
                showFormError(form, profile.account_status === 'banned' ? 'This account has been blocked.' : 'This account is currently paused.');
                return;
            }
            window.location.href = 'dashboard.html';
        } catch (err) {
            showFormError(form, 'Something went wrong: ' + (err && err.message ? err.message : err));
        } finally {
            setBusy(btn, null, btnText);
        }
    });
}

function wireAdminLogin() {
    var form = document.getElementById('adminLoginForm');
    if (!form) return;
    var btn = form.querySelector('button[type="submit"]');
    var btnText = btn.textContent;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var username = fieldValue('username');
        var password = fieldValue('password');
        if (!username || !password) { showFormError(form, 'Please fill in all fields'); return; }

        setBusy(btn, 'Logging in...');
        try {
            var { data, error } = await loginWithUsername(username, password);
            if (error) { showFormError(form, error.message); return; }

            var profile = await getProfile(data.user.id);
            if (!profile || profile.role !== 'admin') {
                await supabase.auth.signOut();
                showFormError(form, 'This account is not an admin account.');
                return;
            }
            window.location.href = 'admin-dashboard.html';
        } catch (err) {
            showFormError(form, 'Something went wrong: ' + (err && err.message ? err.message : err));
        } finally {
            setBusy(btn, null, btnText);
        }
    });
}

function wireDriverLogin() {
    var form = document.getElementById('driverLoginForm');
    if (!form) return;
    var btn = form.querySelector('button[type="submit"]');
    var btnText = btn.textContent;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var driverId = fieldValue('driverId');
        var password = fieldValue('password');
        if (!driverId || !password) { showFormError(form, 'Please fill in all fields'); return; }

        setBusy(btn, 'Logging in...');
        try {
            var { data, error } = await loginWithUsername(driverId, password);
            if (error) { showFormError(form, error.message); return; }

            var profile = await getProfile(data.user.id);
            if (!profile || profile.role !== 'driver') {
                await supabase.auth.signOut();
                showFormError(form, 'This account is not a driver account.');
                return;
            }
            if (profile.account_status !== 'active') {
                await supabase.auth.signOut();
                showFormError(form, profile.account_status === 'banned' ? 'This account has been banned.' : 'This account is currently paused.');
                return;
            }
            window.location.href = 'driver-dashboard.html';
        } catch (err) {
            showFormError(form, 'Something went wrong: ' + (err && err.message ? err.message : err));
        } finally {
            setBusy(btn, null, btnText);
        }
    });
}

function wireSignup() {
    var form = document.getElementById('signupForm');
    if (!form) return;
    var btn = form.querySelector('button[type="submit"]');
    var btnText = btn.textContent;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var fullName = fieldValue('fullName');
        var username = fieldValue('username');
        var email = fieldValue('email');
        var password = fieldValue('password');
        var confirmPassword = fieldValue('confirmPassword');

        if (!fullName || !username || !email || !password) { showFormError(form, 'Please fill in all fields'); return; }
        if (password !== confirmPassword) { showFormError(form, 'Passwords do not match'); return; }
        if (password.length < 6) { showFormError(form, 'Password must be at least 6 characters'); return; }

        await loadAppSettings();
        if (appSetting('customer_registration_enabled', 'true') === 'false') {
            showFormError(form, 'New customer registrations are temporarily closed. Please try again later.');
            return;
        }

        setBusy(btn, 'Creating account...');
        try {
            var { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: { data: { role: 'customer', full_name: fullName, username: username } },
            });
            if (error) { showFormError(form, error.message); return; }
            await recordReferralIfAny(data.user ? data.user.id : null, 'customer');
            window.location.href = 'signup-success.html';
        } catch (err) {
            showFormError(form, 'Something went wrong: ' + (err && err.message ? err.message : err));
        } finally {
            setBusy(btn, null, btnText);
        }
    });
}

async function recordReferralIfAny(newUserId, role) {
    if (!newUserId) return;
    var refCode = new URLSearchParams(window.location.search).get('ref');
    if (!refCode) return;
    try {
        var { data: referrer } = await supabase.from('profiles').select('id').eq('referral_code', refCode).single();
        if (referrer) {
            await supabase.from('referrals').insert({ referrer_id: referrer.id, referred_id: newUserId, referred_role: role });
        }
    } catch (err) { /* best-effort — never block signup on referral tracking */ }
}

function wireDriverSignup() {
    var form = document.getElementById('driverSignupForm');
    if (!form) return;
    var btn = form.querySelector('button[type="submit"]');
    var btnText = btn.textContent;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var fullName = fieldValue('fullName');
        var driverId = fieldValue('driverId');
        var email = fieldValue('email');
        var phone = fieldValue('phone');
        var vehicleClass = fieldValue('vehicleClass');
        var password = fieldValue('password');
        var confirmPassword = fieldValue('confirmPassword');

        if (!fullName || !driverId || !email || !phone || !vehicleClass || !password) { showFormError(form, 'Please fill in all fields'); return; }
        if (password !== confirmPassword) { showFormError(form, 'Passwords do not match'); return; }
        if (password.length < 6) { showFormError(form, 'Password must be at least 6 characters'); return; }

        await loadAppSettings();
        if (appSetting('driver_registration_enabled', 'true') === 'false') {
            showFormError(form, 'New driver registrations are temporarily closed. Please try again later.');
            return;
        }

        setBusy(btn, 'Creating account...');
        try {
            var { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: { data: { role: 'driver', full_name: fullName, username: driverId, phone: phone, vehicle_class: vehicleClass } },
            });
            if (error) { showFormError(form, error.message); return; }

            if (appSetting('driver_manual_approval', 'true') === 'false' && data.session) {
                await supabase.from('profiles').update({ verification_status: 'approved' }).eq('id', data.user.id);
            }
            await recordReferralIfAny(data.user ? data.user.id : null, 'driver');

            window.location.href = 'signup-success.html';
        } catch (err) {
            showFormError(form, 'Something went wrong: ' + (err && err.message ? err.message : err));
        } finally {
            setBusy(btn, null, btnText);
        }
    });
}

function wireForgotPassword() {
    var form = document.getElementById('forgotPasswordForm');
    if (!form) return;
    var btn = form.querySelector('button[type="submit"]');
    var btnText = btn.textContent;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var username = fieldValue('username');
        if (!username) { showFormError(form, 'Please enter your username'); return; }

        setBusy(btn, 'Sending...');
        try {
            var { data: email, error } = await supabase.rpc('get_email_by_username', { uname: username });
            if (error || !email) {
                showFormError(form, 'No account found for that username');
                return;
            }
            var { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin + window.location.pathname.replace('forgot-password.html', 'reset-password.html'),
            });
            if (resetError) { showFormError(form, resetError.message); return; }
            window.location.href = 'reset-link-sent.html';
        } catch (err) {
            showFormError(form, 'Something went wrong: ' + (err && err.message ? err.message : err));
        } finally {
            setBusy(btn, null, btnText);
        }
    });
}

function wireResetPassword() {
    var form = document.getElementById('resetPasswordForm');
    if (!form) return;
    var btn = form.querySelector('button[type="submit"]');
    var btnText = btn.textContent;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var newPassword = fieldValue('newPassword');
        var confirmNewPassword = fieldValue('confirmNewPassword');
        if (!newPassword || newPassword !== confirmNewPassword) { showFormError(form, 'Passwords do not match'); return; }
        if (newPassword.length < 6) { showFormError(form, 'Password must be at least 6 characters'); return; }

        setBusy(btn, 'Saving...');
        try {
            var { error } = await supabase.auth.updateUser({ password: newPassword });
            if (error) { showFormError(form, error.message); return; }
            window.location.href = 'login.html';
        } catch (err) {
            showFormError(form, 'Something went wrong: ' + (err && err.message ? err.message : err));
        } finally {
            setBusy(btn, null, btnText);
        }
    });
}
