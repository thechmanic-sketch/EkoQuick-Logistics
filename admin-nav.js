// Adds a hamburger toggle for the admin sidebar's nav on mobile — below
// 960px admin.css hides .cmd-nav entirely with no way to bring it back, so
// admins on a phone/tablet had no navigation at all besides the current
// page. This just wires a button to toggle .cmd-nav's visibility; the
// actual menu links already exist in the markup.
document.addEventListener('DOMContentLoaded', function () {
    const sidebar = document.querySelector('.cmd-sidebar');
    const brand = document.querySelector('.cmd-brand');
    const nav = document.querySelector('.cmd-nav');
    if (!sidebar || !brand || !nav) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cmd-hamburger';
    btn.id = 'cmdHamburgerBtn';
    btn.setAttribute('aria-label', 'Menu');
    btn.innerHTML = '<span class="cmd-hamburger-lines"></span>';
    sidebar.insertBefore(btn, brand);

    btn.addEventListener('click', function () {
        nav.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
        if (window.innerWidth > 960) return;
        if (!nav.contains(e.target) && !btn.contains(e.target)) nav.classList.remove('open');
    });
});
