import 'dart:convert';

import 'package:developify_mobile/core/errors/result.dart';
import 'package:developify_mobile/core/network/api_client.dart';
import 'package:developify_mobile/core/storage/picked_local_file.dart';

abstract interface class DocumentUploader {
  Future<Result<String>> upload(PickedLocalFile file, {required String prefix});
  Future<Result<void>> delete(String storageKey);
}

final class ApiDocumentUploader implements DocumentUploader {
  ApiDocumentUploader(this._client);

  static const maxBytes = 5 * 1024 * 1024;
  static const _mimeTypes = {
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
  };

  final ApiClient _client;

  @override
  Future<Result<String>> upload(
    PickedLocalFile file, {
    required String prefix,
  }) async {
    if (file.bytes.isEmpty) {
      return const Failure(
        AppFailure(
          FailureKind.validation,
          'The selected file is empty. Choose another file.',
        ),
      );
    }
    if (file.bytes.length > maxBytes) {
      return const Failure(
        AppFailure(
          FailureKind.validation,
          'Choose a file no larger than 5 MB.',
        ),
      );
    }
    if (!_mimeTypes.contains(file.mimeType)) {
      return const Failure(
        AppFailure(
          FailureKind.validation,
          'Choose a PDF, JPG, PNG, or WEBP file.',
        ),
      );
    }

    final result = await _client.request<Object?>(
      path: '/v1/documents/upload',
      method: 'POST',
      data: {
        'name': file.name,
        'mimeType': file.mimeType,
        'prefix': prefix,
        'contentBase64': base64Encode(file.bytes),
      },
      decode: (json) => json,
    );
    if (result case Success(:final value)) {
      final map = value as Map<String, Object?>?;
      final storageKey = map?['storageKey'] as String?;
      if (storageKey == null || storageKey.isEmpty) {
        return const Failure(
          AppFailure(
            FailureKind.server,
            'The uploaded file was not confirmed by the server.',
          ),
        );
      }
      return Success(storageKey);
    }
    return Failure((result as Failure<Object?>).error);
  }

  @override
  Future<Result<void>> delete(String storageKey) => _client.request<void>(
    path: '/v1/documents/upload',
    method: 'DELETE',
    data: {'storageKey': storageKey},
    decode: (_) {},
  );
}
