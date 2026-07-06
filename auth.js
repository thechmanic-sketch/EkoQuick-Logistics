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

    // Forms not yet wired to Supabase: prevent the real submit, and if
    // the form has data-redirect, simulate success by navigating there.
    document.querySelectorAll('form[data-redirect]').forEach(function (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            window.location.href = form.getAttribute('data-redirect');
        });
    });

    document.querySelectorAll('form:not([data-redirect])').forEach(function (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            alert('Not wired up yet.');
        });
    });
});
