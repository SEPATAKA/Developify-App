import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:developify_mobile/core/storage/device_file_picker.dart';
import 'package:developify_mobile/core/widgets/feedback.dart';
import 'package:developify_mobile/features/investor/domain/kyc/kyc_models.dart';
import 'package:developify_mobile/features/investor/presentation/stores/kyc_store.dart';
import 'package:developify_mobile/features/investor/presentation/stores/kyc_member_store.dart';

final class KycDocumentActions {
  KycDocumentActions(KycStore store, {bool append = false, String? documentId})
    : _upload =
          ((
            String key, {
            required String name,
            required int bytes,
            required String mimeType,
            required Uint8List content,
          }) => store.upload(
            key,
            name: name,
            bytes: bytes,
            mimeType: mimeType,
            content: content,
            append: append,
            documentId: documentId,
          )),
      _delete = ((key) => store.deleteDocument(key, documentId: documentId)),
      _error = (() => store.error);
  KycDocumentActions.member(KycMemberStore store)
    : _upload =
          ((
            String key, {
            required String name,
            required int bytes,
            required String mimeType,
            required Uint8List content,
          }) => store.upload(
            key,
            name: name,
            bytes: bytes,
            mimeType: mimeType,
            content: content,
          )),
      _delete = store.deleteDocument,
      _error = (() => store.error);
  final Future<bool> Function(
    String key, {
    required String name,
    required int bytes,
    required String mimeType,
    required Uint8List content,
  })
  _upload;
  final Future<bool> Function(String key) _delete;
  final String? Function() _error;

  Future<void> choose(
    BuildContext context,
    KycDocumentDefinition document,
  ) async {
    try {
      final files = await const PlatformDeviceFilePicker().pick(
        extensions: const ['pdf', 'jpg', 'jpeg', 'png', 'webp'],
        allowMultiple: document.multiple,
      );
      if (!context.mounted || files == null || files.isEmpty) return;
      for (final file in files) {
        final uploaded = await _upload(
          document.key,
          name: file.name,
          bytes: file.bytes.length,
          mimeType: file.mimeType,
          content: file.bytes,
        );
        if (!context.mounted) return;
        if (!uploaded) {
          showFeedback(
            context,
            _error() ?? 'The document could not be uploaded. Please try again.',
          );
          return;
        }
      }
    } on PlatformException catch (exception) {
      if (context.mounted) {
        showFeedback(
          context,
          exception.message ?? 'The selected file could not be read.',
        );
      }
    } on StateError catch (exception) {
      if (context.mounted) showFeedback(context, exception.message);
    }
  }

  Future<void> remove(
    BuildContext context,
    KycDocumentDefinition document,
  ) async {
    final remove = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete document?'),
        content: Text(
          '${document.title} will be removed from this application.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (!context.mounted || remove != true) return;
    final deleted = await _delete(document.key);
    if (!context.mounted || deleted) return;
    showFeedback(
      context,
      _error() ?? 'The document could not be removed. Please try again.',
    );
  }
}
