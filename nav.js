document.addEventListener('DOMContentLoaded', function () {
    var dropdown = document.getElementById('companyDropdown');
    var trigger = document.getElementById('companyDropdownBtn');
    if (trigger && dropdown) {
        trigger.addEventListener('click', function (e) {
            e.stopPropagation();
            dropdown.classList.toggle('open');
        });
        document.addEventListener('click', function () { dropdown.classList.remove('open'); });
    }

    var hamburger = document.getElementById('navHamburger');
    var mobileMenu = document.getElementById('navMobileMenu');
    if (hamburger && mobileMenu) {
        hamburger.addEventListener('click', function () {
            hamburger.classList.toggle('open');
            mobileMenu.classList.toggle('open');
        });
    }
});
