declare global {
  interface Window { postdeploy?: { track(name: string): void } }
}

document.addEventListener('click', (event: MouseEvent) => {
  if (event.target instanceof Element && event.target.closest('a[download]')) {
    window.postdeploy?.track('source_download');
  }
});
export {};
