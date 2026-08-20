// Header shadow on scroll
const header = document.getElementById('siteHeader');
if (header) {
  addEventListener('scroll', () => {
    header.classList.toggle('is-scrolled', scrollY > 8);
  }, { passive: true });
}

// FAQ accordion
document.querySelectorAll('.faq-item').forEach(item => {
  const btn = item.querySelector('.faq-q');
  const answer = item.querySelector('.faq-a');
  btn.addEventListener('click', () => {
    const isOpen = item.classList.contains('open');
    document.querySelectorAll('.faq-item.open').forEach(other => {
      other.classList.remove('open');
      other.querySelector('.faq-a').style.maxHeight = null;
    });
    if (!isOpen) {
      item.classList.add('open');
      answer.style.maxHeight = answer.scrollHeight + 'px';
    }
  });
});

// Reveal on scroll
const io = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('in');
      io.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// Mobile menu
const toggle = document.getElementById('navToggle');
const menu = document.getElementById('mobileMenu');
if (toggle && menu) {
  toggle.addEventListener('click', () => menu.classList.toggle('open'));
  menu.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => menu.classList.remove('open'))
  );
}

// Demo modal
const modal = document.getElementById('demoModal');
if (modal) {
  document.querySelectorAll('[data-demo]').forEach(btn =>
    btn.addEventListener('click', e => {
      e.preventDefault();
      modal.classList.add('open');
      document.body.style.overflow = 'hidden';
    })
  );
  const close = () => {
    modal.classList.remove('open', 'playing');
    document.body.style.overflow = '';
  };
  modal.querySelector('.modal-close').addEventListener('click', close);
  modal.querySelector('.modal-backdrop').addEventListener('click', close);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modal.classList.contains('open')) close();
  });
  const chapters = [
    'Connect or buy warmed-up domains',
    'Pull leads from the 1B+ database',
    'Mix email and LinkedIn in one sequence',
    'Watch replies land in one inbox'
  ];
  let chapterTimer;
  modal.querySelector('.demo-play').addEventListener('click', function () {
    modal.classList.add('playing');
    this.innerHTML = '<svg width="26" height="26" viewBox="0 0 26 26" fill="currentColor"><rect x="6" y="5" width="5" height="16" rx="1.5"/><rect x="15" y="5" width="5" height="16" rx="1.5"/></svg>';
    const live = modal.querySelector('.demo-live');
    let i = 0;
    live.textContent = chapters[0];
    clearInterval(chapterTimer);
    chapterTimer = setInterval(() => {
      i = (i + 1) % chapters.length;
      live.textContent = chapters[i];
    }, 6000);
  });
}

// Pricing toggle
const billToggle = document.getElementById('billToggle');
if (billToggle) {
  billToggle.querySelectorAll('button').forEach(btn => {
    btn.addEventListener('click', () => {
      billToggle.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      document.querySelectorAll('[data-monthly]').forEach(el => {
        el.textContent = mode === 'yearly' ? el.dataset.yearly : el.dataset.monthly;
      });
    });
  });
}

// Form validation + API (signup / login)
document.querySelectorAll('form[id$="Form"]').forEach(form => {
  const success = document.getElementById(form.id.replace('Form', 'Success'));
  const endpoint = form.id === 'signupForm' ? '/api/signup' : '/api/login';

  // Shared spot for server-side errors, created once above the submit button
  const serverErr = document.createElement('p');
  serverErr.style.cssText = 'display:none;color:#d93025;font-size:0.85rem;font-weight:600;margin:0 0 14px;';
  form.querySelector('button[type="submit"]').before(serverErr);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    let valid = true;
    serverErr.style.display = 'none';

    form.querySelectorAll('.field input').forEach(input => {
      const field = input.closest('.field');
      let ok = input.value.trim().length > 0;
      if (input.type === 'email') ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
      if (input.type === 'password' && form.id === 'signupForm') ok = input.value.length >= 8;
      field.classList.toggle('show-err', !ok);
      input.classList.toggle('invalid', !ok);
      if (!ok) valid = false;
    });

    const terms = form.querySelector('#terms');
    if (terms) {
      const wrap = document.getElementById('termsField');
      wrap.classList.toggle('show-err', !terms.checked);
      if (!terms.checked) valid = false;
    }
    if (!valid) return;

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.style.opacity = '0.65';

    const payload = Object.fromEntries(
      [...form.querySelectorAll('.field input')].map(i => [i.name, i.value.trim()])
    );

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        serverErr.textContent = data.error || 'Something went wrong — please try again.';
        serverErr.style.display = 'block';
        if (res.status === 409) {
          const emailInput = form.querySelector('#email');
          emailInput.classList.add('invalid');
          emailInput.closest('.field').classList.add('show-err');
        }
        return;
      }

      if (form.id === 'loginForm') {
        window.location.href = '/app.html';
        return;
      }

      if (success) {
        const name = data.user?.firstName || form.querySelector('#firstName')?.value.trim();
        const emailSlot = success.querySelector('#successEmail');
        if (emailSlot && data.user?.email) emailSlot.textContent = data.user.email;
        const nameSlot = success.querySelector('#successName');
        if (nameSlot && name) nameSlot.textContent = name;
        form.style.display = 'none';
        success.style.display = 'block';
      }
    } catch {
      serverErr.textContent = 'Cannot reach the server right now — please try again later.';
      serverErr.style.display = 'block';
    } finally {
      submitBtn.disabled = false;
      submitBtn.style.opacity = '';
    }
  });

  form.addEventListener('input', e => {
    const field = e.target.closest('.field');
    if (field) {
      field.classList.remove('show-err');
      e.target.classList.remove('invalid');
    }
    serverErr.style.display = 'none';
  });
});
