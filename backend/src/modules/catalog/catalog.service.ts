import { Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentData } from 'firebase-admin/firestore';
import { FirebaseAdminService } from '../../firebase/firebase-admin.service';
import { UsersService } from '../users/users.service';

@Injectable()
export class CatalogService {
  constructor(
    private readonly firebase: FirebaseAdminService,
    private readonly users: UsersService,
  ) {}

  private mapProject(id: string, data: DocumentData) {
    const name = data.name;
    const town = data.town;
    const description = data.description;
    const annualRateBps = data.annualRateBps;
    const termMonths = data.termMonths;
    const minInvestCents = data.minInvestCents;
    const capacityCents = data.capacityCents;
    const fundedCents = data.fundedCents;
    const currency = data.currency;
    const status = data.status;
    if (
      typeof name !== 'string' ||
      typeof town !== 'string' ||
      typeof description !== 'string' ||
      typeof annualRateBps !== 'number' ||
      typeof termMonths !== 'number' ||
      typeof minInvestCents !== 'number' ||
      typeof capacityCents !== 'number' ||
      typeof fundedCents !== 'number' ||
      typeof currency !== 'string' ||
      typeof status !== 'string'
    ) {
      throw new Error(`Project ${id} is missing required catalog fields.`);
    }

    const remaining = capacityCents - fundedCents;
    return {
      id,
      name,
      town,
      description,
      annualRateBps,
      termMonths,
      minInvestCents,
      capacityCents,
      fundedCents,
      remainingCents: Math.max(0, remaining),
      currency,
      status,
      imageUrl: typeof data.imageUrl === 'string' ? data.imageUrl : null,
      content: data.contentJson ?? null,
    };
  }

  async listProjects() {
    const projects = await this.firebase.firestore
      .collection('projects')
      .where('status', 'in', ['open', 'funded'])
      .limit(100)
      .get();
    return projects.docs
      .sort((left, right) => {
        const leftDate = left.get('publishedAt');
        const rightDate = right.get('publishedAt');
        const leftMillis =
          leftDate && typeof leftDate.toMillis === 'function'
            ? leftDate.toMillis()
            : 0;
        const rightMillis =
          rightDate && typeof rightDate.toMillis === 'function'
            ? rightDate.toMillis()
            : 0;
        return rightMillis - leftMillis;
      })
      .map((project) => this.mapProject(project.id, project.data()));
  }

  async getProject(id: string) {
    const project = await this.firebase.firestore
      .collection('projects')
      .doc(id)
      .get();
    if (!project.exists) throw new NotFoundException('Project not found.');
    return this.mapProject(project.id, project.data()!);
  }

  async favourites(userId: string, entityType?: string) {
    const entity = await this.users.resolveEntity(userId, entityType);
    const rows = await this.firebase.firestore
      .collection('favourites')
      .where('entityId', '==', entity.id)
      .get();
    return rows.docs.map((row) => String(row.get('projectId')));
  }

  async setFavourite(
    userId: string,
    projectId: string,
    favourite: boolean,
    entityType?: string,
  ) {
    const entity = await this.users.resolveEntity(userId, entityType);
    await this.getProject(projectId);
    const reference = this.firebase.firestore
      .collection('favourites')
      .doc(`${entity.id}__${projectId}`);
    if (favourite) {
      await reference.set(
        {
          userId,
          entityId: entity.id,
          projectId,
          createdAt: new Date(),
        },
        { merge: true },
      );
    } else {
      await reference.delete();
    }
    return { ok: true };
  }

  async rememberSearch(userId: string, query: string) {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return { ok: true };
    await this.firebase.firestore
      .collection('users')
      .doc(userId)
      .collection('searchHistory')
      .add({
        userId,
        query: normalizedQuery,
        createdAt: new Date(),
      });
    return { ok: true };
  }

  async recentSearches(userId: string) {
    const rows = await this.firebase.firestore
      .collection('users')
      .doc(userId)
      .collection('searchHistory')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    return [...new Set(rows.docs.map((row) => String(row.get('query'))))];
  }
}
