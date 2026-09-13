document.addEventListener('DOMContentLoaded', function () {
    wireSupplierSignup();
    wireSupplierLogin();
});

function wireSupplierLogin() {
    var form = document.getElementById('supplierLoginForm');
    if (!form) return;
    var btn = form.querySelector('button[type="submit"]');
    var btnText = btn.textContent;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var email = fieldValue('email');
        var password = fieldValue('password');
        if (!email || !password) { showFormError(form, 'Please fill in all fields'); return; }

        setBusy(btn, 'Logging in...');
        try {
            var { data, error } = await supabase.auth.signInWithPassword({ email: email, password: password });
            if (error) { showFormError(form, error.message); return; }

            var profile = await getProfile(data.user.id);
            if (!profile || profile.role !== 'supplier') {
                await supabase.auth.signOut();
                showFormError(form, 'This account is not a supplier account.');
                return;
            }
            window.location.href = 'supplier-dashboard.html';
        } catch (err) {
            showFormError(form, 'Something went wrong: ' + (err && err.message ? err.message : err));
        } finally {
            setBusy(btn, null, btnText);
        }
    });
}

function wireSupplierSignup() {
    var form = document.getElementById('supplierSignupForm');
    if (!form) return;
    var btn = form.querySelector('button[type="submit"]');
    var btnText = btn.textContent;

    form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var fullName = fieldValue('fullName');
        var businessName = fieldValue('businessName');
        var email = fieldValue('email');
        var phone = fieldValue('phone');
        var pickupAddress = fieldValue('pickupAddress');
        var bankName = fieldValue('bankName');
        var accountNumber = fieldValue('accountNumber');
        var accountHolder = fieldValue('accountHolder');
        var password = fieldValue('password');
        var confirmPassword = fieldValue('confirmPassword');
        var idDocFile = document.getElementById('idDoc').files[0];
        var bizRegFile = document.getElementById('bizRegDoc').files[0];

        if (!fullName || !businessName || !email || !phone || !pickupAddress || !bankName || !accountNumber || !accountHolder || !password) {
            showFormError(form, 'Please fill in all fields'); return;
        }
        if (!idDocFile) { showFormError(form, 'Please upload your ID document'); return; }
        if (password !== confirmPassword) { showFormError(form, 'Passwords do not match'); return; }
        if (password.length < 6) { showFormError(form, 'Password must be at least 6 characters'); return; }

        setBusy(btn, 'Creating account...');
        try {
            var { data, error } = await supabase.auth.signUp({
                email: email,
                password: password,
                options: { data: { role: 'supplier', full_name: fullName, phone: phone } },
            });
            if (error) { showFormError(form, error.message); return; }

            var userId = data.user.id;
            var idDocUrl = await uploadSupplierDoc(userId, 'id-doc', idDocFile);
            var bizRegUrl = bizRegFile ? await uploadSupplierDoc(userId, 'biz-reg', bizRegFile) : null;

            var { error: detailsError } = await supabase.from('supplier_details').insert({
                id: userId,
                business_name: businessName,
                pickup_address: pickupAddress,
                id_doc_url: idDocUrl,
                business_reg_url: bizRegUrl,
                bank_name: bankName,
                account_number: accountNumber,
                account_holder: accountHolder,
            });
            if (detailsError) { showFormError(form, detailsError.message); return; }

            window.location.href = 'signup-success.html';
        } catch (err) {
            showFormError(form, 'Something went wrong: ' + (err && err.message ? err.message : err));
        } finally {
            setBusy(btn, null, btnText);
        }
    });
}

async function uploadSupplierDoc(userId, label, file) {
    var ext = file.name.split('.').pop();
    var path = userId + '/' + label + '-' + Date.now() + '.' + ext;
    var { error } = await supabase.storage.from('supplier-docs').upload(path, file);
    if (error) throw error;
    return path;
}
