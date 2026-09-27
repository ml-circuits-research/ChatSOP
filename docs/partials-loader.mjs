async function loadPartials() {
  await Promise.all([...document.querySelectorAll('[data-include]')].map(async (slot) => {
    const response = await fetch(slot.dataset.include);
    if (!response.ok) throw new Error(`Cannot load ${slot.dataset.include}`);
    slot.innerHTML = await response.text();
    if (slot.dataset.linkBase) {
      const base = new URL(slot.dataset.linkBase, document.baseURI);
      for (const link of slot.querySelectorAll('a[href]')) {
        link.href = new URL(link.getAttribute('href'), base).href;
      }
    }
  }));
  const menus = [...document.querySelectorAll('.menu')];
  function close(menu, restoreFocus = false) {
    menu.classList.remove('menu--open');
    const trigger = menu.querySelector('.menu__trigger');
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  }
  for (const menu of menus) {
    const trigger = menu.querySelector('.menu__trigger');
    trigger.addEventListener('click', () => {
      const opening = !menu.classList.contains('menu--open');
      for (const other of menus) if (other !== menu) close(other);
      menu.classList.toggle('menu--open', opening);
      trigger.setAttribute('aria-expanded', String(opening));
    });
  }
  document.addEventListener('pointerdown', (event) => {
    for (const menu of menus) if (menu.classList.contains('menu--open') && !menu.contains(event.target)) close(menu);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') for (const menu of menus) if (menu.classList.contains('menu--open')) close(menu, true);
  });
}
loadPartials().catch((error) => console.error(error));
