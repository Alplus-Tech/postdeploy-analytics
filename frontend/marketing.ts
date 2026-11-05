declare global {
  interface Window { postdeploy?: { track(name: string): void } }
}

document.documentElement.classList.add('js');

document.addEventListener('click', (event: MouseEvent) => {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest<HTMLAnchorElement>('a[data-goal], a[download]');
  if (!link) return;
  window.postdeploy?.track(link.dataset.goal ?? 'source_download');
});

function offsetWithin(el: HTMLElement, root: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== root) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

function setupTour(tour: HTMLElement): void {
  const frame = tour.querySelector<HTMLElement>('.ws-frame');
  const canvas = tour.querySelector<HTMLElement>('.ws');
  const steps = Array.from(tour.querySelectorAll<HTMLElement>('[data-step]'));
  if (!frame || !canvas || steps.length === 0) return;
  let active = '';

  const show = (name: string, force = false): void => {
    if (name === active && !force) return;
    active = name;
    for (const step of steps) step.classList.toggle('is-active', step.dataset.step === name);
    canvas.dataset.focus = name;
    let region: HTMLElement | null = null;
    for (const r of canvas.querySelectorAll<HTMLElement>('[data-region]')) {
      const hit = r.dataset.region === name;
      r.classList.toggle('is-focus', hit);
      if (hit) region = r;
    }
    if (!region) {
      canvas.style.transform = '';
      return;
    }
    const fw = frame.clientWidth;
    const fh = frame.clientHeight;
    const { x, y } = offsetWithin(region, canvas);
    const w = region.offsetWidth;
    const h = region.offsetHeight;
    const maxScale = fw < 600 ? 2.8 : 2.1;
    const scale = Math.min(maxScale, fw / (w * 1.12), fh / (h * 1.12));
    const tx = Math.min(0, Math.max(fw - fw * scale, fw / 2 - (x + w / 2) * scale));
    const ty = Math.min(0, Math.max(fh - fh * scale, fh / 2 - (y + h / 2) * scale));
    canvas.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${scale.toFixed(3)})`;
  };

  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((e) => e.isIntersecting);
    const last = visible[visible.length - 1];
    if (last) show((last.target as HTMLElement).dataset.step ?? 'all');
  }, { rootMargin: '-48% 0px -48% 0px' });
  for (const step of steps) observer.observe(step);
  show('all');

  let pending = 0;
  addEventListener('resize', () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => show(active, true));
  });
}

function setupToc(toc: HTMLElement): void {
  const links = new Map<string, HTMLAnchorElement>();
  for (const a of toc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) links.set(a.hash.slice(1), a);
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      for (const [id, a] of links) a.classList.toggle('is-current', id === entry.target.id);
    }
  }, { rootMargin: '-30% 0px -60% 0px' });
  for (const id of links.keys()) {
    const section = document.getElementById(id);
    if (section) observer.observe(section);
  }
}

const tour = document.querySelector<HTMLElement>('[data-tour]');
if (tour) setupTour(tour);
const toc = document.querySelector<HTMLElement>('.toc');
if (toc) setupToc(toc);

export {};
