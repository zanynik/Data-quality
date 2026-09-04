const sampleCSV = `order_id,customer_email,phone,country,quantity,unit_price,status,order_date
ORD-1001,anika@example.com,+4915112345678,DE,2,39.90,paid,2026-08-28
ORD-1002,rahul@example.com,+919876543210,IN,1,24.50,shipped,2026-08-28
ORD-1003,bad-email,00491761234567,DE,3,19.99,paid,2026-08-29
ORD-1004,,+919900112233,IN,2,48.00,pending,2026-08-30
ORD-1005,sofia@example.com,+33612345678,FR,0,15.00,paid,2026-08-30
ORD-1006,lars@example.com,+491709998887,DE,4,-8.50,refunded,2026-08-31
ORD-1007,maya@example.com,,IN,2,31.20,shipped,2026-08-31
ORD-1008,noah@example.com,+31612345678,NL,5,12.75,paid,not-a-date
ORD-1009,emma@example.com,+491601234567,DE,2,88.00,unknown,2026-09-01
ORD-1010,vikram@example.com,+919811223344,IN,two,42.00,paid,2026-09-01
ORD-1010,vikram@example.com,+919811223344,IN,two,42.00,paid,2026-09-01
,lee@example.com,+821012345678,KR,1,29.00,paid,2026-09-02`;

const defaultRules = `dataset: customer_orders
id_column: order_id
weights:
  completeness: 0.40
  accuracy: 0.35
  validity: 0.25

rules:
  - id: order_id_required
    column: order_id
    check: required
    dimension: Completeness
    severity: Critical
  - id: order_id_unique
    column: order_id
    check: unique
    dimension: Validity
    severity: Critical
  - id: email_required
    column: customer_email
    check: required
    dimension: Completeness
    severity: Critical
  - id: email_format
    column: customer_email
    check: pattern
    value: ^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$
    dimension: Accuracy
    severity: Warning
  - id: phone_format
    column: phone
    check: pattern
    value: ^(?:\\+|00)[1-9][0-9]{7,14}$
    dimension: Accuracy
    severity: Warning
  - id: country_codes
    column: country
    check: allowed_values
    value: [IN, DE, FR, NL]
    dimension: Validity
    severity: Warning
  - id: quantity_integer
    column: quantity
    check: type
    value: integer
    dimension: Accuracy
    severity: Critical
  - id: quantity_range
    column: quantity
    check: range
    min: 1
    max: 50
    dimension: Accuracy
    severity: Warning
  - id: price_number
    column: unit_price
    check: type
    value: number
    dimension: Accuracy
    severity: Critical
  - id: price_positive
    column: unit_price
    check: range
    min: 0.01
    max: 10000
    dimension: Accuracy
    severity: Critical
  - id: valid_status
    column: status
    check: allowed_values
    value: [pending, paid, shipped, refunded]
    dimension: Validity
    severity: Warning
  - id: order_date_format
    column: order_date
    check: type
    value: date
    dimension: Validity
    severity: Warning`;

const state = { rows: [], columns: [], rules: [], failures: [], results: [], filename: 'customer_orders.csv' };
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function parseCSV(text) {
  text=String(text||'').replace(/^\uFEFF/,'');
  const firstLine=text.split(/\r?\n/,1)[0]||'';
  const delimiter=[',',';','\t'].sort((a,b)=>firstLine.split(b).length-firstLine.split(a).length)[0];
  const rows=[]; let row=[], cell='', quote=false;
  for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1];if(c==='"'&&quote&&n==='"'){cell+='"';i++;}else if(c==='"'){quote=!quote;}else if(c===delimiter&&!quote){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quote){if(c==='\r'&&n==='\n')i++;row.push(cell);if(row.some(v=>v.trim()!==''))rows.push(row);row=[];cell='';}else cell+=c;}
  if(quote) throw new Error('CSV contains an unclosed quoted value.');
  row.push(cell); if(row.some(v=>v!==''))rows.push(row); if(rows.length<2) throw new Error('CSV needs a header and at least one data row.');
  const headers=rows[0].map((h,i)=>h.trim()||`column_${i+1}`);
  const duplicates=headers.filter((h,i)=>headers.indexOf(h)!==i);if(duplicates.length)throw new Error(`Duplicate column name: ${duplicates[0]}`);
  return {columns:headers,rows:rows.slice(1).map((r,ri)=>{const record=Object.fromEntries(headers.map((h,i)=>[h,(r[i]??'').trim()]));record._row=ri+2;return record;})};
}

function parseRules(text){
  const rules=[];let current=null;
  for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('#'))continue;if(line.startsWith('- ')){if(current)rules.push(current);current={};const [k,...v]=line.slice(2).split(':');current[k.trim()]=clean(v.join(':'));}else if(current&&line.includes(':')){const [k,...v]=line.split(':');current[k.trim()]=clean(v.join(':'));}}
  if(current)rules.push(current);return rules.filter(r=>r.id&&r.column&&r.check);
}
function clean(v){v=v.trim();if(v.startsWith('[')&&v.endsWith(']'))return v.slice(1,-1).split(',').map(x=>x.trim().replace(/^['"]|['"]$/g,''));if(v==='true')return true;if(v==='false')return false;if(v!==''&&!isNaN(Number(v)))return Number(v);return v.replace(/^['"]|['"]$/g,'');}
function isMissing(v){return v===null||v===undefined||String(v).trim()==='';}
function inferType(values){const non=values.filter(v=>!isMissing(v));if(!non.length)return'empty';if(non.every(v=>/^-?\d+$/.test(v)))return'integer';if(non.every(v=>!isNaN(Number(v))))return'number';if(non.every(v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))))return'date';if(non.every(v=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)))return'email';return'text';}
function checkRule(rule,row,allRows){const value=row[rule.column],missing=isMissing(value);if(rule.check==='required')return !missing;if(missing)return true;switch(rule.check){case'unique':return allRows.filter(r=>r[rule.column]===value).length===1;case'pattern':try{return new RegExp(rule.value).test(value)}catch{return false}case'allowed_values':return (Array.isArray(rule.value)?rule.value:[]).map(String).includes(String(value));case'range':{const n=Number(value);return !isNaN(n)&&(rule.min===undefined||n>=rule.min)&&(rule.max===undefined||n<=rule.max)}case'type':if(rule.value==='integer')return /^-?\d+$/.test(value);if(rule.value==='number')return value!==''&&!isNaN(Number(value));if(rule.value==='date')return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!isNaN(Date.parse(value));if(rule.value==='email')return/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);return true;default:return true}}
function explanation(rule,v){const shown=isMissing(v)?'blank':`“${v}”`;switch(rule.check){case'required':return`Value is ${shown}; this field is mandatory.`;case'unique':return`${shown} occurs more than once.`;case'pattern':return`${shown} does not match the required pattern.`;case'allowed_values':return`${shown} is outside the allowed set: ${Array.isArray(rule.value)?rule.value.join(', '):String(rule.value||'')}.`;case'range':return`${shown} is outside ${rule.min??'−∞'} to ${rule.max??'∞'}.`;case'type':return`${shown} is not a valid ${rule.value}.`;default:return`${shown} failed ${rule.check}.`}}

function analyze(announce=true){
  try{state.rules=parseRules($('#ruleEditor').value);if(!state.rules.length)throw new Error('No valid rules found. Each rule needs id, column and check.');state.failures=[];state.results=[];
    for(const rule of state.rules){let evaluated=0,failed=0;for(const row of state.rows){const value=row[rule.column];if(rule.check!=='required'&&isMissing(value))continue;evaluated++;if(!checkRule(rule,row,state.rows)){failed++;state.failures.push({row:row._row,id:row[getIdColumn()]||`Row ${row._row}`,column:rule.column,rule:rule.id,check:rule.check,dimension:rule.dimension||'Validity',severity:rule.severity||'Warning',value,explanation:explanation(rule,value)});}}state.results.push({...rule,evaluated,failed,score:evaluated?100*(evaluated-failed)/evaluated:100});}
    renderAll();saveHistory();if(announce)toast(`Assessment complete · ${state.failures.length} failures found`);
  }catch(e){toast(e.message,true);$('#ruleValidation').textContent='⚠ '+e.message;$('#ruleValidation').style.color='var(--red)';}
}
function getIdColumn(){const m=$('#ruleEditor').value.match(/^id_column:\s*(.+)$/m);return m?m[1].trim():'id'}
function scores(){const dims=['Completeness','Accuracy','Validity'];const out={};for(const d of dims){const rs=state.results.filter(r=>(r.dimension||'').toLowerCase()===d.toLowerCase());const ev=rs.reduce((s,r)=>s+r.evaluated,0),fail=rs.reduce((s,r)=>s+r.failed,0);out[d]=ev?100*(ev-fail)/ev:100;}const weights={Completeness:.4,Accuracy:.35,Validity:.25};return{dims:out,overall:dims.reduce((s,d)=>s+out[d]*weights[d],0)}}
function scoreColor(n){return n>=90?'var(--green)':n>=75?'var(--yellow)':'var(--red)'}
function renderAll(){const sc=scores(),overall=Math.round(sc.overall);$('#overallScore').textContent=overall;$('#gauge').style.setProperty('--score',overall);$('#gauge').style.background=`conic-gradient(${scoreColor(overall)} ${overall}%,#223449 0)`;$('#scoreStatus').textContent=overall>=90?'GOOD':overall>=75?'NEEDS ATTENTION':'AT RISK';$('#scoreStatus').style.color=scoreColor(overall);$('#scoreMessage').textContent=overall>=90?'Healthy, with a few fixable issues':overall>=75?'Review priority findings':'Immediate remediation recommended';$('#scoreDetail').textContent=`${state.rules.length} rules evaluated across ${state.rows.length} rows and 3 dimensions.`;
  $('#dimensionBars').innerHTML=Object.entries(sc.dims).map(([d,n],i)=>`<div class="dim-row"><span>${d}</span><div class="track"><div class="fill" style="width:${n}%;background:${['var(--cyan)','var(--violet)','var(--green)'][i]}"></div></div><strong>${Math.round(n)}%</strong></div>`).join('');
  const missing=state.columns.reduce((s,c)=>s+state.rows.filter(r=>isMissing(r[c])).length,0),dups=countDuplicates(),passed=state.results.filter(r=>r.failed===0).length,critical=state.failures.filter(f=>f.severity==='Critical').length;
  $('#rowCount').textContent=state.rows.length.toLocaleString();$('#columnCount').textContent=state.columns.length;$('#ruleCount').textContent=state.rules.length;$('#lastRun').textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});$('#failedChecks').textContent=state.failures.length;$('#criticalText').textContent=`${critical} critical`;$('#missingValues').textContent=missing;$('#missingRate').textContent=`${(100*missing/(state.rows.length*state.columns.length)).toFixed(1)}% of cells`;$('#duplicateRows').textContent=dups;$('#rulesPassed').textContent=`${passed} / ${state.rules.length}`;$('#passRate').textContent=`${(100*passed/state.rules.length).toFixed(1)}% clean`;$('#failureBadge').textContent=state.failures.length;
  renderColumns();renderFailures();renderRecommendations();$('#ruleValidation').textContent='✓ Configuration valid';$('#ruleValidation').style.color='var(--green)';
}
function columnMetrics(c){const rs=state.results.filter(r=>r.column===c),fail=rs.reduce((s,r)=>s+r.failed,0),ev=rs.reduce((s,r)=>s+r.evaluated,0),nulls=state.rows.filter(r=>isMissing(r[c])).length;return{score:ev?100*(ev-fail)/ev:100,fail,nulls,type:inferType(state.rows.map(r=>r[c])),distinct:new Set(state.rows.map(r=>r[c]).filter(v=>!isMissing(v))).size}}
function renderColumns(){const metrics=state.columns.map(c=>({column:c,...columnMetrics(c)})).sort((a,b)=>a.score-b.score);$('#columnHealth').innerHTML=metrics.slice(0,5).map(m=>`<div class="health-row"><strong>${escapeHTML(m.column)}</strong><div class="track"><i style="width:${m.score}%;background:${scoreColor(m.score)}"></i></div><b>${Math.round(m.score)}%</b><small>${m.fail} failed</small></div>`).join('');const q=$('#columnSearch').value.toLowerCase();$('#columnGrid').innerHTML=metrics.filter(m=>m.column.toLowerCase().includes(q)).map(m=>{const bars=distribution(m.column);return`<article class="column-card"><div class="column-card-head"><h3>${escapeHTML(m.column)}</h3><span class="type-pill">${m.type}</span></div><div class="mini-score" style="color:${scoreColor(m.score)}">${Math.round(m.score)}<span>% quality</span></div><div class="mini-track"><i style="width:${m.score}%;background:${scoreColor(m.score)}"></i></div><div class="distribution" title="Value frequency distribution">${bars.map(x=>`<i style="height:${x}%"></i>`).join('')}</div><div class="column-stats"><div><strong>${m.nulls}</strong><small>NULLS</small></div><div><strong>${m.fail}</strong><small>FAILURES</small></div><div><strong>${m.distinct}</strong><small>DISTINCT</small></div></div></article>`}).join('')}
function distribution(c){const counts={};state.rows.forEach(r=>{const v=isMissing(r[c])?'∅':r[c];counts[v]=(counts[v]||0)+1});const vals=Object.values(counts).sort((a,b)=>b-a).slice(0,10),max=Math.max(...vals,1);return vals.map(v=>Math.max(10,100*v/max))}
function renderFailures(){const search=$('#failureSearch').value.toLowerCase(),sev=$('#severityFilter').value,dim=$('#dimensionFilter').value;const rows=state.failures.filter(f=>(sev==='all'||f.severity===sev)&&(dim==='all'||f.dimension===dim)&&Object.values(f).join(' ').toLowerCase().includes(search));$('#failureTable').innerHTML=rows.map(f=>`<tr><td><strong>${escapeHTML(String(f.id))}</strong><br><small>#${f.row}</small></td><td>${escapeHTML(f.column)}</td><td><code>${escapeHTML(f.rule)}</code></td><td>${escapeHTML(f.dimension)}</td><td><span class="severity ${f.severity}">${f.severity}</span></td><td>${escapeHTML(isMissing(f.value)?'NULL':String(f.value))}</td><td>${escapeHTML(f.explanation)}</td></tr>`).join('');$('#failureEmpty').style.display=rows.length?'none':'block'}
function renderRecommendations(){const groups={};state.failures.forEach(f=>{groups[f.rule]=groups[f.rule]||{...f,count:0};groups[f.rule].count++});const arr=Object.values(groups).sort((a,b)=>(b.severity==='Critical')-(a.severity==='Critical')||b.count-a.count).slice(0,4);$('#recommendations').innerHTML=arr.length?arr.map(r=>`<div class="recommendation ${r.severity.toLowerCase()}"><i></i><div><strong>${r.count} ${escapeHTML(r.column)} value${r.count>1?'s':''} fail ${escapeHTML(r.rule)}</strong><p>${fixSuggestion(r)}</p></div></div>`).join(''):'<div class="recommendation info"><i></i><div><strong>No remediation needed</strong><p>All configured rules passed.</p></div></div>'}
function fixSuggestion(f){return f.check==='required'?'Backfill missing values or define a source default.':f.check==='pattern'?'Normalize the format before ingestion.':f.check==='unique'?'Deduplicate on the row identifier before loading.':f.check==='range'?'Review outliers and enforce bounds upstream.':f.check==='allowed_values'?'Map unexpected labels to the canonical value set.':'Cast invalid values or quarantine affected rows.'}
function countDuplicates(){const seen=new Set();let d=0;for(const r of state.rows){const k=state.columns.map(c=>r[c]).join('\u241f');if(seen.has(k))d++;else seen.add(k)}return d}
function escapeHTML(s){return s.replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function setData(text,name,runNow=true){const parsed=parseCSV(text);state.rows=parsed.rows;state.columns=parsed.columns;state.filename=name;$('#datasetTitle').textContent=name.replace(/\.csv$/i,'').replace(/[_-]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());if(runNow)analyze(false)}
function inferRules(){const rules=[];for(const c of state.columns){const vals=state.rows.map(r=>r[c]),type=inferType(vals);rules.push({id:`${c}_required`,column:c,check:'required',dimension:'Completeness',severity:'Warning'});if(type!=='text'&&type!=='empty')rules.push({id:`${c}_${type}`,column:c,check:'type',value:type,dimension:type==='date'?'Validity':'Accuracy',severity:'Warning'});if(/email/i.test(c))rules.push({id:`${c}_format`,column:c,check:'pattern',value:'^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$',dimension:'Accuracy',severity:'Warning'});if(/(^id$|_id$)/i.test(c))rules.push({id:`${c}_unique`,column:c,check:'unique',dimension:'Validity',severity:'Critical'});}$('#ruleEditor').value=serializeRules(rules);toast(`${rules.length} rules inferred from column profiles`)}
function serializeRules(rules){return`dataset: ${state.filename.replace(/\.csv$/i,'')}\nid_column: ${state.columns.find(c=>/(^id$|_id$)/i.test(c))||state.columns[0]}\nweights:\n  completeness: 0.40\n  accuracy: 0.35\n  validity: 0.25\n\nrules:\n`+rules.map(r=>'  - id: '+r.id+'\n'+Object.entries(r).filter(([k])=>k!=='id').map(([k,v])=>`    ${k}: ${Array.isArray(v)?'['+v.join(', ')+']':v}`).join('\n')).join('\n')}
function download(name,content,type='text/plain'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
function exportFailures(){const h=['row','row_id','column','rule','dimension','severity','observed_value','explanation'];const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';download('data-quality-failures.csv',[h.join(','),...state.failures.map(f=>[f.row,f.id,f.column,f.rule,f.dimension,f.severity,f.value,f.explanation].map(quote).join(','))].join('\n'),'text/csv')}
function saveHistory(){try{const key='dq-history',h=JSON.parse(localStorage.getItem(key)||'[]'),s=Math.round(scores().overall);const prev=h[0]?.score;h.unshift({date:new Date().toISOString(),score:s,dataset:state.filename});localStorage.setItem(key,JSON.stringify(h.slice(0,20)));$('#scoreDelta').textContent=prev===undefined?'Baseline created for future runs':`${s-prev>=0?'↑':'↓'} ${Math.abs(s-prev)} points from previous run`}catch{}}
function toast(msg,error=false){const t=$('#toast');t.textContent=msg;t.style.borderColor=error?'var(--red)':'';t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2600)}

$$('.nav-item').forEach(b=>b.onclick=()=>switchView(b.dataset.view));$$('[data-go]').forEach(b=>b.onclick=()=>switchView(b.dataset.go));function switchView(id){$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===id));$$('.view').forEach(v=>v.classList.toggle('active-view',v.id===id));window.scrollTo({top:0,behavior:'smooth'})}
$('#runAnalysis').onclick=()=>analyze();$('#loadSample').onclick=()=>{$('#ruleEditor').value=defaultRules;setData(sampleCSV,'customer_orders.csv');toast('Sample dataset restored')};$('#csvInput').onchange=e=>loadFile(e.target.files[0]);function loadFile(file){if(!file)return;if(file.size>25*1024*1024)return toast('For this browser MVP, use a CSV smaller than 25 MB.',true);const r=new FileReader();r.onload=()=>{try{setData(r.result,file.name,false);inferRules();analyze(false);switchView('overview');toast(`${file.name} loaded · ${state.rows.length} rows assessed`)}catch(e){toast(e.message,true)}};r.onerror=()=>toast('The file could not be read.',true);r.readAsText(file)}
const dz=$('#dropZone');['dragenter','dragover'].forEach(e=>dz.addEventListener(e,x=>{x.preventDefault();dz.classList.add('dragging')}));['dragleave','drop'].forEach(e=>dz.addEventListener(e,x=>{x.preventDefault();dz.classList.remove('dragging')}));dz.addEventListener('drop',e=>loadFile(e.dataTransfer.files[0]));
$('#failureSearch').oninput=renderFailures;$('#severityFilter').onchange=renderFailures;$('#dimensionFilter').onchange=renderFailures;$('#columnSearch').oninput=renderColumns;$('#exportFailures').onclick=exportFailures;$('#downloadRules').onclick=()=>download('rules.yml',$('#ruleEditor').value,'text/yaml');$('#printReport').onclick=()=>window.print();$('#inferRules').onclick=inferRules;$('#formatRules').onclick=()=>{const r=parseRules($('#ruleEditor').value);if(!r.length)return toast('No valid rules to format',true);$('#ruleEditor').value=serializeRules(r);toast('YAML formatted')};
const modal=$('#architectureModal');$('#openArchitecture').onclick=()=>{modal.classList.add('open');modal.setAttribute('aria-hidden','false')};$$('.modal-close,.modal-backdrop').forEach(x=>x.onclick=()=>{modal.classList.remove('open');modal.setAttribute('aria-hidden','true')});document.addEventListener('keydown',e=>{if(e.key==='Escape')modal.classList.remove('open')});
const catalog=[['required','Mandatory field validation'],['unique','Duplicate identifier detection'],['type','Integer, number, date or email'],['pattern','Regular-expression formats'],['range','Numeric minimum and maximum'],['allowed_values','Canonical value sets'],['relationships','Reference / lookup integrity'],['freshness','Timestamp recency threshold']];$('#catalogGrid').innerHTML=catalog.map(([a,b])=>`<div class="catalog-item"><code>${a}</code><p>${b}</p></div>`).join('');
$('#ruleEditor').value=defaultRules;setData(sampleCSV,'customer_orders.csv');
