document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('contactForm').addEventListener('submit', submitContactForm);
});

async function submitContactForm(e) {
    e.preventDefault();
    const msgEl = document.getElementById('contactMsg');
    msgEl.textContent = '';
    msgEl.className = 'contact-msg';

    const name = document.getElementById('cName').value.trim();
    const email = document.getElementById('cEmail').value.trim();
    const phone = document.getElementById('cPhone').value.trim();
    const subject = document.getElementById('cSubject').value.trim();
    const message = document.getElementById('cMessage').value.trim();

    if (!name || !email || !subject || !message) {
        msgEl.textContent = 'Please fill in your name, email, subject, and message.';
        msgEl.classList.add('error');
        return;
    }

    const btn = document.querySelector('.contact-submit');
    btn.disabled = true;
    btn.textContent = 'Sending...';

    const { error } = await supabase.from('contact_messages').insert({
        name: name,
        email: email,
        phone: phone || null,
        subject: subject,
        message: message,
    });

    btn.disabled = false;
    btn.textContent = 'Send';

    if (error) {
        msgEl.textContent = 'Something went wrong sending your message — please try WhatsApp instead.';
        msgEl.classList.add('error');
        return;
    }

    msgEl.textContent = "Message sent — we'll get back to you soon.";
    msgEl.classList.add('success');
    document.getElementById('contactForm').reset();
}
