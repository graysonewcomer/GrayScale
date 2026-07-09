// Light / dark theme toggle, persisted and shared by every page.
// Knights face off: black knight while dark, white knight while light.
const themeToggle = document.querySelector('.theme-toggle');

function syncThemeIcon() {
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  themeToggle.textContent = dark ? '♞' : '♘';
}

syncThemeIcon();
themeToggle.addEventListener('click', () => {
  const dark = document.documentElement.getAttribute('data-theme') !== 'light';
  const next = dark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('grayscale-theme', next);
  syncThemeIcon();
});
