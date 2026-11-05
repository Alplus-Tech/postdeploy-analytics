export {};
type Project = { id: string; domain: string; aliases: string[]; excludedPaths: string[] };
type PrivacyUI = { mount(project: Project, admin: boolean, save: (body: Record<string, unknown>) => Promise<unknown>): void };
declare global { interface Window { PostdeployPrivacy: PrivacyUI } }

window.PostdeployPrivacy = {
  mount(project, admin, save): void {
    const target = document.querySelector('#project-privacy');
    if (!target) return;
    target.innerHTML = `<form class="stack" style="padding-top:24px"><h3>Allowed hostnames</h3><p class="help">Only the canonical hostname and listed aliases can collect traffic. Add www explicitly. Staging and other subdomains are excluded unless listed. Hostnames cannot belong to two projects.</p><div class="field"><label for="canonical-host">Canonical hostname</label><input id="canonical-host" class="input" maxlength="253" required aria-describedby="host-help"><span id="host-help" class="help">Hostname only, without https://, a port or path. International names are saved as ASCII.</span></div><div class="field"><label for="domain-aliases">Aliases (one per line, up to 20)</label><textarea id="domain-aliases" class="input" rows="3" maxlength="5100" placeholder="www.example.com"></textarea></div><h3>Sensitive paths</h3><div class="field"><label for="excluded-paths">Excluded path prefixes (one per line, up to 20)</label><textarea id="excluded-paths" class="input" rows="4" maxlength="10260" placeholder="/account&#10;/reset&#10;/private" aria-describedby="path-help"></textarea><span id="path-help" class="help">Case-sensitive: /account excludes /account and /account/… but not /accounting. Encoded paths are decoded before matching. / excludes all collection. Matching pageviews, goals and activity are dropped before storage. Rules apply to future requests; history stays. This does not detect personal data automatically. Only utm_source and utm_campaign are retained as campaign attribution.</span></div><div class="toolbar"><button class="btn btn-primary" type="submit">Save domains and privacy</button></div><p class="help" role="status" aria-live="polite"></p></form>`;
    const form = target.querySelector('form');
    const host = target.querySelector<HTMLInputElement>('#canonical-host');
    const alias = target.querySelector<HTMLTextAreaElement>('#domain-aliases');
    const paths = target.querySelector<HTMLTextAreaElement>('#excluded-paths');
    const button = target.querySelector<HTMLButtonElement>('button');
    const status = target.querySelector('[role="status"]');
    if (!form || !host || !alias || !paths || !button || !status) return;
    host.value = project.domain; alias.value = (project.aliases ?? []).join('\n'); paths.value = (project.excludedPaths ?? []).join('\n');
    [host, alias, paths].forEach(input => { input.readOnly = !admin; });
    button.disabled = !admin;
    if (!admin) status.textContent = 'An administrator manages these rules. You can read domains and copy the tracking snippet.';
    const lines = (value: string): string[] => value.split('\n').map(s => s.trim()).filter(Boolean);
    form.addEventListener('submit', async event => {
      event.preventDefault(); event.stopPropagation();
      if (!admin) return;
      button.disabled = true; button.setAttribute('aria-busy', 'true'); status.textContent = 'Saving…';
      try { await save({ domain: host.value.trim(), aliases: lines(alias.value), excludedPaths: lines(paths.value) }); status.textContent = 'Saved. Rules apply to future collection requests.'; }
      catch (error) { status.textContent = `Not saved. ${error instanceof Error ? error.message : 'Try again.'}`; }
      finally { button.disabled = false; button.removeAttribute('aria-busy'); }
    });
  },
};
