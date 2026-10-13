import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FirebaseAdminService } from '../../firebase/firebase-admin.service';
import type { DocumentData } from 'firebase-admin/firestore';

@Injectable()
export class NotificationsService {
  constructor(private readonly firebase: FirebaseAdminService) {}

  private toIso(value: unknown) {
    if (value instanceof Date) return value.toISOString();
    if (
      typeof value === 'object' &&
      value !== null &&
      'toDate' in value &&
      typeof value.toDate === 'function'
    ) {
      return (value.toDate() as Date).toISOString();
    }
    throw new Error('A notification record has an invalid createdAt value.');
  }

  private mapNotification(id: string, data: DocumentData) {
    return {
      id,
      title: String(data.title ?? ''),
      body: String(data.body ?? ''),
      kind: String(data.kind ?? ''),
      read: data.readAt != null,
      createdAt: this.toIso(data.createdAt),
      payload: data.payload ?? null,
    };
  }

  async list(userId: string) {
    const rows = await this.firebase.firestore
      .collection('notifications')
      .where('userId', '==', userId)
      .limit(100)
      .get();
    return rows.docs
      .sort(
        (left, right) =>
          right.get('createdAt').toMillis() - left.get('createdAt').toMillis(),
      )
      .map((notification) =>
        this.mapNotification(notification.id, notification.data()),
      );
  }

  async markRead(userId: string, id: string) {
    const ref = this.firebase.firestore.collection('notifications').doc(id);
    const notification = await ref.get();
    if (!notification.exists)
      throw new NotFoundException('Notification not found.');
    if (notification.get('userId') !== userId) {
      throw new ForbiddenException('You cannot update this notification.');
    }
    await ref.update({ readAt: new Date() });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    const rows = await this.firebase.firestore
      .collection('notifications')
      .where('userId', '==', userId)
      .get();
    const unread = rows.docs.filter(
      (notification) => notification.get('readAt') == null,
    );
    for (let index = 0; index < unread.length; index += 450) {
      const batch = this.firebase.firestore.batch();
      for (const notification of unread.slice(index, index + 450)) {
        batch.update(notification.ref, { readAt: new Date() });
      }
      await batch.commit();
    }
    return { ok: true };
  }

  async messages(userId: string) {
    const rows = await this.firebase.firestore
      .collection('chatMessages')
      .where('userId', '==', userId)
      .limit(200)
      .get();
    return rows.docs
      .sort(
        (left, right) =>
          left.get('createdAt').toMillis() - right.get('createdAt').toMillis(),
      )
      .map((message) => ({
        id: message.id,
        text: String(message.get('text') ?? ''),
        fromSupport: message.get('fromSupport') === true,
        createdAt: this.toIso(message.get('createdAt')),
      }));
  }

  async sendMessage(userId: string, text: string) {
    if (typeof text !== 'string') {
      throw new BadRequestException('Message text is required.');
    }
    const messageText = text.trim();
    if (!messageText) throw new BadRequestException('Message cannot be empty.');
    if (messageText.length > 2000) {
      throw new BadRequestException(
        'Messages must be 2000 characters or fewer.',
      );
    }
    const createdAt = new Date();
    const message = await this.firebase.firestore
      .collection('chatMessages')
      .add({ userId, text: messageText, fromSupport: false, createdAt });
    return {
      id: message.id,
      text: messageText,
      fromSupport: false,
      createdAt: createdAt.toISOString(),
    };
  }

  async chatConversations() {
    const db = this.firebase.firestore;
    const rows = await db
      .collection('chatMessages')
      .orderBy('createdAt', 'desc')
      .limit(1000)
      .get();
    const latestByUser = new Map<
      string,
      FirebaseFirestore.QueryDocumentSnapshot
    >();
    for (const message of rows.docs) {
      const userId = message.get('userId');
      if (typeof userId === 'string' && !latestByUser.has(userId)) {
        latestByUser.set(userId, message);
      }
    }
    const conversations = [...latestByUser.entries()].slice(0, 200);
    const profiles = await Promise.all(
      conversations.map(([userId]) => db.collection('users').doc(userId).get()),
    );
    return conversations.map(([userId, message], index) => {
      const profile = profiles[index];
      const user = profile.data() ?? {};
      return {
        userId,
        name: String(user.name ?? ''),
        email: String(user.email ?? ''),
        lastMessage: {
          id: message.id,
          text: String(message.get('text') ?? ''),
          fromSupport: message.get('fromSupport') === true,
          createdAt: this.toIso(message.get('createdAt')),
        },
      };
    });
  }

  async supportMessages(userId: string) {
    const profile = await this.firebase.firestore
      .collection('users')
      .doc(userId)
      .get();
    if (!profile.exists) throw new NotFoundException('User profile not found.');
    const rows = await this.firebase.firestore
      .collection('chatMessages')
      .where('userId', '==', userId)
      .limit(200)
      .get();
    return rows.docs
      .sort(
        (left, right) =>
          left.get('createdAt').toMillis() - right.get('createdAt').toMillis(),
      )
      .map((message) => ({
        id: message.id,
        text: String(message.get('text') ?? ''),
        fromSupport: message.get('fromSupport') === true,
        createdAt: this.toIso(message.get('createdAt')),
      }));
  }

  async sendSupportMessage(userId: string, text: string) {
    if (typeof text !== 'string') {
      throw new BadRequestException('Message text is required.');
    }
    const messageText = text.trim();
    if (!messageText) throw new BadRequestException('Message cannot be empty.');
    if (messageText.length > 2000) {
      throw new BadRequestException(
        'Messages must be 2000 characters or fewer.',
      );
    }
    const user = await this.firebase.firestore
      .collection('users')
      .doc(userId)
      .get();
    if (!user.exists) throw new NotFoundException('User profile not found.');
    const createdAt = new Date();
    const message = await this.firebase.firestore
      .collection('chatMessages')
      .add({ userId, text: messageText, fromSupport: true, createdAt });
    return {
      id: message.id,
      text: messageText,
      fromSupport: true,
      createdAt: createdAt.toISOString(),
    };
  }

  async registerDevice(
    userId: string | null,
    data: {
      platform: string;
      appVersion?: string;
      pushSubscription?: string;
      permissionState?: string;
      metadata?: object;
    },
  ) {
    const createdAt = new Date();
    const installation = await this.firebase.firestore
      .collection('deviceInstallations')
      .add({
        userId,
        platform: data.platform,
        appVersion: data.appVersion ?? null,
        pushSubscription: data.pushSubscription ?? null,
        permissionState: data.permissionState ?? 'unknown',
        metadata: data.metadata ?? null,
        createdAt,
        updatedAt: createdAt,
      });
    return {
      id: installation.id,
      userId,
      platform: data.platform,
      appVersion: data.appVersion ?? null,
      pushSubscription: data.pushSubscription ?? null,
      permissionState: data.permissionState ?? 'unknown',
      metadata: data.metadata ?? null,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
    };
  }

  async bindDevice(userId: string, deviceId: string) {
    const ref = this.firebase.firestore
      .collection('deviceInstallations')
      .doc(deviceId);
    const installation = await ref.get();
    if (!installation.exists) {
      throw new NotFoundException('Device registration was not found.');
    }
    const owner = installation.get('userId');
    if (owner != null && owner !== userId) {
      throw new ForbiddenException(
        'This device is already linked to another account.',
      );
    }
    await ref.update({ userId, updatedAt: new Date() });
    return { ok: true };
  }

  async broadcast(
    adminId: string,
    title: string,
    body: string,
    kind = 'updates',
  ) {
    const users = await this.firebase.firestore.collection('users').get();
    for (let index = 0; index < users.docs.length; index += 450) {
      const batch = this.firebase.firestore.batch();
      for (const user of users.docs.slice(index, index + 450)) {
        const notification = this.firebase.firestore
          .collection('notifications')
          .doc();
        batch.create(notification, {
          userId: user.id,
          title,
          body,
          kind,
          readAt: null,
          createdAt: new Date(),
        });
      }
      await batch.commit();
    }
    await this.firebase.firestore.collection('auditLogs').add({
      actorAdminId: adminId,
      action: 'notifications.broadcast',
      resource: 'notification',
      metadata: { title, count: users.docs.length },
      createdAt: new Date(),
    });
    return { sent: users.docs.length };
  }
}
