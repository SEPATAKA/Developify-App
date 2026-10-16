import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:developify_mobile/app/environment/app_environment.dart';
import 'package:developify_mobile/core/errors/result.dart';
import 'package:developify_mobile/core/network/api_client.dart';
import 'package:developify_mobile/core/services/session_service.dart';
import 'package:developify_mobile/core/services/transaction_authorization.dart';
import 'package:developify_mobile/core/storage/api_document_uploader.dart';
import 'package:developify_mobile/core/storage/picked_local_file.dart';
import 'package:developify_mobile/core/storage/token_storage.dart';
import 'package:developify_mobile/features/investor/data/api_kyc_repository.dart';
import 'package:developify_mobile/features/investor/domain/kyc/kyc_models.dart';
import 'package:developify_mobile/features/landowner/data/api_landowner_repository.dart';
import 'package:developify_mobile/features/landowner/domain/submission_draft.dart';
import 'package:developify_mobile/features/profile/data/api_profile_repository.dart';
import 'package:developify_mobile/features/profile/presentation/stores/profile_store.dart';
import 'package:developify_mobile/features/shared/domain/app_user.dart';

final class _UploadAdapter implements HttpClientAdapter {
  final requests = <RequestOptions>[];
  final responses = <String, Object?>{};
  final statusCodes = <String, int>{};

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    requests.add(options);
    final statusCode = statusCodes[options.uri.path] ?? 200;
    final response =
        responses[options.uri.path] ??
        (statusCode >= 400
            ? {'message': 'Profile photo could not be saved.'}
            : {'ok': true});
    return ResponseBody.fromString(
      jsonEncode(response),
      statusCode,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

final class _RecordingUploader implements DocumentUploader {
  _RecordingUploader(this.storageKey);

  final String storageKey;
  final files = <PickedLocalFile>[];
  final prefixes = <String>[];

  @override
  Future<Result<String>> upload(
    PickedLocalFile file, {
    required String prefix,
  }) async {
    files.add(file);
    prefixes.add(prefix);
    return Success(storageKey);
  }

  @override
  Future<Result<void>> delete(String storageKey) async => const Success(null);
}

final class _NoopAuthorization implements TransactionAuthorization {
  @override
  bool setPin(String pin) => true;

  @override
  bool simulateBiometric() => true;

  @override
  bool verifyPin(String pin) => true;

  @override
  void dispose() {}
}

void main() {
  late _UploadAdapter adapter;
  late MemoryTokenStorage tokens;
  late ApiClient client;

  setUp(() {
    adapter = _UploadAdapter();
    tokens = MemoryTokenStorage();
    final dio = Dio()..httpClientAdapter = adapter;
    client = ApiClient(
      environment: const AppEnvironment(
        apiBaseUrl: 'https://api.example.test',
        mockMode: false,
      ),
      tokens: tokens,
      dio: dio,
    );
  });

  tearDown(() => client.dispose());

  test(
    'Profile photo bytes and Supabase reference save immediately',
    () async {
      await tokens.writeToken('supabase-access-token');
      final file = PickedLocalFile(
        name: 'avatar.png',
        mimeType: 'image/png',
        bytes: Uint8List.fromList([1, 2, 3, 4]),
      );
      const key = 'profile/avatar/user-1/photo.png';
      adapter.responses['/v1/documents/upload'] = {'storageKey': key};
      adapter.responses['/v1/users/me'] = {
        'id': 'user-1',
        'name': 'Investor',
        'email': 'investor@example.test',
        'hasProfilePhoto': true,
        'profilePhotoKey': key,
      };
      final session = SessionService();
      addTearDown(session.dispose);
      final repository = ApiProfileRepository(
        client,
        session,
        authorization: _NoopAuthorization(),
      );
      addTearDown(repository.dispose);
      final store = ProfileStore(repository)
        ..user = AppUser(
          id: 'user-1',
          name: 'Investor',
          email: 'investor@example.test',
          phone: '+27123456789',
          hasProfilePhoto: false,
        );
      addTearDown(store.dispose);

      expect(await store.selectPhoto(file), isTrue);
      expect(store.user?.profilePhotoKey, key);
      expect(store.user?.profilePhotoPreview, file.bytes);
      expect(store.dirty, isFalse);

      final upload = adapter.requests.first;
      expect(upload.uri.path, '/v1/documents/upload');
      expect(upload.method, 'POST');
      expect(upload.headers['Authorization'], 'Bearer supabase-access-token');
      expect((upload.data as Map)['name'], 'avatar.png');
      expect((upload.data as Map)['mimeType'], 'image/png');
      expect((upload.data as Map)['prefix'], 'profile/avatar');
      expect((upload.data as Map)['contentBase64'], 'AQIDBA==');

      final photoSave = adapter.requests.last;
      expect(photoSave.uri.path, '/v1/users/me');
      expect(photoSave.method, 'PATCH');
      expect(photoSave.data, {'profilePhotoKey': key});

      store.edit('name', 'Updated name');
      expect(await store.save(), isTrue);
      final save = adapter.requests.last;
      expect(save.uri.path, '/v1/users/me');
      expect(save.method, 'PATCH');
      expect((save.data as Map)['name'], 'Updated name');
      expect((save.data as Map)['profilePhotoKey'], key);
    },
  );

  test(
    'Failed Supabase profile-photo save removes the uploaded object',
    () async {
      final file = PickedLocalFile(
        name: 'avatar.png',
        mimeType: 'image/png',
        bytes: Uint8List.fromList([1, 2, 3, 4]),
      );
      const key = 'profile/avatar/user-1/photo.png';
      adapter.responses['/v1/documents/upload'] = {'storageKey': key};
      adapter.statusCodes['/v1/users/me'] = 503;
      final session = SessionService();
      addTearDown(session.dispose);
      final repository = ApiProfileRepository(
        client,
        session,
        authorization: _NoopAuthorization(),
      );
      addTearDown(repository.dispose);
      final store = ProfileStore(repository)
        ..user = AppUser(
          id: 'user-1',
          name: 'Investor',
          email: 'investor@example.test',
          phone: '+27123456789',
          hasProfilePhoto: false,
        );
      addTearDown(store.dispose);

      expect(await store.selectPhoto(file), isFalse);
      expect(store.user?.profilePhotoKey, isNull);
      expect(store.user?.hasProfilePhoto, isFalse);
      expect(store.error, isNotEmpty);
      expect(adapter.requests.map((request) => request.uri.path), [
        '/v1/documents/upload',
        '/v1/users/me',
        '/v1/documents/upload',
      ]);
      expect(adapter.requests.last.method, 'DELETE');
      expect((adapter.requests.last.data as Map)['storageKey'], key);
    },
  );

  test(
    'The shared uploader rejects empty, oversized and unsupported files',
    () async {
      final uploader = ApiDocumentUploader(client);
      final empty = await uploader.upload(
        PickedLocalFile(
          name: 'empty.pdf',
          mimeType: 'application/pdf',
          bytes: Uint8List(0),
        ),
        prefix: 'kyc/individual',
      );
      final oversized = await uploader.upload(
        PickedLocalFile(
          name: 'large.pdf',
          mimeType: 'application/pdf',
          bytes: Uint8List(5 * 1024 * 1024 + 1),
        ),
        prefix: 'kyc/individual',
      );
      final unsupported = await uploader.upload(
        PickedLocalFile(
          name: 'archive.zip',
          mimeType: 'application/zip',
          bytes: Uint8List.fromList([1]),
        ),
        prefix: 'kyc/individual',
      );

      expect(empty, isA<Failure<String>>());
      expect(oversized, isA<Failure<String>>());
      expect(unsupported, isA<Failure<String>>());
      expect(adapter.requests, isEmpty);
    },
  );

  test(
    'Landowner files persist the draft before registering the upload',
    () async {
      final file = PickedLocalFile(
        name: 'title-deed.pdf',
        mimeType: 'application/pdf',
        bytes: Uint8List.fromList([7, 8, 9]),
      );
      const key = 'landowner/draft-1/user-1/title-deed.pdf';
      final uploader = _RecordingUploader(key);
      adapter.responses['/v1/landowner/drafts/draft-1/documents'] = {
        'id': 'document-1',
      };
      final repository = ApiLandownerRepository(client, uploader: uploader);
      addTearDown(repository.dispose);

      final result = await repository.uploadAttachment(
        'draft-1',
        'title',
        file,
      );

      expect(result, isA<Success<LocalAttachment>>());
      final attachment = (result as Success<LocalAttachment>).value;
      expect(attachment.id, 'document-1');
      expect(attachment.storageKey, key);
      expect(uploader.prefixes, ['landowner/draft-1']);
      expect(uploader.files.single.bytes, file.bytes);
      expect(adapter.requests.map((request) => request.uri.path), [
        '/v1/landowner/drafts/draft-1',
        '/v1/landowner/drafts/draft-1/documents',
      ]);
      expect(adapter.requests.first.method, 'PUT');
      expect(adapter.requests.last.method, 'POST');
      expect((adapter.requests.last.data as Map)['storageKey'], key);
      expect(
        (adapter.requests.last.data as Map)['sizeBytes'],
        file.bytes.length,
      );
    },
  );

  test(
    'Investor KYC files upload bytes and register the storage key',
    () async {
      final file = PickedLocalFile(
        name: 'identity.pdf',
        mimeType: 'application/pdf',
        bytes: Uint8List.fromList([4, 5, 6]),
      );
      const key = 'kyc/individual/user-1/identity.pdf';
      final uploader = _RecordingUploader(key);
      adapter.responses['/v1/kyc/individual/documents'] = {
        'id': 'entity-1',
        'entity': 'individual',
        'status': 'incomplete',
        'documents': [
          {
            'id': 'kyc-document-1',
            'key': 'identity',
            'name': file.name,
            'mimeType': file.mimeType,
            'sizeBytes': file.bytes.length,
          },
        ],
      };
      final repository = ApiKycRepository(client, uploader: uploader);
      addTearDown(repository.dispose);

      final result = await repository.upload(
        EntityType.individual,
        'identity',
        name: file.name,
        bytes: file.bytes.length,
        mimeType: file.mimeType,
        content: file.bytes,
      );

      expect(result, isA<Success<KycDraft>>());
      final draft = (result as Success<KycDraft>).value;
      expect(draft.documents['identity']?.id, 'kyc-document-1');
      expect(uploader.prefixes, ['kyc/individual']);
      expect(uploader.files.single.bytes, file.bytes);
      final request = adapter.requests.single;
      expect(request.uri.path, '/v1/kyc/individual/documents');
      expect(request.method, 'POST');
      expect((request.data as Map)['storageKey'], key);
      expect((request.data as Map)['sizeBytes'], file.bytes.length);
    },
  );
}
