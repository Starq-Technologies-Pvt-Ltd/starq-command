const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, 'server', 'pm-service.mjs');
let content = fs.readFileSync(file, 'utf8');

const target = [
  "      const done = mine.filter((t) => t.status === 'DONE').length;",
  "      const done_historical = mine.filter((t) => t.status === 'DONE' && t.provenance === PROVENANCE.HISTORICAL).length;",
  "      const withCommit = mine.filter((t) => t.status === 'DONE' && (t.commit_sha || t.commit)).length;",
  "      const withAcceptance = mine.filter((t) => t.status === 'DONE' && (t.acceptance_json || t.accepted_at)).length;",
  "      const capability = p.id === 'erp' ? { implemented: 7, total: 49, percent: 14 } : null;",
  "      const metrics = {",
  "        claimed: { done, total: mine.length, percent: mine.length > 0 ? Math.round((done / mine.length) * 100) : 0 },",
  "        committed: { count: withCommit, total: done, percent: done > 0 ? Math.round((withCommit / done) * 100) : 0 },",
  "        proven: { count: withAcceptance, total: done, percent: done > 0 ? Math.round((withAcceptance / done) * 100) : 0 },",
  "        capability,",
  "      };",
  "      const eq = executionQualifier(p);",
  "      return {",
  "        id: p.id,",
  "        name: p.name,",
  "        prefix: p.prefix,",
  "        hold: p.hold,",
  "        source_gap: p.source_gap,",
  "        total: mine.length,",
  "        done_historical,",
  "        open: mine.filter((t) => t.status !== 'DONE').length,"
].join('\r\n');

const replacement = [
  "      const liveTasks = mine.filter((t) => t.provenance === PROVENANCE.LIVE);",
  "      const historicalTasks = mine.filter((t) => t.provenance === PROVENANCE.HISTORICAL);",
  "      const done = mine.filter((t) => t.status === 'DONE').length;",
  "      const done_historical = historicalTasks.filter((t) => t.status === 'DONE').length;",
  "      const done_live = liveTasks.filter((t) => t.status === 'DONE').length;",
  "      const withCommit = liveTasks.filter((t) => t.status === 'DONE' && (t.commit_sha || t.commit)).length;",
  "      const withAcceptance = liveTasks.filter((t) => t.status === 'DONE' && (t.acceptance_json || t.accepted_at)).length;",
  "      const capability = p.id === 'erp' ? { implemented: 7, total: 49, percent: 14 } : null;",
  "      const metrics = {",
  "        claimed: {",
  "          done: done_live,",
  "          total: liveTasks.length,",
  "          percent: liveTasks.length > 0 ? Math.round((done_live / liveTasks.length) * 100) : 0,",
  "        },",
  "        committed: {",
  "          count: withCommit,",
  "          total: done_live,",
  "          percent: done_live > 0 ? Math.round((withCommit / done_live) * 100) : 0,",
  "        },",
  "        proven: {",
  "          count: withAcceptance,",
  "          total: done_live,",
  "          percent: done_live > 0 ? Math.round((withAcceptance / done_live) * 100) : 0,",
  "        },",
  "        historical: {",
  "          total: historicalTasks.length,",
  "          done: done_historical,",
  "          percent: historicalTasks.length > 0 ? Math.round((done_historical / historicalTasks.length) * 100) : 0,",
  "        },",
  "        capability,",
  "      };",
  "      const eq = executionQualifier(p);",
  "      return {",
  "        id: p.id,",
  "        name: p.name,",
  "        prefix: p.prefix,",
  "        hold: p.hold,",
  "        source_gap: p.source_gap,",
  "        total: liveTasks.length,",
  "        total_historical: historicalTasks.length,",
  "        done_historical,",
  "        done_live,",
  "        open: liveTasks.filter((t) => t.status !== 'DONE').length,",
  "        open_historical: historicalTasks.filter((t) => t.status !== 'DONE').length,"
].join('\r\n');

if (!content.includes(target)) {
  console.error('Target not found in pm-service.mjs');
  process.exit(1);
}

fs.writeFileSync(file, content.replace(target, replacement), 'utf8');
console.log('Successfully patched pm-service.mjs');
