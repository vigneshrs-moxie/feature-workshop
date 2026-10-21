// All jobs' costs, with export and a "what if" comparison for the Foreman's model.

import { $, esc, usd, getJson } from './ui.js';
import { stageShort } from './crew.js';

export async function showCosts(meta) {
  const app = $('#app');
  app.innerHTML = '<p class="empty">Adding up the costs…</p>';
  const data = await getJson('/api/costs');
  const jobs = data.jobs;
  const total = jobs.reduce((s, j) => s + j.cost.totalUsd, 0);
  const byModel = {};
  for (const j of jobs) for (const [m, v] of Object.entries(j.cost.perModel)) byModel[m] = (byModel[m] ?? 0) + v;
  const modelName = (m) => meta.prices.models[Object.keys(meta.prices.models).find((k) => m.includes(k))]?.label ?? m;
  const max = Math.max(0, ...Object.values(byModel));
  const pct = (v, of) => (of ? Math.max(2, Math.round((v / of) * 100)) : 0);
  const foreman = (j) => j.cost.agents.filter((a) => a.agentType === 'conductor').reduce((s, a) => s + a.usd, 0);
  app.innerHTML = `<section class="costs">
    <a class="back" href="#/">◀ Back to the map</a>
    <header class="crew-head gbox"><h2 class="display">Costs</h2>
      <p><b class="big-number">${esc(usd(total))}</b> across ${jobs.length} job${jobs.length === 1 ? '' : 's'}. Prices as of ${esc(data.pricesAsOf)}. Where Claude Code recorded its own figure the numbers use it; otherwise they’re estimates from token counts.</p>
      <div class="reply-actions"><a class="btn primary" href="/api/costs/export.csv" download>Download CSV</a><a class="btn" href="/api/costs/export.md" download>Download report (Markdown)</a></div>
      <p class="fineprint">The report is ready to hand on: totals, cost per job, per model and per stage, and the “what if” comparison below.</p>
    </header>
    <div class="cost-grid">
      <section class="gbox pad"><h3>By model</h3><ul class="bars">${Object.entries(byModel).sort((a, b) => b[1] - a[1]).map(([m, v]) => `<li><span>${esc(modelName(m))}</span><progress max="100" value="${pct(v, max)}" aria-hidden="true"></progress><b>${esc(usd(v))}</b></li>`).join('') || '<li class="muted">No costs yet.</li>'}</ul></section>
      <section class="gbox pad"><h3>By job</h3><div class="table-wrap"><table><thead><tr><th>Job</th><th>Stage</th><th>Cost</th><th>Foreman share</th></tr></thead><tbody>
        ${jobs.map((j) => `<tr><td><a href="#/job/${encodeURIComponent(j.slug)}">${esc(j.title)}</a><small class="muted">${esc(j.project?.name ?? '')}</small></td><td>${esc(j.stageState === 'done' ? 'Done' : stageShort(j.stage ?? ''))}</td><td>${esc(usd(j.cost.totalUsd, j.cost.source))}</td><td>${j.cost.totalUsd ? `${Math.round((foreman(j) / j.cost.totalUsd) * 100)}%` : '—'}</td></tr>`).join('')}
      </tbody></table></div></section>
    </div>
    <section class="gbox pad"><h3>What if the Foreman ran on another model?</h3>
      <p class="muted">The Foreman (conductor) is often the biggest cost. These columns re-price the same tokens on each model, which makes comparing setups easy. A different model would also use a different number of tokens, so treat them as a guide.</p>
      <div class="table-wrap"><table><thead><tr><th>Job</th><th>Foreman, actual</th>${Object.values(meta.prices.models).map((m) => `<th>On ${esc(m.label)}</th>`).join('')}</tr></thead><tbody>
        ${jobs.filter((j) => j.whatIf).map((j) => `<tr><td>${esc(j.title)}</td><td>${esc(usd(j.whatIf.actual))} <small class="muted">${esc(j.whatIf.actualModels.join(', '))}</small></td>${Object.keys(meta.prices.models).map((k) => `<td>${esc(usd(j.whatIf.alternatives[k], 'estimate'))}</td>`).join('')}</tr>`).join('') || '<tr><td colspan="6" class="muted">No Foreman sessions found yet.</td></tr>'}
      </tbody></table></div>
    </section>
  </section>`;
}
