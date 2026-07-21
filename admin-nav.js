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

    // A dedicated Home link right under the brand — always visible without
    // scrolling, since it was previously appended at the very bottom of a
    // 20+ item nav list and effectively unfindable. Opens in a new tab so
    // the admin session in this tab is never touched by navigating away.
    const homeLink = document.createElement('a');
    homeLink.href = 'index.html';
    homeLink.target = '_blank';
    homeLink.rel = 'noopener';
    homeLink.className = 'cmd-home-link';
    homeLink.textContent = '🏠 Home ↗';
    brand.insertAdjacentElement('afterend', homeLink);

    // Same public reference pages as the homepage's own menu, appended
    // after admin's own nav — so admin can still check a public page
    // (tariff, coverage, etc.) without leaving the logged-in tab.
    const referenceLinks = [
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
    sectionHeader.textContent = 'Site (opens in new tab)';
    nav.appendChild(sectionHeader);
    referenceLinks.forEach(function (l) {
        const a = document.createElement('a');
        a.href = l[0];
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = l[1] + ' ↗';
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
