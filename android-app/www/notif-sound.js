// Shared notification beep — synthesized via the Web Audio API so no audio
// file needs to be hosted. Respects each user's profiles.notif_sound
// preference (set on the Notifications & Preferences page).
const NotifSound = (function () {
    let enabled = true;
    let audioCtx = null;

    function ensureCtx() {
        if (!audioCtx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            audioCtx = new AC();
        }
        return audioCtx;
    }

    function play() {
        if (!enabled) return;
        const ctx = ensureCtx();
        if (!ctx) return;
        // Browsers suspend AudioContext until a user gesture has occurred
        // on the page — if this fires before any click, resume() silently
        // fails and there's just no sound that one time; it works from
        // then on since normal page interaction (opening the bell, etc.)
        // counts as a gesture.
        if (ctx.state === 'suspended') ctx.resume().catch(function () {});
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.28);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    }

    async function loadPreference(userId) {
        if (!userId || typeof supabase === 'undefined') return;
        try {
            const { data } = await supabase.from('profiles').select('notif_sound').eq('id', userId).maybeSingle();
            enabled = !data || data.notif_sound !== false;
        } catch (err) { /* default to enabled */ }
    }

    return { play: play, loadPreference: loadPreference, setEnabled: function (v) { enabled = v; } };
})();
