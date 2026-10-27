(() => {
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const selectors = [
    '.intro-inner', '.section-heading > *', '.write-text', '.write-sheet',
    '.reflect-copy', '.summary-paper', '.export-tag', '.journey-card',
    '.privacy-symbol', '.privacy-heading', '.privacy-copy', '.closing > *'
  ];
  const targets = selectors.flatMap(selector => [...document.querySelectorAll(selector)]);
  let observer;

  document.querySelectorAll('.hero-copy > *').forEach((item, index) => {
    item.style.setProperty('--hero-step', index);
  });
  document.querySelectorAll('.hero-art .mock-cell:not(:empty)').forEach((item, index) => {
    item.style.setProperty('--record-step', index);
  });
  document.querySelectorAll('.section-heading > *').forEach((item, index) => {
    item.style.setProperty('--reveal-delay', `${(index % 2) * 110}ms`);
  });
  document.querySelectorAll('.closing > *').forEach((item, index) => {
    item.style.setProperty('--reveal-delay', `${index * 70}ms`);
  });
  for (const selector of ['.write-sheet .sheet-row', '.summary-paper .summary-block', '.journey-card .timeline-item']) {
    document.querySelectorAll(selector).forEach((item, index) => {
      item.style.setProperty('--detail-delay', `${index * 125 + 160}ms`);
    });
  }

  function configureMotion() {
    if (observer) observer.disconnect();
    root.classList.remove('motion-ready');
    if (reduced.matches || !('IntersectionObserver' in window)) return;
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    }, { threshold: .08, rootMargin: '0px 0px -24px 0px' });
    targets.forEach(target => {
      target.classList.add('motion-reveal');
      if (!target.classList.contains('is-visible')) observer.observe(target);
    });
    root.classList.add('motion-ready');
  }
  configureMotion();
  if (reduced.addEventListener) reduced.addEventListener('change', configureMotion);
  else if (reduced.addListener) reduced.addListener(configureMotion);
})();
