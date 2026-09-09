import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectProtocolFiles, verifyProtocolMirror } from './verify-protocol-mirror.mjs';

const tempRoots = new Set();

async function makePair() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'verify-protocol-mirror-'));
  tempRoots.add(root);
  const teacher = path.join(root, 'teacher');
  const alertTime = path.join(root, 'alert-time');
  await mkdir(teacher);
  await mkdir(alertTime);
  return { root, teacher, alertTime };
}

async function put(root, relativePath, content) {
  const filePath = path.join(root, ...relativePath.split('/'));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

test.after(async () => {
  const tempRoot = path.resolve(os.tmpdir());
  const separator = path.sep;
  for (const root of tempRoots) {
    const resolvedRoot = path.resolve(root);
    assert.ok(
      resolvedRoot.startsWith(`${tempRoot}${separator}`),
      `refusing to clean outside os.tmpdir: ${resolvedRoot}`,
    );
    await rm(resolvedRoot, { recursive: true, force: true });
  }
});

test('accepts identical protocol directories', async () => {
  const { teacher, alertTime } = await makePair();
  await put(teacher, 'schema.json', '{"version":1}');
  await put(alertTime, 'schema.json', '{"version":1}');
  const result = await verifyProtocolMirror(teacher, alertTime);
  assert.deepEqual(result, {
    ok: true,
    teacherFileCount: 1,
    alertTimeFileCount: 1,
    emptyDirectories: [],
    missingFromAlertTime: [],
    missingFromTeacher: [],
    mismatchedFiles: [],
  });
});

test('reports content mismatches without exposing content', async () => {
  const { teacher, alertTime } = await makePair();
  await put(teacher, 'schema.json', 'teacher-secret-value');
  await put(alertTime, 'schema.json', 'alert-secret-value');
  const result = await verifyProtocolMirror(teacher, alertTime);
  assert.equal(result.ok, false);
  assert.deepEqual(result.mismatchedFiles, ['schema.json']);
  assert.equal(JSON.stringify(result).includes('secret-value'), false);
});

test('reports files missing from either mirror', async () => {
  const { teacher, alertTime } = await makePair();
  await put(teacher, 'teacher-only.json', '{}');
  await put(alertTime, 'alert-only.json', '{}');
  const result = await verifyProtocolMirror(teacher, alertTime);
  assert.equal(result.ok, false);
  assert.deepEqual(result.missingFromAlertTime, ['teacher-only.json']);
  assert.deepEqual(result.missingFromTeacher, ['alert-only.json']);
});

test('fails closed when both protocol directories are empty', async () => {
  const { teacher, alertTime } = await makePair();
  const result = await verifyProtocolMirror(teacher, alertTime);
  assert.equal(result.ok, false);
  assert.deepEqual(result.emptyDirectories, [teacher, alertTime]);
});

test('collects nested files with portable sorted paths', async () => {
  const { teacher, alertTime } = await makePair();
  await put(teacher, 'z/deep/file.json', '1');
  await put(teacher, 'a.json', '2');
  await put(alertTime, 'z/deep/file.json', '1');
  await put(alertTime, 'a.json', '2');
  assert.deepEqual(await collectProtocolFiles(teacher), ['a.json', 'z/deep/file.json']);
  assert.deepEqual(await collectProtocolFiles(alertTime), ['a.json', 'z/deep/file.json']);
});

test('fails closed when a protocol directory is missing', async () => {
  const { teacher, root } = await makePair();
  await assert.rejects(
    verifyProtocolMirror(teacher, path.join(root, 'missing')),
    /does not exist or cannot be read/,
  );
});

test('rejects symbolic links without following them', async (t) => {
  const { teacher, alertTime } = await makePair();
  await put(teacher, 'shared.json', '{}');
  await put(alertTime, 'shared.json', '{}');
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'verify-protocol-mirror-link-'));
  tempRoots.add(externalRoot);
  const externalFile = path.join(externalRoot, 'outside.json');
  await writeFile(externalFile, 'outside');
  try {
    await symlink(externalFile, path.join(teacher, 'outside.json'));
  } catch (error) {
    if (['EACCES', 'EPERM', 'UNKNOWN'].includes(error.code)) {
      t.skip(`symbolic links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  await assert.rejects(
    verifyProtocolMirror(teacher, alertTime),
    /Symbolic link is not allowed/,
  );
});
