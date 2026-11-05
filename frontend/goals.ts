export {};
type Goal = {id:string;name:string;type?:string;path?:string;archived?:boolean};
declare global { interface Window { PostdeployGoals: {mount(project:{id:string;goals:Goal[]},admin:boolean,changed:()=>Promise<void>):void} } }
const escape=(s:string):string=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]??c);
window.PostdeployGoals = { mount(project,admin,changed):void {
  const target=document.querySelector("#goal-management"); if(!target) return;
  target.innerHTML=`<section class="panel"><div class="panel-head"><h2>Configure goals</h2></div><div class="panel-body stack"><p class="help">Rules collect future completions. Matching rules and event names stay fixed; rename the label or archive a rule to stop collection. Archived history stays in reports. One rule per exact path or event name, up to 40 including archives.</p><div id="goal-status" role="status"></div><div class="stack">${project.goals.map(g=>`<form class="stack" data-goal="${escape(g.id)}"><label class="field">Goal label<input class="input" name="name" maxlength="80" required value="${escape(g.name)}" ${admin?"":"disabled"}></label><span class="help">${g.archived?"Archived · ":""}${g.type==="page"?`Exact path: <code style="overflow-wrap:anywhere">${escape(g.path??"")}</code>. No extra snippet needed.`:`Named event: <code style="overflow-wrap:anywhere">${escape(g.id)}</code>. Call after the action succeeds: <code style="overflow-wrap:anywhere">postdeploy.track("${escape(g.id)}")</code>`}</span>${admin?`<div class="actions"><button class="btn btn-sm" type="submit">Save label</button>${g.archived?"":'<button class="btn btn-sm" type="button" data-archive>Archive goal</button>'}</div>`:""}</form>`).join("")}</div>${admin?`<form id="new-goal" class="stack"><h3>Add a goal</h3><div class="field"><label for="goal-label">Goal label</label><input class="input" id="goal-label" name="name" maxlength="80" required></div><div class="field"><label for="goal-type">Matching rule</label><select class="select" id="goal-type" name="type"><option value="event">Named event</option><option value="page">Exact page path</option></select></div><div class="field"><label for="goal-match">Event name or page path</label><input class="input" id="goal-match" name="match" maxlength="512" required aria-describedby="goal-match-help"><span class="help" id="goal-match-help">Event: contact_form_submitted (lowercase letters, digits, underscores). Page: /thank-you (no query or fragment). Paths use the collector's decoding and slash normalisation. Different rules require a new goal.</span></div><button class="btn btn-primary" type="submit">Create goal</button></form>`:'<p class="help">An administrator manages goals.</p>'}</div></section>`;
  async function save(form:HTMLFormElement,archive=false):Promise<void>{
    const buttons=[...form.querySelectorAll("button")];buttons.forEach(b=>b.disabled=true);
    const status=target?.querySelector("#goal-status");
    if(status) status.textContent="Saving…";
    try {
      const values=new FormData(form);const id=form.dataset.goal;
      const body=id?(archive?{archived:true}:{name:values.get("name")}):{name:values.get("name"),type:values.get("type"),[values.get("type")==="page"?"path":"event"]:values.get("match")};
      const response=await fetch(`/api/sites/${encodeURIComponent(project.id)}/goals${id?"/"+encodeURIComponent(id):""}`,{method:id?"PATCH":"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":window.PostDeployAuth.csrf??""},body:JSON.stringify(body)});
      const result:unknown=await response.json();
      if(!response.ok) throw new Error(typeof result==="object"&&result!==null&&"message" in result?String(result.message):"Save failed. Try again.");
      await changed();
      const next=document.querySelector("#goal-status");if(next) next.textContent=archive?"Goal archived. Historical completions remain.":"Saved. Collection uses the updated goals.";
    }catch(e){if(status) status.textContent=e instanceof Error?e.message:String(e);}
    finally{buttons.forEach(b=>b.disabled=false);}
  }
  target.querySelectorAll<HTMLFormElement>("form").forEach(form=>{
    form.addEventListener("submit",e=>{e.preventDefault();void save(form);});
    form.querySelector("[data-archive]")?.addEventListener("click",()=>void save(form,true));
  });
}};
