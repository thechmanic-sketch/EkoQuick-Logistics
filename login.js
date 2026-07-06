document.addEventListener('DOMContentLoaded', function () {
    var toggleBtn = document.getElementById('togglePassword');
    var passwordInput = document.getElementById('password');

    if (toggleBtn && passwordInput) {
        toggleBtn.addEventListener('click', function () {
            var isHidden = passwordInput.type === 'password';
            passwordInput.type = isHidden ? 'text' : 'password';
            toggleBtn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
        });
    }

    var customerTile = document.querySelector('.role-tile[data-role="customer"]');
    if (customerTile) {
        customerTile.addEventListener('click', function () {
            document.querySelectorAll('.role-tile').forEach(function (t) {
                t.classList.remove('role-tile-selected');
            });
            customerTile.classList.add('role-tile-selected');
        });
    }

    var form = document.getElementById('customerLoginForm');
    if (form) {
        form.addEventListener('submit', function (e) {
            e.preventDefault();
            // Wire up to Supabase auth in a later pass.
            alert('Customer login is not wired up yet.');
        });
    }
});
