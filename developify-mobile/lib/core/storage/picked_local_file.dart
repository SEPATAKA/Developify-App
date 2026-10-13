import 'dart:typed_data';

final class PickedLocalFile {
  const PickedLocalFile({
    required this.name,
    required this.mimeType,
    required this.bytes,
  });

  final String name;
  final String mimeType;
  final Uint8List bytes;
}
