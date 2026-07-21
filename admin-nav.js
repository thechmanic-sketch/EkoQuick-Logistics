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

    // Same public reference pages as the homepage's own menu, appended
    // after admin's own nav — so admin can still get back to Home or check
    // a public page (tariff, coverage, etc.) without logging out.
    const referenceLinks = [
        ['index.html', 'Home'],
        ['services.html', 'Services'],
        ['pricing.html', 'Tariff'],
        ['track-parcel.html', 'Track'],
        ['coverage.html', 'Coverage'],
        ['how-it-works.html', 'Manifest'],
        ['about.html', 'About'],
        ['faq.html', 'FAQ'],
        ['contact.html', 'Contact'],
        ['for-business.html', 'Business'],
        ['become-a-driver.html', 'Drive'],
    ];
    const sectionHeader = document.createElement('div');
    sectionHeader.className = 'cmd-nav-section';
    sectionHeader.textContent = 'Site';
    nav.appendChild(sectionHeader);
    referenceLinks.forEach(function (l) {
        const a = document.createElement('a');
        a.href = l[0];
        a.textContent = l[1];
        nav.appendChild(a);
    });

    btn.addEventListener('click', function () {
        nav.classList.toggle('open');
    });
    document.addEventListener('click', function (e) {
        if (window.innerWidth > 960) return;
        if (!nav.contains(e.target) && !btn.contains(e.target)) nav.classList.remove('open');
    });
});
