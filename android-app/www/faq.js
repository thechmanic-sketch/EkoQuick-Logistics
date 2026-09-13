let activeCat = 'all';

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('faqSearch').addEventListener('input', applyFilter);
    document.querySelectorAll('.faq-cat-btn').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.faq-cat-btn').forEach(function (b) { b.classList.remove('active'); });
            btn.classList.add('active');
            activeCat = btn.dataset.cat;
            applyFilter();
        });
    });
});

function applyFilter() {
    const query = document.getElementById('faqSearch').value.trim().toLowerCase();
    let anyVisible = false;

    document.querySelectorAll('.faq-category').forEach(function (cat) {
        const catMatches = activeCat === 'all' || cat.dataset.cat === activeCat;
        let categoryHasVisibleItem = false;

        cat.querySelectorAll('.faq-item').forEach(function (item) {
            const text = item.textContent.toLowerCase();
            const searchMatches = !query || text.indexOf(query) !== -1;
            const visible = catMatches && searchMatches;
            item.classList.toggle('hide', !visible);
            if (visible) { categoryHasVisibleItem = true; anyVisible = true; }
        });

        cat.classList.toggle('hide', !categoryHasVisibleItem);
    });

    document.getElementById('faqEmpty').classList.toggle('show', !anyVisible);
}
