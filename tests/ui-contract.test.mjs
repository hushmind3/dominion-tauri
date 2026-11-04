import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import path from 'node:path';

const pages=path.resolve('src/pages');
test('pages use reusable design-system controls rather than raw form elements',()=>{
 for(const name of readdirSync(pages).filter(n=>n.endsWith('.tsx'))){
  const src=readFileSync(path.join(pages,name),'utf8');
  assert.doesNotMatch(src,/<(?:button|input|textarea|select|table)(?=[\s/>])/,
   name+' contains a raw control instead of a shared primitive');
 }
});
test('design tokens are centralized and the execution monitor is part of workflows',()=>{
 const css=readFileSync('src/theme.css','utf8');
 for(const token of ['--color-brand:','--color-canvas:','--color-ink:','--radius-panel:'])assert.ok(css.includes(token));
 const primitive=readFileSync('src/components/Primitives.tsx','utf8');
 for(const name of ['Button','TextInput','TextArea','SelectInput','DataTable'])assert.ok(primitive.includes('export const '+name));
 const page=readFileSync('src/pages/Workflows.tsx','utf8');
 assert.ok(page.includes('<ExecutionMonitor/>'));
});

test('common page layout utilities replace duplicated custom selectors',()=>{
 for(const name of readdirSync(pages).filter(n=>n.endsWith('.tsx'))){
  const src=readFileSync(path.join(pages,name),'utf8');
  for(const legacy of ['content-wrap','field-input','modal-scrim','modal-fields','modal-actions','home-metrics','chat-layout','workflow-grid','agent-grid','directory-grid','job-status']){
   assert.ok(!src.includes('className="'+legacy+'"'),name+' still uses legacy '+legacy);
  }
 }
});

test('CSS is syntactically balanced after removing migrated selectors',()=>{
 const css=readFileSync('src/theme.css','utf8');
 let depth=0;
 for(const c of css){if(c==='{')depth++;else if(c==='}')depth--;assert.ok(depth>=0,'Unexpected closing brace');}
 assert.equal(depth,0);
 assert.ok(css.length<2500,'Theme must not re-introduce legacy per-page styles');
 assert.equal(existsSync('src/style.css'),false,'Legacy stylesheet must be removed');
});

