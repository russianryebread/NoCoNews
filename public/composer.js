for (const composer of document.querySelectorAll('[data-composer]')) {
  const textarea = composer.querySelector('textarea');
  const length = composer.querySelector('[data-length]');
  if (!textarea || !length) continue;

  const update = () => { length.textContent = String(textarea.value.length); };
  textarea.addEventListener('input', update);
  window.addEventListener('pageshow', update);
  update();
}
