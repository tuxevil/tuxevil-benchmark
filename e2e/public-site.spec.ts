import { expect,test } from '@playwright/test';
const model={id:'q4',model_name:'LFM3',configuration_label:'Q4',parameter_size:'3B',size_category:'<4B',evaluator_model:'Private evaluator',arena_score:82,avg_stars:4,grammar_score:4,compliance_score:4,accuracy_score:4,security_resilience_score:66.7,security_status:'MODERATE',avg_tok_per_sec:100,avg_ttft_ms:20,total_runs:20,failed_evals:0,categories:["GENERAL"],category_breakdown:{general_stars:4,red_team_resilience:-1,blue_team_score:-1,purple_team_score:-1}};
const snapshot={generated_at:new Date().toISOString(),hardware_rig:{cpu:'Private benchmark host',ram:'Not published',provider:'Infrastructure details protected'},global_stats:{total_models:2,total_scenarios:0,total_benchmarks:40,default_evaluator_model:'Private evaluator',overall_leader:'LFM3',security_leader:'LFM3',avg_speed_tok_sec:100},models:[model,{...model,id:'q6',configuration_label:'Q6'}],scenarios:[]};
test('root restores styled public landing, independent quantization selection and live updates',async({page})=>{
 const privateRequests:string[]=[];
 page.on("request",r=>{if(new URL(r.url()).pathname.startsWith("/admin"))privateRequests.push(r.url());});
 let polls=0;
 await page.route('**/api/public/snapshot',r=>{polls++;return r.fulfill({json:{...snapshot,models:snapshot.models.map(m=>({...m,avg_tok_per_sec:polls>1?123:100}))}});});
 await page.goto('/');
 await expect(page.locator('.hero-title')).toContainText('Public Leaderboard');
 await expect(page.locator('.kpi-card')).toHaveCount(4);
 await expect(page.locator('.model-config')).toHaveText(['Q4','Q6']);
 await page.getByRole('button',{name:'General',exact:true}).click();
 await expect(page.locator('.model-name-text')).toHaveCount(2);
 await expect(page.locator('body')).toHaveCSS('background-color','rgb(12, 16, 23)');
 const checks=page.getByRole('checkbox');await checks.nth(0).check();
 await expect(checks.nth(1)).not.toBeChecked();
 await checks.nth(1).check();await expect(page.getByText('2 linked',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'[View Profile]',exact:true}).first().click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.getByRole('button',{name:'Close',exact:true}).click();
 await expect(page.getByText('123 tok/s').first()).toBeVisible({timeout:10000});
 expect(privateRequests).toEqual([]);
 await page.getByRole('link',{name:'Public Scenarios'}).click();await expect(page).toHaveURL(/\/scenarios/);
});
test('anonymous public reads work while admin and all private APIs require authentication',async({baseURL})=>{
 const context={get:(path:string)=>fetch(new URL(path,baseURL),{redirect:'manual'})};
 for(const path of ['/','/scenarios','/api/public/snapshot'])expect((await context.get(path)).status).toBe(200);
 for(const path of ['/admin','/admin/settings','/admin/backups','/api/settings','/api/runs','/api/runs/unknown/events'])expect((await context.get(path)).status).toBe(401);
 expect((await context.get('/live')).status).toBe(307);

});
