setTimeout(() => {
  document.querySelectorAll('.r').forEach((el) => el.classList.add('pre'));
  const obs = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) e.target.classList.add('on');
      });
    },
    { threshold: 0.05, rootMargin: '0px 0px -16px 0px' }
  );
  document.querySelectorAll('.r').forEach((el) => obs.observe(el));
}, 60);
