let selectedRating = 0;
let jobId = null;

document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireSession('login.html');
    if (!user) return;

    jobId = new URLSearchParams(window.location.search).get('job');
    if (!jobId) { window.location.href = 'dashboard.html'; return; }

    const stars = document.querySelectorAll('.star-rating .star');
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

    const btn = document.getElementById('submitRating');
    btn.disabled = true;
    btn.textContent = 'Submitting...';

    const comment = document.getElementById('comment').value.trim();
    const { error } = await supabase.from('jobs').update({
        rating: selectedRating,
        rating_comment: comment,
    }).eq('id', jobId);

    btn.disabled = false;
    btn.textContent = 'Submit Rating';

    if (error) {
        msgArea.innerHTML = '<div class="msg error">' + error.message + '</div>';
        return;
    }

    window.location.href = 'dashboard.html';
}
