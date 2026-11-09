import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cert, initializeApp } from 'firebase-admin/app';
import {
  FieldPath,
  getFirestore,
  type CollectionReference,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { createClient } from '@supabase/supabase-js';
import {
  isSupportedCollectionPath,
  resolveCollectionTarget,
} from '../supabase/collection-path';

const FIREBASE_PROJECT_ID = 'developify-5615a';
const PAGE_SIZE = 250;
const WRITE_BATCH_SIZE = 100;

type ImportOperation = {
  collection: string;
  id: string;
  kind: 'set';
  data: Record<string, unknown>;
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();
  if (!serviceAccountPath) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_PATH is required.');
  }

  const resolvedServiceAccountPath = resolve(process.cwd(), serviceAccountPath);
  await readFile(resolvedServiceAccountPath);
  initializeApp({
    credential: cert(resolvedServiceAccountPath),
    projectId: FIREBASE_PROJECT_ID,
  });
  const firestore = getFirestore();

  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!dryRun && (!supabaseUrl || !serviceRoleKey)) {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for an import.',
    );
  }
  const supabase =
    dryRun || !supabaseUrl || !serviceRoleKey
      ? null
      : createClient(supabaseUrl, serviceRoleKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        });

  const counts = new Map<string, number>();
  const skippedNames = new Set<string>();
  let operations: ImportOperation[] = [];
  let imported = 0;
  let batches = 0;

  const flush = async () => {
    if (operations.length === 0) return;
    if (supabase) {
      const result = await supabase.rpc('developify_commit', {
        p_reads: [],
        p_operations: operations,
      });
      if (result.error) {
        throw new Error(
          `Supabase import batch failed (code ${result.error.code ?? 'unknown'}).`,
        );
      }
      batches += 1;
    }
    imported += operations.length;
    operations = [];
  };

  const importCollection = async (collection: CollectionReference) => {
    const supported = isSupportedCollectionPath(collection.path);
    if (!supported) skippedNames.add(collection.id);

    let cursor: QueryDocumentSnapshot | undefined;
    while (true) {
      let query = collection.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
      if (cursor) query = query.startAfter(cursor);
      const page = await query.get();
      if (page.empty) break;

      for (const document of page.docs) {
        if (supported) {
          const collectionPath = document.ref.parent.path;
          const target = resolveCollectionTarget(collectionPath);
          const serialized = JSON.stringify(document.data());
          if (serialized === undefined) {
            throw new Error(
              `Firestore returned a non-JSON document in ${target.tableName}.`,
            );
          }
          operations.push({
            collection: collectionPath,
            id: document.id,
            kind: 'set',
            data: JSON.parse(serialized) as DocumentData,
          });
          counts.set(target.tableName, (counts.get(target.tableName) ?? 0) + 1);
          if (operations.length >= WRITE_BATCH_SIZE) await flush();
        }

        for (const subcollection of await document.ref.listCollections()) {
          await importCollection(subcollection);
        }
      }

      cursor = page.docs.at(-1);
      if (page.docs.length < PAGE_SIZE) break;
    }
  };

  for (const collection of await firestore.listCollections()) {
    await importCollection(collection);
  }
  await flush();

  const summary = Object.fromEntries([...counts.entries()].sort());
  console.log(
    JSON.stringify(
      {
        project: FIREBASE_PROJECT_ID,
        mode: dryRun ? 'dry-run' : 'imported',
        documents: imported,
        batches,
        byCollection: summary,
        skippedUnregisteredCollectionNames: [...skippedNames].sort(),
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown Firestore import error.';
  console.error(`Firestore import failed: ${message}`);
  process.exitCode = 1;
});
