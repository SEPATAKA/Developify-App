
import { Injectable } from '@nestjs/common';
import { FirebaseAdminService } from './firebase-admin.service';
import type { DocumentData } from 'firebase-admin/firestore';

@Injectable()
export class FirestoreDataService {
  constructor(private readonly firebase: FirebaseAdminService) {}

  async get(collection: string, id: string) {
    const snapshot = await this.firebase.firestore
      .collection(collection)
      .doc(id)
      .get();

    return snapshot.exists
      ? { id: snapshot.id, ...snapshot.data() }
      : null;
  }

  async create(collection: string, id: string, data: DocumentData) {
    const ref = this.firebase.firestore.collection(collection).doc(id);

    await this.firebase.firestore.runTransaction(async (tx) => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        throw new Error(`Document already exists: ${collection}/${id}`);
      }
      tx.create(ref, {
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    return { id, ...data };
  }

  async update(collection: string, id: string, data: DocumentData) {
    const ref = this.firebase.firestore.collection(collection).doc(id);
    await ref.set({ ...data, updatedAt: new Date() }, { merge: true });
    return this.get(collection, id);
  }

  async delete(collection: string, id: string) {
    await this.firebase.firestore.collection(collection).doc(id).delete();
    return { ok: true };
  }

  async list(collection: string, limit = 50) {
    const snapshot = await this.firebase.firestore
      .collection(collection)
      .limit(Math.min(Math.max(limit, 1), 100))
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  }
}
