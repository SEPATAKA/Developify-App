import 'dart:async';

import 'package:developify_mobile/core/errors/result.dart';
import 'package:developify_mobile/core/network/api_client.dart';
import 'package:developify_mobile/core/storage/api_document_uploader.dart';
import 'package:developify_mobile/core/storage/picked_local_file.dart';
import 'package:developify_mobile/features/landowner/domain/landowner_repository.dart';
import 'package:developify_mobile/features/landowner/domain/property.dart';
import 'package:developify_mobile/features/landowner/domain/submission_draft.dart';
import 'package:developify_mobile/features/shared/domain/app_user.dart';

final class ApiLandownerRepository implements LandownerRepository {
  ApiLandownerRepository(this._client, {DocumentUploader? uploader})
    : _uploader = uploader ?? ApiDocumentUploader(_client);
  final ApiClient _client;
  final DocumentUploader _uploader;
  final _changes = StreamController<void>.broadcast();
  final _balanceVisibility = StreamController<bool>.broadcast();
  final Map<String, SubmissionDraft> _drafts = {};
  bool _balanceVisible = true;

  Property _mapProperty(Object? json) {
    final map = json as Map<String, Object?>? ?? const {};
    final statusName = map['status'] as String? ?? 'draft';
    return Property(
      id: map['id'] as String? ?? '',
      name: map['name'] as String? ?? '',
      town: map['town'] as String? ?? '',
      status: PropertyStatus.values.firstWhere(
        (s) => s.name == statusName,
        orElse: () => PropertyStatus.draft,
      ),
      size: map['size'] as String? ?? '',
      fundingPercent: (map['fundingPercent'] as num?)?.toInt() ?? 0,
      draftStep: (map['draftStep'] as num?)?.toInt() ?? 1,
      erf: map['erf'] as String? ?? '',
      address: map['address'] as String? ?? '',
    );
  }

  @override
  bool get balanceVisible => _balanceVisible;

  @override
  Stream<bool> get balanceVisibilityChanges => _balanceVisibility.stream;

  @override
  void setBalanceVisible(bool visible) {
    _balanceVisible = visible;
    _balanceVisibility.add(visible);
  }

  @override
  void clearSession() {
    _drafts.clear();
  }

  @override
  Stream<void> get changes => _changes.stream;

  @override
  Future<void> dispose() async {
    await _changes.close();
    await _balanceVisibility.close();
  }

  @override
  Future<Result<LandownerOverview>> overview() {
    return _client.request(
      path: '/v1/landowner/overview',
      decode: (json) {
        final map = json as Map<String, Object?>? ?? const {};
        final properties = ((map['properties'] as List<dynamic>?) ?? const [])
            .map(_mapProperty)
            .toList();
        return LandownerOverview(
          properties: properties,
          earnedCents: (map['earnedCents'] as num?)?.toInt() ?? 0,
          propertyCount:
              (map['propertyCount'] as num?)?.toInt() ?? properties.length,
          approvedCount: (map['approvedCount'] as num?)?.toInt() ?? 0,
          nextPayoutCents: (map['nextPayoutCents'] as num?)?.toInt() ?? 0,
        );
      },
    );
  }

  @override
  Future<Result<List<Property>>> properties() {
    return _client.request(
      path: '/v1/landowner/properties',
      decode: (json) =>
          ((json as List<dynamic>?) ?? const []).map(_mapProperty).toList(),
    );
  }

  @override
  Future<Result<Property>> property(String id) {
    return _client.request(
      path: '/v1/landowner/properties/$id',
      decode: _mapProperty,
    );
  }

  @override
  Future<Result<EarningsSummary>> earnings() {
    return _client.request(
      path: '/v1/landowner/earnings',
      decode: (json) {
        final map = json as Map<String, Object?>? ?? const {};
        final payouts = ((map['payouts'] as List<dynamic>?) ?? const []).map((
          raw,
        ) {
          final p = raw as Map<String, Object?>? ?? const {};
          return Payout(
            id: p['id'] as String? ?? '',
            propertyName: p['propertyName'] as String? ?? '',
            amountCents: (p['amountCents'] as num?)?.toInt() ?? 0,
            period: p['period'] as String? ?? '',
            date: p['date'] as String? ?? '',
          );
        }).toList();
        return EarningsSummary(
          payouts: payouts,
          totalCents: (map['totalCents'] as num?)?.toInt() ?? 0,
          nextPayoutCents: (map['nextPayoutCents'] as num?)?.toInt() ?? 0,
        );
      },
    );
  }

  @override
  SubmissionDraft readDraft(String id) {
    return _drafts[id] ?? SubmissionDraft(id: id);
  }

  @override
  Future<Result<SubmissionDraft>> loadDraft(String id) async {
    final result = await _client.request<Object?>(
      path: '/v1/landowner/drafts/${Uri.encodeComponent(id)}',
      decode: (json) => json,
    );
    if (result case Failure(:final error)) return Failure(error);
    final response = (result as Success<Object?>).value;
    if (response is! Map) {
      return const Failure(
        AppFailure(FailureKind.server, 'The saved property draft is invalid.'),
      );
    }
    final map = Map<String, Object?>.from(response);
    final payload = map['payload'] is Map
        ? Map<String, Object?>.from(map['payload'] as Map)
        : const <String, Object?>{};
    String text(String key) => payload[key]?.toString() ?? '';
    final entityName = payload['entity'] as String?;
    final entity = EntityType.values.firstWhere(
      (value) => value.name == entityName,
      orElse: () => EntityType.individual,
    );
    final photos = <LocalAttachment>[];
    final documents = <String, LocalAttachment>{};
    final rawDocuments = map['documents'];
    if (rawDocuments is List) {
      for (final raw in rawDocuments.whereType<Map>()) {
        final document = Map<String, Object?>.from(raw);
        final key = document['key'] as String? ?? '';
        final attachment = LocalAttachment(
          id: document['id'] as String? ?? key,
          name: document['name'] as String? ?? key,
          bytes: (document['sizeBytes'] as num?)?.toInt() ?? 0,
          mimeType:
              document['mimeType'] as String? ?? 'application/octet-stream',
          storageKey: document['storageKey'] as String?,
          documentKey: key,
        );
        if (key.startsWith('site-photo-')) {
          photos.add(attachment);
        } else {
          documents[key] = attachment;
        }
      }
    }
    final draft = SubmissionDraft(
      id: id,
      step: (map['step'] as num?)?.toInt() ?? 1,
      name: text('name'),
      legalDescription: text('legalDescription'),
      propertyNumber: text('number'),
      propertyType: text('type'),
      size: text('size'),
      unit: text('unit'),
      deedsOffice: text('deedsOffice'),
      address: text('address'),
      city: text('city'),
      town: text('town'),
      country: text('country'),
      monthlyLease: text('monthlyLease'),
      province: text('province'),
      postalCode: text('postal'),
      latitude: text('latitude'),
      longitude: text('longitude'),
      photos: photos,
      documents: documents,
      entity: entity,
      deal: text('deal'),
      price: text('price'),
      notes: text('notes'),
      coOwners: payload['coOwners'] == true,
      hasValuation: payload['hasValuation'] == true,
      accepted: payload['accepted'] == true,
    );
    _drafts[id] = draft;
    return Success(draft);
  }

  @override
  Future<Result<void>> saveDraft(SubmissionDraft draft) async {
    final result = await _persistDraft(draft);
    if (result.isSuccess) {
      _drafts[draft.id] = draft;
      _changes.add(null);
    }
    return result;
  }

  Future<Result<void>> _persistDraft(SubmissionDraft draft) =>
      _client.request<void>(
        path: '/v1/landowner/drafts/${Uri.encodeComponent(draft.id)}',
        method: 'PUT',
        data: {
          'step': draft.step,
          'payload': {
            'name': draft.name,
            'legalDescription': draft.legalDescription,
            'number': draft.propertyNumber,
            'type': draft.propertyType,
            'size': draft.size,
            'unit': draft.unit,
            'deedsOffice': draft.deedsOffice,
            'address': draft.address,
            'city': draft.city,
            'town': draft.town,
            'country': draft.country,
            'province': draft.province,
            'postal': draft.postalCode,
            'latitude': draft.latitude,
            'longitude': draft.longitude,
            'monthlyLease': draft.monthlyLease,
            'notes': draft.notes,
            'price': draft.price,
            'entity': draft.entity.name,
            'deal': draft.deal,
            'coOwners': draft.coOwners,
            'hasValuation': draft.hasValuation,
            'accepted': draft.accepted,
            'erf': draft.propertyNumber,
          },
        },
        decode: (_) {},
      );

  @override
  Future<Result<LocalAttachment>> uploadAttachment(
    String draftId,
    String key,
    PickedLocalFile file,
  ) async {
    final draft = await _persistDraft(
      _drafts[draftId] ?? SubmissionDraft(id: draftId),
    );
    if (draft case Failure(:final error)) return Failure(error);

    final uploaded = await _uploader.upload(file, prefix: 'landowner/$draftId');
    if (uploaded case Failure(:final error)) return Failure(error);
    final storageKey = (uploaded as Success<String>).value;
    final saved = await _client.request<Object?>(
      path: '/v1/landowner/drafts/$draftId/documents',
      method: 'POST',
      data: {
        'key': key,
        'name': file.name,
        'mimeType': file.mimeType,
        'sizeBytes': file.bytes.length,
        'storageKey': storageKey,
      },
      decode: (json) => json,
    );
    if (saved case Failure(:final error)) {
      final cleanup = await _uploader.delete(storageKey);
      if (cleanup case Failure(error: final cleanupError)) {
        return Failure(
          AppFailure(
            FailureKind.server,
            'The file could not be linked to this property (${error.message}) and cleanup failed: ${cleanupError.message}',
          ),
        );
      }
      return Failure(error);
    }
    final response = (saved as Success<Object?>).value;
    final documentId =
        (response as Map<String, Object?>?)?['id'] as String? ?? '';
    if (documentId.isEmpty) {
      return const Failure(
        AppFailure(
          FailureKind.server,
          'The uploaded property file was not confirmed by the server.',
        ),
      );
    }
    return Success(
      LocalAttachment(
        id: documentId,
        documentKey: key,
        name: file.name,
        bytes: file.bytes.length,
        mimeType: file.mimeType,
        storageKey: storageKey,
        previewBytes: file.bytes,
      ),
    );
  }

  @override
  Future<Result<void>> removeAttachment(
    String draftId,
    LocalAttachment attachment,
  ) async {
    final result = await _client.request<void>(
      path:
          '/v1/landowner/drafts/$draftId/documents/${Uri.encodeComponent(attachment.documentKey ?? attachment.id)}',
      method: 'DELETE',
      decode: (_) {},
    );
    if (result case Failure(:final error)) return Failure(error);
    return const Success(null);
  }

  @override
  Future<Result<String>> submit(SubmissionDraft draft) async {
    _drafts[draft.id] = draft;
    final persisted = await _persistDraft(draft);
    if (persisted case Failure(:final error)) return Failure(error);
    final result = await _client.request<Object?>(
      path: '/v1/landowner/submit',
      method: 'POST',
      data: {'draftKey': draft.id},
      decode: (json) => json,
    );
    if (result case Success(:final value)) {
      _changes.add(null);
      return Success(
        (value as Map<String, Object?>)['propertyId'] as String? ?? '',
      );
    }
    return result as Failure<String>;
  }
}
