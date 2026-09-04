import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(error.message));
const dom = await JSDOM.fromFile(resolve('dist/index.html'), {
  resources: 'usable',
  runScripts: 'dangerously',
  url: pathToFileURL(resolve('dist/index.html')).href,
  pretendToBeVisual: true,
  virtualConsole,
  beforeParse(window) { window.scrollTo = () => {}; },
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Page load timed out')), 5000);
  dom.window.addEventListener('load', () => { clearTimeout(timer); resolve(); });
});

const doc = dom.window.document;
assert.equal(doc.querySelector('#rowCount').textContent, '12');
assert.equal(doc.querySelector('#columnCount').textContent, '8');
assert.ok(Number(doc.querySelector('#overallScore').textContent) > 0);
assert.ok(doc.querySelectorAll('#failureTable tr').length > 0);
assert.equal(doc.querySelector('.sample-link').getAttribute('href'), 'sample-customer-orders.csv');

const randomCsv = `person_id;name;email;age;active\n1;"Müller, Anna";anna@example.com;34;yes\n2;Ravi;ravi-at-example.com;not-known;no\n2;Lea;;29;yes`;
const file = new dom.window.File([randomCsv], 'people.csv', { type: 'text/csv' });
const input = doc.querySelector('#csvInput');
Object.defineProperty(input, 'files', { configurable: true, value: [file] });
input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
await new Promise(resolve => setTimeout(resolve, 100));

assert.equal(doc.querySelector('#rowCount').textContent, '3');
assert.equal(doc.querySelector('#columnCount').textContent, '5');
assert.match(doc.querySelector('#datasetTitle').textContent, /People/i);
assert.ok(Number(doc.querySelector('#ruleCount').textContent) >= 5);
assert.equal(doc.querySelectorAll('#columnGrid .column-card').length, 5);
assert.match(doc.querySelector('#ruleEditor').value, /person_id_unique/);

doc.querySelector('[data-view="failures"]').click();
assert.ok(doc.querySelector('#failures').classList.contains('active-view'));
doc.querySelector('#failureSearch').value = 'person_id';
doc.querySelector('#failureSearch').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
assert.ok(doc.querySelectorAll('#failureTable tr').length >= 2);

doc.querySelector('[data-view="rules"]').click();
assert.ok(doc.querySelector('#rules').classList.contains('active-view'));
doc.querySelector('#runAnalysis').click();
assert.equal(doc.querySelector('#ruleValidation').textContent, '✓ Configuration valid');

assert.deepEqual(errors, []);
console.log('E2E passed: sample load, semicolon CSV upload, inference, scoring, drilldown, filtering, and rerun.');
dom.window.close();
