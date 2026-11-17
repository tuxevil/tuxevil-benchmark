let active = 0;
export function beginExecutionActivity() { active++; let ended=false; return () => { if(!ended){active--;ended=true;} }; }
export function activeExecutionCount() { return active; }
