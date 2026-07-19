let selectedRating = 0;
let jobId = null;
let currentUser = null;
const CATEGORY_FIELDS = [
    ['rating_professionalism', 'Driver Professionalism'],
    ['rating_communication', 'Communication'],
    ['rating_speed', 'Delivery Speed'],
    ['rating_parcel_condition', 'Parcel Condition'],
];
let categorySelections = {};

document.addEventListener('DOMContentLoaded', async function () {
    currentUser = await requireSession('login.html');
    if (!currentUser) return;

    jobId = new URLSearchParams(window.location.search).get('job');
    if (!jobId) { window.location.href = 'dashboard.html'; return; }

    document.getElementById('categoryRatings').innerHTML = CATEGORY_FIELDS.map(function (f) {
        return '<div style="margin-bottom:8px;"><div class="meta">' + f[1] + '</div>' +
            '<div class="star-rating" data-field="' + f[0] + '">' +
            [1, 2, 3, 4, 5].map(function (n) { return '<span class="star" data-value="' + n + '">★</span>'; }).join('') +
            '</div></div>';
    }).join('');

    document.querySelectorAll('#categoryRatings .star-rating').forEach(function (group) {
        const field = group.dataset.field;
        group.querySelectorAll('.star').forEach(function (star) {
            star.addEventListener('click', function () {
                categorySelections[field] = parseInt(star.dataset.value, 10);
                group.querySelectorAll('.star').forEach(function (s) {
                    s.classList.toggle('filled', parseInt(s.dataset.value, 10) <= categorySelections[field]);
                });
            });
        });
    });

    const { data: job } = await supabase.from('jobs').select('*').eq('id', jobId).eq('customer_id', currentUser.id).single();
    if (job && job.rating) {
        selectedRating = job.rating;
        document.querySelectorAll('#starRating .star').forEach(function (s) {
            s.classList.toggle('filled', parseInt(s.dataset.value, 10) <= selectedRating);
        });
        document.getElementById('comment').value = job.rating_comment || '';
        CATEGORY_FIELDS.forEach(function (f) {
            if (job[f[0]]) {
                categorySelections[f[0]] = job[f[0]];
                document.querySelector('#categoryRatings .star-rating[data-field="' + f[0] + '"]').querySelectorAll('.star').forEach(function (s) {
                    s.classList.toggle('filled', parseInt(s.dataset.value, 10) <= job[f[0]]);
                });
            }
        });
        document.getElementById('submitRating').textContent = 'Update Review';
    }

    const stars = document.querySelectorAll('#starRating .star');
    stars.forEach(function (star) {
        star.addEventListener('click', function () {
            selectedRating = parseInt(star.dataset.value, 10);
            stars.forEach(function (s) {
                s.classList.toggle('filled', parseInt(s.dataset.value, 10) <= selectedRating);
            });
        });
    });

    document.getElementById('submitRating').addEventListener('click', submitRating);
});

async function submitRating() {
    const msgArea = document.getElementById('msgArea');
    if (selectedRating === 0) {
        msgArea.innerHTML = '<div class="msg error">Please select a star rating</div>';
        return;
    }

    const { data: job } = await supabase.from('jobs').select('status, rating').eq('id', jobId).single();
    if (!job || job.status !== 'delivered') {
        msgArea.innerHTML = '<div class="msg error">Only completed deliveries can be reviewed.</div>';
        return;
    }
    const isEdit = !!job.rating;

    const btn = document.getElementById('submitRating');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    const comment = document.getElementById('comment').value.trim().slice(0, 1000);
    const fields = {
        rating: selectedRating,
        rating_comment: comment,
        rating_professionalism: categorySelections['rating_professionalism'] || null,
        rating_communication: categorySelections['rating_communication'] || null,
        rating_speed: categorySelections['rating_speed'] || null,
        rating_parcel_condition: categorySelections['rating_parcel_condition'] || null,
    };
    if (isEdit) fields.review_edited_at = new Date().toISOString();

    const fileInput = document.getElementById('reviewPhoto');
    if (fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        const path = currentUser.id + '/' + jobId + '-' + Date.now() + '.' + file.name.split('.').pop();
        const { error: uploadError } = await supabase.storage.from('review-photos').upload(path, file, { upsert: true });
        if (!uploadError) {
            const { data: pub } = supabase.storage.from('review-photos').getPublicUrl(path);
            fields.review_image_url = pub.publicUrl;
        }
    }

    const { error } = await supabase.from('jobs').update(fields).eq('id', jobId);

    btn.disabled = false;
    btn.textContent = isEdit ? 'Update Review' : 'Submit Review';

    if (error) {
        msgArea.innerHTML = '<div class="msg error">' + error.message + '</div>';
        return;
    }

    window.location.href = 'reviews.html';
}
