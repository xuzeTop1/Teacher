import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_HASH_ALGORITHM = 'sha256';

function toPortableRelativePath(relativePath) {
  return relativePath.split(path.sep).join('/');
}

async function assertDirectory(directoryPath, label) {
  let stats;
  try {
    stats = await lstat(directoryPath);
  } catch (error) {
    throw new Error(`${label} does not exist or cannot be read: ${directoryPath} (${error.code ?? error.message})`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`${label} is not a directory: ${directoryPath}`);
  }
}

async function collectRegularFiles(rootDirectory) {
  await assertDirectory(rootDirectory, 'Protocol directory');
  const files = [];

  async function visit(currentDirectory, relativeDirectory = '') {
    let entries;
    try {
      entries = await readdir(currentDirectory, { withFileTypes: true });
    } catch (error) {
      throw new Error(`Cannot read protocol directory: ${currentDirectory} (${error.code ?? error.message})`);
    }

    for (const entry of entries) {
      const entryPath = path.join(currentDirectory, entry.name);
      const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;

      // Never follow links; a link is an explicit protocol-tree violation.
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolic link is not allowed in protocol directory: ${toPortableRelativePath(relativePath)}`);
      }
      if (entry.isDirectory()) {
        await visit(entryPath, relativePath);
      } else if (entry.isFile()) {
        files.push(toPortableRelativePath(relativePath));
      }
    }
  }

  await visit(rootDirectory);
  return files.sort();
}

async function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash(DEFAULT_HASH_ALGORITHM);
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function hashProtocolFiles(rootDirectory, relativePaths) {
  const result = new Map();
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(rootDirectory, ...relativePath.split('/'));
    try {
      const stats = await lstat(absolutePath);
      if (stats.isSymbolicLink() || !stats.isFile()) {
        throw new Error('path is no longer a regular file');
      }
      result.set(relativePath, await sha256File(absolutePath));
    } catch (error) {
      throw new Error(`Cannot hash protocol file ${relativePath}: ${error.code ?? error.message}`);
    }
  }
  return result;
}

export async function collectProtocolFiles(protocolDirectory) {
  return collectRegularFiles(path.resolve(protocolDirectory));
}

export async function verifyProtocolMirror(teacherProtocolDirectory, alertTimeProtocolDirectory) {
  const teacherDirectory = path.resolve(teacherProtocolDirectory);
  const alertTimeDirectory = path.resolve(alertTimeProtocolDirectory);
  const [teacherFiles, alertTimeFiles] = await Promise.all([
    collectRegularFiles(teacherDirectory),
    collectRegularFiles(alertTimeDirectory),
  ]);

  const emptyDirectories = [
    ...(teacherFiles.length === 0 ? [teacherDirectory] : []),
    ...(alertTimeFiles.length === 0 ? [alertTimeDirectory] : []),
  ];
  if (emptyDirectories.length) {
    return {
      ok: false,
      teacherFileCount: teacherFiles.length,
      alertTimeFileCount: alertTimeFiles.length,
      emptyDirectories,
      missingFromAlertTime: [],
      missingFromTeacher: [],
      mismatchedFiles: [],
    };
  }

  const teacherSet = new Set(teacherFiles);
  const alertTimeSet = new Set(alertTimeFiles);
  const missingFromAlertTime = teacherFiles.filter((file) => !alertTimeSet.has(file));
  const missingFromTeacher = alertTimeFiles.filter((file) => !teacherSet.has(file));
  if (missingFromAlertTime.length || missingFromTeacher.length) {
    return {
      ok: false,
      teacherFileCount: teacherFiles.length,
      alertTimeFileCount: alertTimeFiles.length,
      emptyDirectories: [],
      missingFromAlertTime,
      missingFromTeacher,
      mismatchedFiles: [],
    };
  }

  const [teacherHashes, alertTimeHashes] = await Promise.all([
    hashProtocolFiles(teacherDirectory, teacherFiles),
    hashProtocolFiles(alertTimeDirectory, alertTimeFiles),
  ]);
  const mismatchedFiles = teacherFiles.filter(
    (file) => teacherHashes.get(file) !== alertTimeHashes.get(file),
  );

  return {
    ok: mismatchedFiles.length === 0,
    teacherFileCount: teacherFiles.length,
    alertTimeFileCount: alertTimeFiles.length,
    emptyDirectories: [],
    missingFromAlertTime: [],
    missingFromTeacher: [],
    mismatchedFiles,
  };
}

function printResult(result, teacherDirectory, alertTimeDirectory) {
  if (result.ok) {
    console.log(`Protocol mirrors are identical: ${result.teacherFileCount} file(s).`);
    return;
  }

  console.error('Protocol mirror verification failed.');
  console.error(`Teacher directory: ${teacherDirectory}`);
  console.error(`AlertTime directory: ${alertTimeDirectory}`);
  for (const directory of result.emptyDirectories) console.error(`Empty protocol directory: ${directory}`);
  for (const file of result.missingFromAlertTime) console.error(`Missing from AlertTime: ${file}`);
  for (const file of result.missingFromTeacher) console.error(`Missing from Teacher: ${file}`);
  for (const file of result.mismatchedFiles) console.error(`SHA-256 mismatch: ${file}`);
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (entrypoint === import.meta.url) {
  const [, , teacherDirectory, alertTimeDirectory] = process.argv;
  if (!teacherDirectory || !alertTimeDirectory) {
    console.error('Usage: node scripts/verify-protocol-mirror.mjs <teacherProtocolDir> <alertTimeProtocolDir>');
    process.exitCode = 1;
  } else {
    try {
      const result = await verifyProtocolMirror(teacherDirectory, alertTimeDirectory);
      printResult(result, path.resolve(teacherDirectory), path.resolve(alertTimeDirectory));
      process.exitCode = result.ok ? 0 : 1;
    } catch (error) {
      console.error(`Protocol mirror verification failed: ${error.message}`);
      process.exitCode = 1;
    }
  }
}

export { toPortableRelativePath };
