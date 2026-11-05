import { HttpError, type Sql, type SqlValue } from './sql.ts';

export function sectionStream(sql: Sql, signal: AbortSignal, build: (sql: Sql) => Promise<Response>): Response {
  const encoder = new TextEncoder();
  let cancelled = false;
  const start = Date.now();
  let statements = 0;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown): void => { if (!cancelled && !signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(value)+'\n')); };
      const check = (): void => {
        if (cancelled || signal.aborted) throw new Error('Cancelled');
        if (Date.now()-start>600000 || statements>=2000) throw new HttpError(422,'section_work_limit','This section reached its work limit. Narrow the selection and retry.');
      };
      const bounded: Sql = {
        async all<T>(query: string, params: readonly SqlValue[] = []): Promise<T[]> {
          check(); statements++;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let rows: T[];
          try {
            rows = await Promise.race([sql.all<T>(query,params),new Promise<never>((_resolve,reject)=>{
              timer=setTimeout(()=>reject(new HttpError(422,'section_query_limit','A section query took too long. Narrow the selection and retry.')),Math.min(25000,Math.max(1,600000-(Date.now()-start))));
            })]);
          } finally { if(timer!==undefined) clearTimeout(timer); }
          check(); send({state:'pending',statements});
          return rows;
        },
        async run(): Promise<void> { throw new Error('Report streams are read only'); },
      };
      try {
        send({state:'pending',statements:0});
        const response=await build(bounded);
        check();
        if(!response.ok) throw new Error('Section failed');
        send({state:'complete',value:await response.json()});
      } catch(error) {
        send({state:'error',message:error instanceof HttpError?error.message:'This section could not complete. Retry or narrow the selection.'});
      } finally { if(!cancelled) controller.close(); }
    },
    cancel() { cancelled=true; },
  });
  return new Response(stream,{headers:{'Content-Type':'application/x-ndjson','Cache-Control':'no-store','X-Accel-Buffering':'no'}});
}
