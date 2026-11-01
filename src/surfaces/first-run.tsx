/**
 * Guided first run for an installation with no company and no projects.
 * The first person is registered before a project can be created. Nothing
 * on this screen is filled with demo data.
 */
import * as React from 'react';
import { Panel } from '@/components/console';
import { PmRejected, PmSaved } from '@/components/pm-feedback';
import { storeClaimedActor } from '@/lib/acting-as';
import {
  pmCreateCompany,
  pmCreatePerson,
  pmCreateProject,
  pmCreateUnit,
  pmOrg,
  pmOrgCompanies,
  pmOrganizationImportStatus,
  pmProjects,
  type PmResult,
} from '@/lib/pm-client';
import { validatePersonHandle, validateProjectFields } from '@/lib/project-fields';

type Step = 'organization' | 'person' | 'department' | 'project';

interface RegisteredPerson {
  id: string;
  handle: string;
  display_name: string;
}

export function FirstRun({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = React.useState<Step>('organization');
  const [companyId, setCompanyId] = React.useState<string | null>(null);
  const [companyName, setCompanyName] = React.useState('');
  const [legalName, setLegalName] = React.useState('');
  const [person, setPerson] = React.useState<RegisteredPerson | null>(null);
  const [handle, setHandle] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [department, setDepartment] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [projectName, setProjectName] = React.useState('');
  const [prefix, setPrefix] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<string | null>(null);
  const [importStatus, setImportStatus] = React.useState<'unknown' | 'available' | 'absent'>('unknown');

  React.useEffect(() => {
    let cancelled = false;
    void pmOrganizationImportStatus().then((status) => {
      if (!cancelled) setImportStatus(status);
    });
    return () => { cancelled = true; };
  }, []);

  const fail = (res: PmResult<unknown>) => {
    setSaved(null);
    setError(res.ok ? 'The service rejected this step.' : (res.message || 'The service rejected this step.'));
  };

  const createOrganization = async (event: React.FormEvent) => {
    event.preventDefault();
    const name = companyName.trim();
    const actor = handle.trim();
    if (name.length < 2) {
      setError('Organization name needs at least 2 characters.');
      return;
    }
    const handleError = validatePersonHandle(actor);
    if (handleError) {
      setError(`Your handle is required before the organization is recorded. ${handleError}`);
      return;
    }
    setBusy(true);
    setError(null);
    const created = await pmCreateCompany({
      actor,
      name,
      ...(legalName.trim() ? { legal_name: legalName.trim() } : {}),
    });
    if (!created.ok || !created.data?.id) {
      setBusy(false);
      fail(created);
      return;
    }
    const readback = await pmOrg();
    setBusy(false);
    const companies = pmOrgCompanies(readback.ok ? readback.data : null);
    const row = companies.find((company) => company.id === created.data?.id);
    if (!readback.ok || !row) {
      setError('The organization was not readable after it was created.');
      return;
    }
    setCompanyId(row.id);
    setCompanyName(row.name);
    setSaved(`Organization ${row.name} is recorded.`);
    setStep('person');
  };

  const createFirstPerson = async (event: React.FormEvent) => {
    event.preventDefault();
    const actor = handle.trim();
    const name = displayName.trim();
    const handleError = validatePersonHandle(actor);
    if (handleError) {
      setError(handleError);
      return;
    }
    if (name.length < 2) {
      setError('Display name needs at least 2 characters.');
      return;
    }
    setBusy(true);
    setError(null);
    const created = await pmCreatePerson({
      actor,
      handle: actor,
      display_name: name,
      kind: 'HUMAN',
    });
    if (!created.ok || !created.data?.handle) {
      setBusy(false);
      fail(created);
      return;
    }
    const readback = await pmOrg();
    setBusy(false);
    const recorded = readback.ok
      ? readback.data?.people?.find((row) => row.handle === created.data?.handle)
      : null;
    if (!readback.ok || !recorded) {
      setError('The first person was not readable after registration.');
      return;
    }
    storeClaimedActor(recorded.handle);
    setPerson({ id: recorded.id, handle: recorded.handle, display_name: recorded.display_name });
    setSaved(`${recorded.display_name} is the first person. Projects can be created as @${recorded.handle}.`);
    setStep('department');
  };

  const createDepartment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!companyId || !person) return;
    const name = department.trim();
    if (name.length < 2) {
      setError('Department name needs at least 2 characters, or skip this step.');
      return;
    }
    setBusy(true);
    setError(null);
    const created = await pmCreateUnit({
      actor: person.handle,
      company_id: companyId,
      kind: 'DEPARTMENT',
      name,
    });
    if (!created.ok) {
      setBusy(false);
      fail(created);
      return;
    }
    const readback = await pmOrg();
    setBusy(false);
    const recorded = readback.ok
      ? readback.data?.units?.find((unit) => unit.id === created.data?.id)
      : null;
    if (!recorded) {
      setError('The department was not readable after it was created.');
      return;
    }
    setSaved(`Department ${recorded.name} is recorded.`);
    setStep('project');
  };

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!person) {
      setError('Register the first person before creating a project.');
      setStep('person');
      return;
    }
    const errors = validateProjectFields({ id: projectId, name: projectName, prefix, description });
    if (errors.length) {
      setError(errors.join(' '));
      return;
    }
    setBusy(true);
    setError(null);
    const created = await pmCreateProject({
      actor: person.handle,
      id: projectId.trim().toLowerCase(),
      name: projectName.trim(),
      prefix: prefix.trim().toUpperCase(),
      ...(description.trim() ? { description: description.trim() } : {}),
    });
    if (!created.ok) {
      setBusy(false);
      fail(created);
      return;
    }
    const readback = await pmProjects();
    setBusy(false);
    const recorded = readback.ok
      ? readback.data?.projects?.find((project) => project.id === projectId.trim().toLowerCase())
      : null;
    if (!recorded) {
      setError('The project was not readable after it was created.');
      return;
    }
    setSaved(`Project ${recorded.name} is recorded.`);
    onComplete();
  };

  return (
    <section className="command-stack" data-first-run="" aria-label="First run">
      <Panel title="First run" count="EMPTY INSTALLATION">
        <div className="body grid gap-3">
          <p>
            This installation has no organization and no projects. Create the organization,
            then register the first person. A project cannot be created until that person exists.
          </p>
          <p data-import-offer="">
            {importStatus === 'available'
              ? 'Starq organization import is available as a separate, explicit action. It does not run automatically.'
              : importStatus === 'absent'
                ? 'No organization import is available on this installation.'
                : 'Checking whether organization import is available.'}
          </p>
          {saved ? <PmSaved label={saved} /> : null}
          {error ? <PmRejected code="VALIDATION" message={error} /> : null}

          {step === 'organization' ? (
            <form aria-label="Create organization" className="grid gap-2" onSubmit={(event) => void createOrganization(event)}>
              <label className="grid gap-1 text-2xs">
                Your handle
                <input aria-label="Your handle" value={handle} onChange={(event) => setHandle(event.target.value)} />
              </label>
              <label className="grid gap-1 text-2xs">
                Organization name
                <input aria-label="Organization name" value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
              </label>
              <label className="grid gap-1 text-2xs">
                Legal name
                <input aria-label="Organization legal name" value={legalName} onChange={(event) => setLegalName(event.target.value)} />
              </label>
              <button type="submit" className="go-link" disabled={busy}>Create organization</button>
            </form>
          ) : null}

          {step === 'person' ? (
            <form aria-label="Register first person" className="grid gap-2" onSubmit={(event) => void createFirstPerson(event)}>
              <p>Register the first person before any project. Handle: {handle}</p>
              <label className="grid gap-1 text-2xs">
                Display name
                <input aria-label="First person display name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
              <button type="submit" className="go-link" disabled={busy}>Register first person</button>
            </form>
          ) : null}

          {step === 'department' ? (
            <form aria-label="Create department" className="grid gap-2" onSubmit={(event) => void createDepartment(event)}>
              <p>A department is optional.</p>
              <label className="grid gap-1 text-2xs">
                Department name
                <input aria-label="Department name" value={department} onChange={(event) => setDepartment(event.target.value)} />
              </label>
              <div className="flex gap-2">
                <button type="submit" className="go-link" disabled={busy}>Create department</button>
                <button type="button" className="go-link" disabled={busy} onClick={() => setStep('project')}>Skip department</button>
              </div>
            </form>
          ) : null}

          {step === 'project' && person ? (
            <form aria-label="Create first project" className="grid gap-2" onSubmit={(event) => void createProject(event)}>
              <p>Creating the first project as @{person.handle}.</p>
              <label className="grid gap-1 text-2xs">
                Project id
                <input aria-label="Project id" value={projectId} onChange={(event) => setProjectId(event.target.value)} />
              </label>
              <label className="grid gap-1 text-2xs">
                Project name
                <input aria-label="Project name" value={projectName} onChange={(event) => setProjectName(event.target.value)} />
              </label>
              <label className="grid gap-1 text-2xs">
                Prefix
                <input aria-label="Project prefix" value={prefix} onChange={(event) => setPrefix(event.target.value)} />
              </label>
              <label className="grid gap-1 text-2xs">
                Description
                <input aria-label="Project description" value={description} onChange={(event) => setDescription(event.target.value)} />
              </label>
              <button type="submit" className="go-link" disabled={busy}>Create project</button>
            </form>
          ) : null}
        </div>
      </Panel>
    </section>
  );
}
