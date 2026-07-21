// Adds a hamburger menu to every logged-in app page's .navbar (customer and
// driver — admin already has its own persistent sidebar nav). Injected via
// JS rather than duplicated in every HTML file so the link list only has
// to be maintained in one place.
(function () {
    document.addEventListener('DOMContentLoaded', function () {
        const navbar = document.querySelector('.navbar');
        if (!navbar) return;
        const brand = navbar.querySelector('.brand');
        if (!brand) return;

        const page = (location.pathname.split('/').pop() || '').toLowerCase();
        const isDriver = page.indexOf('driver-') === 0;

        const customerLinks = [
            ['dashboard.html', 'Dashboard'],
            ['new-delivery.html', 'New Delivery'],
            ['my-orders.html', 'My Orders'],
            ['saved-addresses.html', 'Saved Addresses'],
            ['payments.html', 'Payments'],
            ['chat-list.html', 'Messages'],
            ['reviews.html', 'Reviews'],
            ['notifications.html', 'Notifications'],
            ['support.html', 'Support'],
            ['profile-settings.html', 'Profile & Settings'],
        ];
        const driverLinks = [
            ['driver-dashboard.html', 'Dashboard'],
            ['driver-available-jobs.html', 'Available Jobs'],
            ['driver-active-deliveries.html', 'Active Deliveries'],
            ['driver-history.html', 'History'],
            ['driver-earnings.html', 'Earnings'],
            ['driver-expenses.html', 'Expenses'],
            ['driver-shift.html', 'Shift'],
            ['driver-vehicle.html', 'Vehicle'],
            ['driver-documents.html', 'Documents'],
            ['driver-reviews.html', 'Reviews'],
            ['driver-referrals.html', 'Referrals'],
            ['driver-messages.html', 'Messages'],
            ['driver-notifications.html', 'Notifications'],
            ['driver-support.html', 'Support'],
        ];
        const links = isDriver ? driverLinks : customerLinks;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'app-hamburger';
        btn.id = 'appHamburgerBtn';
        btn.setAttribute('aria-label', 'Menu');
        btn.innerHTML = '<span class="app-hamburger-lines"></span>';

        // Group the hamburger with the brand so the navbar keeps its
        // existing two-cluster (left / right) space-between layout instead
        // of splitting unevenly across three flex children.
        const leftWrap = document.createElement('div');
        leftWrap.style.display = 'flex';
        leftWrap.style.alignItems = 'center';
        navbar.insertBefore(leftWrap, brand);
        leftWrap.appendChild(btn);
        leftWrap.appendChild(brand);

        const panel = document.createElement('div');
        panel.className = 'app-mobile-menu';
        panel.id = 'appMobileMenu';
        panel.innerHTML = links.map(function (l) {
            const active = page === l[0];
            return '<a href="' + l[0] + '"' + (active ? ' class="active"' : '') + '>' + l[1] + '</a>';
        }).join('');
        navbar.insertAdjacentElement('afterend', panel);

        btn.addEventListener('click', function () {
            panel.classList.toggle('open');
        });
        document.addEventListener('click', function (e) {
            if (!panel.contains(e.target) && !btn.contains(e.target)) panel.classList.remove('open');
        });
    });
})();
