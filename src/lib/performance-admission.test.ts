import {afterEach,expect,it,vi} from 'vitest';
import {preparePerformanceRun} from './experiment-runner';
vi.mock('./benchmark-queue',()=>({enqueueBenchmark:vi.fn()}));
vi.mock('./experiment-execution-store',()=>({
 findExperimentExecutionsForTestRun:vi.fn(async()=>[{executionId:'execution',experimentId:'experiment'}]),
 getExperimentExecution:vi.fn(async()=>({execution:{executionMode:'PERFORMANCE',includeColdSample:true},runs:[{testRunId:'run',variantId:'variant'}]})),
}));
vi.mock('./experiment-store',()=>({getExperiment:vi.fn(async()=>({variants:[{id:'variant',executionTargetId:'target',executionModelName:'model'}]}))}));
vi.mock('./execution-target-store',()=>({getExecutionTargetConnection:vi.fn(async()=>({provider:'ollama',endpoint:'http://localhost:11434',apiKey:null}))}));
afterEach(()=>vi.unstubAllGlobals());
it('prepares cold samples explicitly in the admitted worker phase and verifies unload',async()=>{
 const fetchMock=vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('{"models":[]}'));
 vi.stubGlobal('fetch',fetchMock);
 await preparePerformanceRun('run');
 expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/api/generate');
 expect(JSON.parse(fetchMock.mock.calls[0][1].body).keep_alive).toBe(0);
 expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:11434/api/ps');
});
