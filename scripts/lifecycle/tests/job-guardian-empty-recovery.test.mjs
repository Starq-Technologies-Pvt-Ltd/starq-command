import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const guardianPath = path.resolve(import.meta.dirname, '../../../../starq-lifecycle/native/JobGuardian.cs');
const source = readFileSync(guardianPath, 'utf8');

test('empty-job recovery writes closeout only after the named job and original root/guardian are gone', () => {
  assert.match(source, /static bool RootGone\(Dictionary<string,object> start\)/);
  assert.match(source, /CreatedRaw\(h\)!=Convert\.ToInt64\(start\["root_created_filetime"\]\) \|\| code!=259/);
  assert.match(source, /int openError=job==IntPtr\.Zero\?Marshal\.GetLastWin32Error\(\):0/);
  assert.match(source, /if\(job==IntPtr\.Zero && openError!=2\)throw new Win32Exception\(openError\)/);

  const recovery = source.slice(
    source.indexOf('if(args[0]=="force" && job==IntPtr.Zero)'),
    source.indexOf('if(job!=IntPtr.Zero){SafeLimits(job);'),
  );
  assert.match(recovery, /if\(!GuardianGone\(start\) \|\| !RootGone\(start\)\)throw/);
  assert.match(recovery, /Receipt\(c,"closed"/);
  assert.match(recovery, /explicit recovery: named job absent and original root\/guardian exited/);
  assert.doesNotMatch(recovery, /TerminateJobObject|TerminateProcess/);
  assert.ok(recovery.indexOf('GuardianGone(start)') < recovery.indexOf('Receipt(c,"closed"'));
  assert.ok(recovery.indexOf('RootGone(start)') < recovery.indexOf('Receipt(c,"closed"'));
});

test('queries remain read-only and empty-job status still requires the authenticated close receipt', () => {
  const query = source.slice(source.indexOf('static Dictionary<string,object> Status'), source.indexOf('static int Launch'));
  assert.match(query, /var closed=Verified\(c,"closed"\)/);
  assert.match(query, /bool closedGuardianGone=GuardianGone\(start\),closedRootGone=RootGone\(start\),closedFamilyGone=closedGuardianGone&&closedRootGone/);
  assert.match(query, /"closed",closedFamilyGone/);
  assert.doesNotMatch(query, /Receipt\(c,"closed"/);
});
