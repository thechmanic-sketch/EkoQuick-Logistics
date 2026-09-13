// A Supabase session persists in localStorage across every page on this
// origin — navigating from an app page (dashboard, driver-dashboard,
// admin-dashboard) back to a public page like Home does NOT log you out.
// But the public nav still shows "Login / Book now" regardless, which
// makes it look like the session was lost. This checks for an active
// session on load and swaps those buttons for a direct link back to the
// right dashboard for that user's role.
document.addEventListener('DOMContentLoaded', async function () {
    if (typeof supabase === 'undefined') return;
    const { data } = await supabase.auth.getSession();
    if (!data || !data.session) return;

    const { data: profile } = await supabase.from('profiles').select('role').eq('id', data.session.user.id).maybeSingle();
    const role = profile && profile.role;
    const dashboardHref = role === 'admin' ? 'admin-dashboard.html' : role === 'driver' ? 'driver-dashboard.html' : 'dashboard.html';

    document.querySelectorAll('.nav-cta-group, .nav-mobile-ctas').forEach(function (group) {
        group.innerHTML = '<a class="btn btn-primary btn-sm" href="' + dashboardHref + '" style="flex:1;">Back to Dashboard</a>';
    });
});
