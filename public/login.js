// Login / signup page logic — talks to /api/auth/*.

const $ = (id) => document.getElementById(id);
let mode = 'login'; // 'login' | 'register'

const ui = {
  title: $('authTitle'),
  subtitle: $('authSubtitle'),
  submit: $('authSubmit'),
  nameField: $('nameField'),
  pwHint: $('pwHint'),
  password: $('password'),
  error: $('authError'),
  switchText: $('switchText'),
  switchBtn: $('switchBtn'),
};

// If already signed in, go home.
fetch('/api/auth/me').then((r) => r.json()).then((d) => {
  if (d.user) location.href = '/';
}).catch(() => {});

function setMode(next) {
  mode = next;
  const register = mode === 'register';
  $('tabLogin').classList.toggle('active', !register);
  $('tabRegister').classList.toggle('active', register);
  ui.title.textContent = register ? 'Create your account' : 'Welcome back';
  ui.subtitle.textContent = register ? 'Start saving and revisiting your trips.' : 'Sign in to see your saved trips.';
  ui.submit.textContent = register ? 'Create account' : 'Sign in';
  ui.nameField.hidden = !register;
  ui.pwHint.hidden = !register;
  ui.password.setAttribute('autocomplete', register ? 'new-password' : 'current-password');
  ui.switchText.textContent = register ? 'Already have an account?' : 'New here?';
  ui.switchBtn.textContent = register ? 'Sign in instead' : 'Create an account';
  hideError();
}

function showError(msg) {
  ui.error.textContent = msg;
  ui.error.hidden = false;
}
function hideError() {
  ui.error.hidden = true;
}

$('tabLogin').addEventListener('click', () => setMode('login'));
$('tabRegister').addEventListener('click', () => setMode('register'));
ui.switchBtn.addEventListener('click', () => setMode(mode === 'login' ? 'register' : 'login'));

$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError();
  const email = $('email').value.trim();
  const password = $('password').value;
  const name = $('name').value.trim();

  if (!email || !password) return showError('Please fill in your email and password.');
  if (mode === 'register' && password.length < 8) return showError('Password must be at least 8 characters.');

  ui.submit.disabled = true;
  ui.submit.textContent = mode === 'register' ? 'Creating…' : 'Signing in…';

  try {
    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');
    location.href = '/'; // success → home, now logged in
  } catch (err) {
    showError(err.message);
    ui.submit.disabled = false;
    ui.submit.textContent = mode === 'register' ? 'Create account' : 'Sign in';
  }
});

setMode('login');
