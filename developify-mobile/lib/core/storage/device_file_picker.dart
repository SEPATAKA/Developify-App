import 'package:file_picker/file_picker.dart';
import 'package:developify_mobile/core/storage/picked_local_file.dart';

abstract interface class DeviceFilePicker {
  Future<List<PickedLocalFile>?> pick({
    required List<String> extensions,
    bool allowMultiple = false,
  });
}

final class PlatformDeviceFilePicker implements DeviceFilePicker {
  const PlatformDeviceFilePicker();

  @override
  Future<List<PickedLocalFile>?> pick({
    required List<String> extensions,
    bool allowMultiple = false,
  }) async {
    late final List<PlatformFile> selection;
    try {
      if (allowMultiple) {
        selection = await FilePicker.pickFiles(
          type: FileType.custom,
          allowedExtensions: extensions,
        );
      } else {
        final file = await FilePicker.pickFile(
          type: FileType.custom,
          allowedExtensions: extensions,
        );
        selection = file == null ? const [] : [file];
      }
    } on UnimplementedError {
      throw StateError(
        'The local file picker is unavailable on this platform.',
      );
    }
    if (selection.isEmpty) return null;
    final chosen = allowMultiple ? selection : selection.take(1);
    final files = <PickedLocalFile>[];
    for (final file in chosen) {
      files.add(
        PickedLocalFile(
          name: file.name,
          mimeType: _mimeType(file.extension),
          bytes: await file.readAsBytes(),
        ),
      );
    }
    return files;
  }

  String _mimeType(String? extension) => switch (extension?.toLowerCase()) {
    'pdf' => 'application/pdf',
    'jpg' || 'jpeg' => 'image/jpeg',
    'png' => 'image/png',
    'webp' => 'image/webp',
    _ => 'application/octet-stream',
  };
}
