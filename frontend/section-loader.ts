export class SectionLoader {
  private controller = new AbortController();
  private pending: (()=>Promise<void>)[] = [];
  private running = false;
  reset(): void { this.controller.abort(); this.controller = new AbortController(); this.pending = []; }
  stop(): void { this.controller.abort(); this.pending = []; }
  enqueue(path: string, target: HTMLElement, render: (value: unknown)=>void): void {
    const signal = this.controller.signal;
    const anchor = target.parentElement;
    const run = async (): Promise<void> => {
      if(signal.aborted) return;
      target.setAttribute('aria-busy','true');
      target.textContent = 'Loading exact results…';
      const requestController = new AbortController();
      try {
        let timer = setTimeout(()=>requestController.abort(),30000);
        const progress = (): void => { clearTimeout(timer); timer=setTimeout(()=>requestController.abort(),30000); };
        try {
          const response = await fetch(path,{headers:{Accept:'application/x-ndjson'},signal:AbortSignal.any([signal,requestController.signal])});
          if(signal.aborted) return;
          if(response.status===401) { this.stop(); location.assign('/auth'); return; }
          const value: unknown = response.headers.get('Content-Type')?.includes('application/x-ndjson') ? await readSection(response,progress) : await response.json();
          if(!response.ok) throw new Error(typeof value==='object'&&value!==null&&'message' in value?String(value.message):'This section could not load.');
          if(!signal.aborted) render(value);
        } finally { clearTimeout(timer); }
      } catch(error) {
        if(signal.aborted) return;
        if (!target.isConnected && anchor?.isConnected) anchor.replaceChildren(target);
        target.textContent = requestController.signal.aborted ? 'No response for 30 seconds.' : error instanceof Error ? error.message : 'This section could not load.';
        const button=document.createElement('button'); button.type='button'; button.className='btn'; button.textContent='Retry section';
        button.addEventListener('click',()=>{button.disabled=true;this.pending.unshift(run);void this.drain();},{once:true}); target.append(' ',button);
      } finally { target.setAttribute('aria-busy','false'); }
    };
    this.pending.push(run); void this.drain();
  }
  private async drain(): Promise<void> {
    if(this.running) return;
    this.running=true;
    try { while(this.pending.length) await this.pending.shift()?.(); }
    finally { this.running=false; }
  }
}

export async function readSection(response: Response, progress: ()=>void): Promise<unknown> {
  const reader=response.body?.getReader();
  if(!reader) throw new Error('Missing section response.');
  const decoder=new TextDecoder();
  let buffer='';
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) throw new Error('Section connection ended before completion. Retry section.');
      buffer+=decoder.decode(value,{stream:true});
      let newline: number;
      while((newline=buffer.indexOf('\n'))>=0) {
        if(newline>4*1024*1024) throw new Error('Section response is too large. Narrow the selection.');
        const frame: unknown=JSON.parse(buffer.slice(0,newline)); buffer=buffer.slice(newline+1);
        if(typeof frame!=='object'||frame===null||!('state' in frame)) throw new Error('Invalid section response.');
        if(frame.state==='pending') progress();
        else if(frame.state==='complete' && 'value' in frame) return frame.value;
        else if(frame.state==='error') throw new Error('message' in frame?String(frame.message):'Section failed.');
        else throw new Error('Invalid section response.');
      }
      if(buffer.length>4*1024*1024) throw new Error('Section response is too large. Narrow the selection.');
    }
  } finally { await reader.cancel(); }
}
