document.addEventListener('DOMContentLoaded', () => {
  const toggles = document.querySelectorAll('.menu-toggle');

  toggles.forEach((toggle) => {
    const menuId = toggle.getAttribute('aria-controls');
    const menu = menuId ? document.getElementById(menuId) : null;

    if (!menu) return;

    const setOpen = (isOpen) => {
      toggle.setAttribute('aria-expanded', String(isOpen));
      menu.classList.toggle('is-open', isOpen);
    };

    toggle.addEventListener('click', (event) => {
      event.stopPropagation();
      setOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    menu.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => setOpen(false));
    });

    document.addEventListener('click', (event) => {
      if (!toggle.contains(event.target) && !menu.contains(event.target)) {
        setOpen(false);
      }
    });
  });
});
